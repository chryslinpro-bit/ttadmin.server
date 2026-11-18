import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  hasExplicitFacebookQuantity,
  isFacebookAvailabilityInquiry,
  isValidFacebookPhone,
  parseFacebookConfirmation,
  FacebookCatalogProduct,
  matchFacebookProductMessage,
  parseFacebookQuantityReply,
} from './facebook-message.js';
import {
  FacebookGraphService,
  type FacebookImage,
} from './facebook-graph.service.js';
import { readProductImageForFacebook } from '../products/product-images.js';

type FacebookChannel = 'comment' | 'messenger';

interface IncomingFacebookEvent {
  channel: FacebookChannel;
  eventId: string;
  senderId: string;
  customerName?: string;
  text: string;
  commentId?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNestedId(record: JsonRecord, key: string) {
  const value = record[key];
  return isRecord(value) ? getString(value, 'id') : undefined;
}

function getEntries(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly graph: FacebookGraphService,
  ) {}

  async getPageSettings() {
    const settings = await this.prisma.facebookPageSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    return {
      greetingMessage: settings.greetingMessage,
      updatedAt: settings.updatedAt,
    };
  }

  async updateGreetingMessage(greetingMessage: unknown) {
    if (
      typeof greetingMessage !== 'string' ||
      greetingMessage.trim().length > 2000
    ) {
      throw new BadRequestException(
        'greetingMessage must be text with at most 2000 characters',
      );
    }
    const settings = await this.prisma.facebookPageSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', greetingMessage: greetingMessage.trim() },
      update: { greetingMessage: greetingMessage.trim() },
    });
    return {
      greetingMessage: settings.greetingMessage,
      updatedAt: settings.updatedAt,
    };
  }

  async publishPagePost(
    message: unknown,
    image?: FacebookImage,
    includeMessengerLink = false,
    productId?: string,
  ) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new BadRequestException('Publication text is required');
    }
    if (typeof includeMessengerLink !== 'boolean') {
      throw new BadRequestException('includeMessengerLink must be a boolean');
    }
    let postMessage = message.trim();
    if (includeMessengerLink) {
      const messengerLink = this.graph.getMessengerLink();
      if (!postMessage.includes(messengerLink)) {
        postMessage += `\n\nÉcrivez-nous sur Messenger : ${messengerLink}`;
      }
    }
    if (postMessage.length > 5000) {
      throw new BadRequestException(
        'Publication text cannot exceed 5000 characters',
      );
    }
    if (productId !== undefined) {
      if (typeof productId !== 'string' || !productId.trim()) {
        throw new BadRequestException('productId must be a non-empty string');
      }
      const product = await this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, facebookPostId: true },
      });
      if (!product) {
        throw new BadRequestException('The product to publish does not exist');
      }
      if (product.facebookPostId) {
        throw new BadRequestException('The product has already been published');
      }
    }
    this.graph.ensureConfigured();
    const postId = await this.graph.publishPagePost(postMessage, image);
    if (productId) {
      const result = await this.prisma.product.updateMany({
        where: { id: productId, deletedAt: null, facebookPostId: null },
        data: { facebookPostId: postId, facebookPublishedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ServiceUnavailableException(
          'Facebook published the post, but the product record could not be updated',
        );
      }
    }
    return postId;
  }

  async publishProduct(productId: unknown) {
    if (typeof productId !== 'string' || !productId.trim()) {
      throw new BadRequestException('productId must be a non-empty string');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        nom: true,
        description: true,
        prix: true,
        imageUrl: true,
        facebookPostId: true,
      },
    });
    if (!product) {
      throw new NotFoundException('The product to publish does not exist');
    }
    if (product.facebookPostId) {
      throw new BadRequestException('The product has already been published');
    }
    if (typeof product.nom !== 'string' || !product.nom.trim()) {
      throw new BadRequestException('The product name cannot be published');
    }

    const description =
      typeof product.description === 'string' ? product.description.trim() : '';
    const price = product.prix.toString().trim();
    const message = [
      `Nouveau produit : ${product.nom.trim()}`,
      description,
      price ? `Prix : ${price}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const image = await readProductImageForFacebook(product.imageUrl);
    return this.publishPagePost(message, image, true, product.id);
  }

  verifyWebhook(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ) {
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
    if (!verifyToken) {
      throw new ServiceUnavailableException(
        'Facebook webhook verification is not configured',
      );
    }

    const expected = Buffer.from(verifyToken);
    const received = Buffer.from(token ?? '');
    const validToken =
      expected.length === received.length &&
      timingSafeEqual(expected, received);
    if (mode !== 'subscribe' || !validToken || !challenge) {
      throw new ForbiddenException('Invalid Facebook webhook verification');
    }
    return challenge;
  }

  async handleWebhook(payload: unknown) {
    this.graph.ensureConfigured();
    const events = this.extractEvents(payload);
    if (events.length === 0) return;

    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        nom: true,
        keywords: true,
        description: true,
        prix: true,
        available: true,
      },
    });

    for (const event of events) {
      await this.processEvent(
        event,
        products.map((product) => ({
          ...product,
          prix: product.prix.toString(),
        })),
      );
    }
  }

  private extractEvents(payload: unknown): IncomingFacebookEvent[] {
    if (!isRecord(payload) || payload.object !== 'page') return [];
    const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
    const events: IncomingFacebookEvent[] = [];

    for (const entry of getEntries(payload.entry)) {
      const entryPageId = getString(entry, 'id');
      if (pageId && entryPageId && entryPageId !== pageId) continue;

      for (const change of getEntries(entry.changes)) {
        const field = getString(change, 'field');
        const value = change.value;
        if (
          !field ||
          !isRecord(value) ||
          (field !== 'feed' && field !== 'live_comments')
        ) {
          continue;
        }

        const verb = getString(value, 'verb');
        if (verb && verb !== 'add') continue;
        if (field === 'feed' && getString(value, 'item') !== 'comment') {
          continue;
        }
        const senderId =
          getNestedId(value, 'from') ??
          getString(value, 'sender_id') ??
          getNestedId(value, 'sender');
        const commentId =
          getString(value, 'comment_id') ?? getString(value, 'id');
        const text = getString(value, 'message') ?? getString(value, 'text');
        if (!senderId || !commentId || !text || senderId === pageId) {
          continue;
        }

        events.push({
          channel: 'comment',
          eventId: commentId,
          senderId,
          ...(isRecord(value.from) && getString(value.from, 'name')
            ? { customerName: getString(value.from, 'name') }
            : {}),
          text,
          commentId,
        });
      }

      for (const messagingEvent of getEntries(entry.messaging)) {
        const message = messagingEvent.message;
        if (!isRecord(message) || message.is_echo === true) continue;

        const senderId = getNestedId(messagingEvent, 'sender');
        const recipientId = getNestedId(messagingEvent, 'recipient');
        const eventId = getString(message, 'mid');
        const text = getString(message, 'text');
        if (
          !senderId ||
          !eventId ||
          !text ||
          senderId === pageId ||
          (pageId && recipientId && recipientId !== pageId)
        ) {
          continue;
        }

        events.push({ channel: 'messenger', eventId, senderId, text });
      }
    }

    return events;
  }

  private async processEvent(
    event: IncomingFacebookEvent,
    products: FacebookCatalogProduct[],
  ) {
    const match = matchFacebookProductMessage(event.text, products);
    const pending = await this.ordersService.getPendingFacebookOrder(
      event.senderId,
    );
    if (pending) {
      let customerName = pending.customerName;
      if (event.customerName && !pending.customerName) {
        await this.ordersService.updatePendingFacebookOrder(event.senderId, {
          customerName: event.customerName,
        });
        customerName = event.customerName;
      }
      await this.processPendingOrder(
        event,
        { ...pending, customerName },
        products,
      );
      return;
    }

    if (match.kind === 'match' && isFacebookAvailabilityInquiry(event.text)) {
      const product = match.items[0]?.product;
      if (!product) return;
      const available = product.available ?? 0;
      const replyText = [
        available > 0
          ? `${product.nom} est disponible (${available} en stock).`
          : `${product.nom} n’est actuellement plus en stock.`,
        product.description?.trim(),
        product.prix ? `Prix : ${product.prix}` : undefined,
        available > 0 ? 'Combien souhaitez-vous en commander ?' : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n');
      const result = await this.ordersService.recordFacebookOutcome({
        channel: event.channel,
        eventId: event.eventId,
        senderId: event.senderId,
        status: 'availability-inquiry',
        replyText,
      });
      if (available > 0 && !result.replySent) {
        if (event.customerName) {
          await this.ordersService.savePendingFacebookOrder(
            event.senderId,
            product.id,
            null,
            event.customerName,
          );
        } else {
          await this.ordersService.savePendingFacebookOrder(
            event.senderId,
            product.id,
            null,
          );
        }
      }
      if (result.replyText && !result.replySent) {
        await this.sendReply(event, result.replyText);
        await this.ordersService.markFacebookReplySent(
          event.channel,
          event.eventId,
        );
      }
      return;
    }

    if (match.kind === 'none') {
      const { greetingMessage } = await this.getPageSettings();
      const result = await this.ordersService.recordFacebookOutcome({
        channel: event.channel,
        eventId: event.eventId,
        senderId: event.senderId,
        status: 'greeting',
        replyText: greetingMessage || null,
      });
      if (!result.replyText || result.replySent) {
        return;
      }
      await this.sendReply(event, result.replyText);
      await this.ordersService.markFacebookReplySent(
        event.channel,
        event.eventId,
      );
      return;
    }

    if (match.kind === 'match') {
      if (match.items.length !== 1) {
        await this.sendWorkflowReply(
          event,
          'ambiguous',
          'Pour préparer votre commande, merci d’indiquer un seul article par message.',
        );
        return;
      }

      const item = match.items[0];
      if (!item) return;
      const product = item.product;
      if ((product.available ?? 0) <= 0) {
        await this.sendWorkflowReply(
          event,
          'out_of_stock',
          `Nous sommes désolés, ${product.nom} n’est actuellement plus disponible.`,
        );
        return;
      }

      const quantity = hasExplicitFacebookQuantity(event.text, product)
        ? item.quantity
        : null;
      if (event.customerName) {
        await this.ordersService.savePendingFacebookOrder(
          event.senderId,
          product.id,
          quantity,
          event.customerName,
        );
      } else {
        await this.ordersService.savePendingFacebookOrder(
          event.senderId,
          product.id,
          quantity,
        );
      }
      await this.sendWorkflowReply(
        event,
        'order-details',
        quantity === null
          ? 'Avec plaisir. Combien d’articles souhaitez-vous commander ?'
          : 'Merci. Pour préparer votre commande, veuillez indiquer votre numéro de téléphone.',
      );
      return;
    }

    const replyText =
      match.kind === 'ambiguous'
        ? 'Pour préparer votre commande, merci d’indiquer un seul article par message.'
        : 'La quantité doit être un nombre entier supérieur à zéro.';
    await this.sendWorkflowReply(event, match.kind, replyText);
  }

  private async processPendingOrder(
    event: IncomingFacebookEvent,
    pending: {
      productId: string;
      quantity: number | null;
      customerName?: string | null;
      customerPhone: string | null;
      deliveryAddress: string | null;
    },
    products: FacebookCatalogProduct[],
  ) {
    if (pending.quantity === null) {
      const quantity = parseFacebookQuantityReply(event.text);
      if (quantity === undefined || quantity === null) {
        await this.sendWorkflowReply(
          event,
          'order-details',
          'Merci d’indiquer la quantité souhaitée sous la forme d’un nombre entier positif.',
        );
        return;
      }
      const product = products.find(
        (candidate) => candidate.id === pending.productId,
      );
      const available = product?.available ?? 0;
      if (quantity > available) {
        await this.sendWorkflowReply(
          event,
          'order-details',
          `Nous avons actuellement ${available} article(s) disponible(s). Merci d’indiquer une quantité inférieure ou égale à ce stock.`,
        );
        return;
      }
      await this.ordersService.updatePendingFacebookOrder(event.senderId, {
        quantity,
      });
      await this.sendWorkflowReply(
        event,
        'order-details',
        'Merci. Pour préparer votre commande, veuillez indiquer votre numéro de téléphone.',
      );
      return;
    }

    if (!pending.customerPhone) {
      if (!isValidFacebookPhone(event.text)) {
        await this.sendWorkflowReply(
          event,
          'order-details',
          'Le numéro indiqué ne semble pas valide. Merci d’envoyer un numéro de téléphone joignable, avec l’indicatif du pays si nécessaire.',
        );
        return;
      }
      await this.ordersService.updatePendingFacebookOrder(event.senderId, {
        customerPhone: event.text.trim(),
      });
      await this.sendWorkflowReply(
        event,
        'order-details',
        'Merci. Veuillez maintenant indiquer l’adresse complète de livraison.',
      );
      return;
    }

    if (!pending.deliveryAddress) {
      const address = event.text.trim();
      if (address.length < 5) {
        await this.sendWorkflowReply(
          event,
          'order-details',
          'Merci d’indiquer une adresse de livraison suffisamment détaillée.',
        );
        return;
      }
      await this.ordersService.updatePendingFacebookOrder(event.senderId, {
        deliveryAddress: address,
      });
      const product = products.find(
        (candidate) => candidate.id === pending.productId,
      );
      const recap = [
        'Voici le récapitulatif de votre commande :',
        `Article : ${product?.nom ?? 'Article sélectionné'}`,
        `Quantité : ${pending.quantity}`,
        ...(product?.prix ? [`Prix unitaire : ${product.prix}`] : []),
        `Téléphone : ${pending.customerPhone}`,
        `Adresse de livraison : ${address}`,
        '',
        'Merci de vérifier ces informations. Répondez « CONFIRMER » pour valider la commande ou « ANNULER » pour l’abandonner.',
      ].join('\n');
      await this.sendWorkflowReply(event, 'order-confirmation', recap);
      return;
    }

    const confirmation = parseFacebookConfirmation(event.text);
    if (confirmation === undefined) {
      await this.sendWorkflowReply(
        event,
        'order-confirmation',
        'Pour finaliser votre commande, répondez « CONFIRMER ». Pour l’abandonner, répondez « ANNULER ».',
      );
      return;
    }
    if (!confirmation) {
      await this.ordersService.clearPendingFacebookOrder(event.senderId);
      await this.sendWorkflowReply(
        event,
        'order-cancelled',
        'Votre demande a été annulée. Aucune commande n’a été enregistrée.',
      );
      return;
    }

    const customerName =
      pending.customerName ??
      event.customerName ??
      (event.channel === 'messenger'
        ? await this.getMessengerCustomerName(event.senderId)
        : null);
    const result = await this.ordersService.createFacebookReservation({
      channel: event.channel,
      eventId: event.eventId,
      senderId: event.senderId,
      ...(customerName ? { customerName } : {}),
      customerPhone: pending.customerPhone,
      deliveryAddress: pending.deliveryAddress,
      items: [{ productId: pending.productId, quantity: pending.quantity }],
    });
    if (result.status === 'reserved' || result.status === 'out_of_stock') {
      await this.ordersService.clearPendingFacebookOrder(event.senderId);
    }
    if (result.replyText && !result.replySent) {
      await this.sendReply(event, result.replyText);
      await this.ordersService.markFacebookReplySent(
        event.channel,
        event.eventId,
      );
    }
  }

  private async sendWorkflowReply(
    event: IncomingFacebookEvent,
    status: string,
    replyText: string,
  ) {
    const result = await this.ordersService.recordFacebookOutcome({
      channel: event.channel,
      eventId: event.eventId,
      senderId: event.senderId,
      status,
      replyText,
    });
    if (!result.replyText || result.replySent) return;
    await this.sendReply(event, result.replyText);
    await this.ordersService.markFacebookReplySent(
      event.channel,
      event.eventId,
    );
  }

  private async sendReply(event: IncomingFacebookEvent, replyText: string) {
    if (event.channel === 'comment' && event.commentId) {
      try {
        await this.graph.sendCommentPrivateReply(event.commentId, replyText);
        return;
      } catch (error) {
        this.logger.warn(
          `Private reply failed for comment ${event.commentId}; trying the Messenger fallback: ${
            error instanceof Error ? error.message : 'Unknown Graph API error'
          }`,
        );
      }
    }

    await this.graph.sendMessengerReply(event.senderId, replyText);
  }

  private async getMessengerCustomerName(senderId: string) {
    try {
      return await this.graph.getMessengerProfileName(senderId);
    } catch (error) {
      this.logger.warn(
        `Could not retrieve a Messenger customer name; continuing without it: ${
          error instanceof Error ? error.message : 'Unknown Graph API error'
        }`,
      );
      return null;
    }
  }
}
