import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FacebookGraphService } from './facebook-graph.service.js';
import { FacebookService } from './facebook.service.js';

describe('FacebookService', () => {
  let service: FacebookService;
  const prisma = {
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    facebookPageSettings: {
      upsert: vi.fn(),
    },
  };
  const ordersService = {
    createFacebookReservation: vi.fn(),
    recordFacebookOutcome: vi.fn(),
    markFacebookReplySent: vi.fn(),
    savePendingFacebookOrder: vi.fn(),
    getPendingFacebookOrder: vi.fn(),
    updatePendingFacebookOrder: vi.fn(),
    clearPendingFacebookOrder: vi.fn(),
  };
  const graph = {
    ensureConfigured: vi.fn(),
    getMessengerLink: vi.fn(),
    getMessengerProfileName: vi.fn(),
    publishPagePost: vi.fn(),
    sendCommentPrivateReply: vi.fn(),
    sendMessengerReply: vi.fn(),
  };
  const originalPageId = process.env.FACEBOOK_PAGE_ID;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.FACEBOOK_PAGE_ID = 'page-1';
    graph.getMessengerLink.mockReturnValue('https://m.me/page-1');
    graph.getMessengerProfileName.mockResolvedValue(null);
    graph.publishPagePost.mockResolvedValue('published-1');
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        nom: 'Robe bleue',
        keywords: ['robe azur'],
        description: 'Robe légère en coton',
        prix: '25 000 Ar',
        available: 4,
      },
      {
        id: 'product-2',
        nom: 'Sac rouge',
        keywords: ['sac'],
        description: 'Sac en cuir',
        prix: '50 000 Ar',
        available: 2,
      },
    ]);
    prisma.facebookPageSettings.upsert.mockResolvedValue({
      greetingMessage:
        'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.',
      updatedAt: new Date(),
    });
    ordersService.createFacebookReservation.mockResolvedValue({
      status: 'reserved',
      orderId: 'order-1',
      replyText: 'Réservation confirmée',
      replySent: false,
      duplicate: false,
    });
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'ambiguous',
      orderId: null,
      replyText: 'Nom ambigu',
      replySent: false,
      duplicate: false,
    });
    ordersService.getPendingFacebookOrder.mockReset().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: FacebookGraphService, useValue: graph },
      ],
    }).compile();

    service = module.get(FacebookService);
  });

  afterAll(() => {
    if (originalPageId === undefined) {
      delete process.env.FACEBOOK_PAGE_ID;
    } else {
      process.env.FACEBOOK_PAGE_ID = originalPageId;
    }
  });

  it('asks for contact details instead of reserving an item from a comment', async () => {
    ordersService.recordFacebookOutcome.mockImplementationOnce(
      async (input: { replyText: string }) => ({
        status: 'order-details',
        orderId: null,
        replyText: input.replyText,
        replySent: false,
        duplicate: false,
      }),
    );
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-1',
                from: { id: 'customer-1', name: 'Aina Rakoto' },
                message: 'Robe bleue 2',
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.savePendingFacebookOrder).toHaveBeenCalledWith(
      'customer-1',
      'product-1',
      2,
      'Aina Rakoto',
    );
    expect(graph.sendCommentPrivateReply).toHaveBeenCalledWith(
      'comment-1',
      'Merci. Pour préparer votre commande, veuillez indiquer votre numéro de téléphone.',
    );
    expect(graph.sendMessengerReply).not.toHaveBeenCalled();
    expect(ordersService.markFacebookReplySent).toHaveBeenCalledWith(
      'comment',
      'comment-1',
    );
  });

  it('asks which product the customer wants to order for unrecognized Messenger messages', async () => {
    const greeting =
      'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.';
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'greeting',
      orderId: null,
      replyText: greeting,
      replySent: false,
      duplicate: false,
    });
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'message-welcome', text: 'Bonjour !' },
            },
          ],
        },
      ],
    });

    expect(ordersService.recordFacebookOutcome).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'message-welcome',
      senderId: 'customer-1',
      status: 'greeting',
      replyText: greeting,
    });
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      greeting,
    );
    expect(greeting).toContain('Quel produit souhaitez-vous commander ?');
    expect(ordersService.markFacebookReplySent).toHaveBeenCalledWith(
      'messenger',
      'message-welcome',
    );
  });

  it('asks which product the customer wants to order in a private comment reply', async () => {
    const greeting =
      'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.';
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'greeting',
      orderId: null,
      replyText: greeting,
      replySent: false,
      duplicate: false,
    });
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-welcome',
                from: { id: 'customer-1' },
                message: 'Avez-vous une boutique ?',
              },
            },
          ],
        },
      ],
    });

    expect(graph.sendCommentPrivateReply).toHaveBeenCalledWith(
      'comment-welcome',
      greeting,
    );
    expect(greeting).toContain('Quel produit souhaitez-vous commander ?');
  });

  it('uses Messenger when a comment private reply is refused', async () => {
    graph.sendCommentPrivateReply.mockRejectedValueOnce(
      new Error('Private replies are unavailable'),
    );
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'greeting',
      orderId: null,
      replyText:
        'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.',
      replySent: false,
      duplicate: false,
    });

    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-fallback',
                from: { id: 'customer-1' },
                message: 'Avez-vous une boutique ?',
              },
            },
          ],
        },
      ],
    });

    expect(graph.sendCommentPrivateReply).toHaveBeenCalledWith(
      'comment-fallback',
      expect.stringContaining('Quel produit souhaitez-vous commander ?'),
    );
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      expect.stringContaining('Quel produit souhaitez-vous commander ?'),
    );
    expect(ordersService.markFacebookReplySent).toHaveBeenCalledWith(
      'comment',
      'comment-fallback',
    );
  });

  it('answers availability questions before asking the customer for a quantity', async () => {
    const replyText =
      'Robe bleue est disponible (4 en stock).\n\nRobe légère en coton.\n\nPrix : 25 000 Ar\n\nCombien souhaitez-vous en commander ?';
    ordersService.recordFacebookOutcome.mockResolvedValueOnce({
      status: 'availability-inquiry',
      orderId: null,
      replyText,
      replySent: false,
      duplicate: false,
    });
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'availability-1',
                text: 'La robe bleue est-elle encore disponible ?',
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.savePendingFacebookOrder).toHaveBeenCalledWith(
      'customer-1',
      'product-1',
      null,
    );
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      replyText,
    );
  });

  it('saves the requested quantity and asks for a phone number', async () => {
    ordersService.getPendingFacebookOrder.mockResolvedValue({
      productId: 'product-1',
      quantity: null,
      customerPhone: null,
      deliveryAddress: null,
    });
    ordersService.recordFacebookOutcome.mockImplementationOnce(
      async (input: { replyText: string }) => ({
        status: 'order-details',
        orderId: null,
        replyText: input.replyText,
        replySent: false,
        duplicate: false,
      }),
    );
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'quantity-1', text: 'Je voudrais 2, merci' },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.updatePendingFacebookOrder).toHaveBeenCalledWith(
      'customer-1',
      { quantity: 2 },
    );
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Merci. Pour préparer votre commande, veuillez indiquer votre numéro de téléphone.',
    );
  });

  it('creates an order only after contact details are reviewed and confirmed', async () => {
    graph.getMessengerProfileName.mockResolvedValue('Aina Rakoto');
    ordersService.getPendingFacebookOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        productId: 'product-1',
        quantity: 2,
        customerPhone: null,
        deliveryAddress: null,
      })
      .mockResolvedValueOnce({
        productId: 'product-1',
        quantity: 2,
        customerPhone: '+261 34 12 345 67',
        deliveryAddress: null,
      })
      .mockResolvedValueOnce({
        productId: 'product-1',
        quantity: 2,
        customerName: null,
        customerPhone: '+261 34 12 345 67',
        deliveryAddress: 'Lot II A 25, Analamahitsy, Antananarivo',
      });
    ordersService.recordFacebookOutcome.mockImplementation(
      async (input: { replyText: string }) => ({
        status: 'order-details',
        orderId: null,
        replyText: input.replyText,
        replySent: false,
        duplicate: false,
      }),
    );
    const sendMessage = async (mid: string, text: string) => {
      await service.handleWebhook({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              {
                sender: { id: 'customer-1' },
                recipient: { id: 'page-1' },
                message: { mid, text },
              },
            ],
          },
        ],
      });
    };

    await sendMessage('start-order', '2 robe bleue');
    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();

    await sendMessage('phone', '+261 34 12 345 67');
    expect(ordersService.updatePendingFacebookOrder).toHaveBeenCalledWith(
      'customer-1',
      { customerPhone: '+261 34 12 345 67' },
    );
    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();

    await sendMessage('address', 'Lot II A 25, Analamahitsy, Antananarivo');
    expect(graph.sendMessengerReply).toHaveBeenLastCalledWith(
      'customer-1',
      expect.stringContaining(
        'Répondez « CONFIRMER » pour valider la commande',
      ),
    );
    expect(graph.sendMessengerReply).toHaveBeenLastCalledWith(
      'customer-1',
      expect.stringContaining('Téléphone : +261 34 12 345 67'),
    );
    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();

    await sendMessage('confirm', 'Je confirme');
    expect(ordersService.createFacebookReservation).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'confirm',
      senderId: 'customer-1',
      customerName: 'Aina Rakoto',
      customerPhone: '+261 34 12 345 67',
      deliveryAddress: 'Lot II A 25, Analamahitsy, Antananarivo',
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    expect(graph.getMessengerProfileName).toHaveBeenCalledWith('customer-1');
  });

  it('still confirms a Messenger order when the profile name is unavailable', async () => {
    ordersService.getPendingFacebookOrder.mockResolvedValue({
      productId: 'product-1',
      quantity: 1,
      customerName: null,
      customerPhone: '+261 34 12 345 67',
      deliveryAddress: 'Lot II A 25, Analamahitsy',
    });
    graph.getMessengerProfileName.mockRejectedValue(
      new Error('Profile access is unavailable'),
    );

    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'confirm-without-profile', text: 'CONFIRMER' },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'confirm-without-profile',
      senderId: 'customer-1',
      customerPhone: '+261 34 12 345 67',
      deliveryAddress: 'Lot II A 25, Analamahitsy',
      items: [{ productId: 'product-1', quantity: 1 }],
    });
  });

  it('adds the Messenger link to a post when requested', async () => {
    await service.publishPagePost('Nouvelle collection', undefined, true);

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Nouvelle collection\n\nÉcrivez-nous sur Messenger : https://m.me/page-1',
      undefined,
    );
  });

  it('publishes an unpublished product with its details and records the post ID', async () => {
    prisma.product.findFirst
      .mockResolvedValueOnce({
        id: 'product-1',
        nom: 'Robe bleue',
        description: 'Robe légère en coton',
        prix: '25 000 Ar',
        imageUrl: null,
        facebookPostId: null,
      })
      .mockResolvedValueOnce({
        id: 'product-1',
        facebookPostId: null,
      });
    prisma.product.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.publishProduct('product-1')).resolves.toBe(
      'published-1',
    );

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Nouveau produit : Robe bleue\n\nRobe légère en coton\n\nPrix : 25 000 Ar\n\nÉcrivez-nous sur Messenger : https://m.me/page-1',
      undefined,
    );
    expect(prisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'product-1',
          deletedAt: null,
          facebookPostId: null,
        },
        data: expect.objectContaining({ facebookPostId: 'published-1' }),
      }),
    );
  });

  it('does not publish a product that already has a Facebook post', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1',
      facebookPostId: 'existing-post',
    });

    await expect(service.publishProduct('product-1')).rejects.toThrow(
      'The product has already been published',
    );
    expect(graph.publishPagePost).not.toHaveBeenCalled();
  });

  it('does not duplicate a Messenger link already in the post', async () => {
    await service.publishPagePost(
      'Contactez-nous : https://m.me/page-1',
      undefined,
      true,
    );

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Contactez-nous : https://m.me/page-1',
      undefined,
    );
  });

  it('rejects a post if adding the Messenger link exceeds the text limit', async () => {
    await expect(
      service.publishPagePost('a'.repeat(5000), undefined, true),
    ).rejects.toThrow('Publication text cannot exceed 5000 characters');
    expect(graph.publishPagePost).not.toHaveBeenCalled();
  });

  it('starts the confirmation flow for a Messenger order and skips echoes and other pages', async () => {
    ordersService.recordFacebookOutcome.mockImplementationOnce(
      async (input: { replyText: string }) => ({
        status: 'order-details',
        orderId: null,
        replyText: input.replyText,
        replySent: false,
        duplicate: false,
      }),
    );
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'another-page',
          messaging: [
            {
              sender: { id: 'customer-ignored' },
              message: { mid: 'echo-1', text: 'Robe bleue' },
            },
          ],
        },
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'message-1',
                text: '2 robe azur',
                is_echo: false,
              },
            },
            {
              sender: { id: 'page-1' },
              message: {
                mid: 'echo-2',
                text: 'Robe bleue',
                is_echo: true,
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.savePendingFacebookOrder).toHaveBeenCalledWith(
      'customer-1',
      'product-1',
      2,
    );
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Merci. Pour préparer votre commande, veuillez indiquer votre numéro de téléphone.',
    );
  });

  it('asks customers to split requests for different products', async () => {
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'message-multiple-products',
                text: '2 robe azur et sac',
                is_echo: false,
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.recordFacebookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'messenger',
        eventId: 'message-multiple-products',
        senderId: 'customer-1',
        status: 'ambiguous',
        replyText:
          'Pour préparer votre commande, merci d’indiquer un seul article par message.',
      }),
    );
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Nom ambigu',
    );
  });
});
