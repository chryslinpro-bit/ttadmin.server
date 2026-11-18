export interface FacebookCatalogProduct {
  id: string;
  nom: string;
  keywords: string[];
  description?: string;
  prix?: string;
  available?: number;
}

export interface ParsedFacebookOrderItem {
  product: FacebookCatalogProduct;
  quantity: number;
}

export type FacebookProductMatch =
  | { kind: 'match'; items: ParsedFacebookOrderItem[] }
  | { kind: 'ambiguous' }
  | { kind: 'invalid-quantity' }
  | { kind: 'none' };

interface KeywordMatch {
  start: number;
  end: number;
  phraseLength: number;
  product: FacebookCatalogProduct;
}

const WRITTEN_NUMBERS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

function tokenize(value: string): string[] {
  return (
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function isFacebookAvailabilityInquiry(message: string) {
  const tokens = tokenize(message);
  return (
    tokens.some((token) =>
      ['disponible', 'disponibles', 'dispo', 'reste', 'restant'].includes(
        token,
      ),
    ) ||
    (tokens.includes('en') && tokens.includes('stock'))
  );
}

export function parseFacebookQuantityReply(message: string) {
  const tokens = tokenize(message);
  const quantityWords = new Set([...Object.keys(WRITTEN_NUMBERS), '0']);
  const quantityIndexes = tokens.flatMap((token, index) =>
    /^\d+$/.test(token) || quantityWords.has(token) ? [index] : [],
  );
  if (quantityIndexes.length !== 1) return undefined;

  const quantityIndex = quantityIndexes[0];
  if (quantityIndex === undefined) return undefined;
  const allowedContext = new Set([
    'je',
    'veux',
    'vais',
    'voudrais',
    'aimerais',
    'prends',
    'prendrai',
    'commande',
    'commander',
    'en',
    'prendre',
    'oui',
    'svp',
    'stp',
    'merci',
    's',
    'il',
    'vous',
    'plait',
    'quantite',
    'quantites',
    'piece',
    'pieces',
    'article',
    'articles',
    'exemplaire',
    'exemplaires',
  ]);
  if (
    tokens.some(
      (token, index) => index !== quantityIndex && !allowedContext.has(token),
    )
  ) {
    return undefined;
  }

  const quantity = quantityAt(tokens, quantityIndex);
  return quantity !== undefined &&
    Number.isSafeInteger(quantity) &&
    quantity > 0
    ? quantity
    : null;
}

export function hasExplicitFacebookQuantity(
  message: string,
  product: FacebookCatalogProduct,
) {
  const tokens = tokenize(message);
  const aliases = new Set([product.nom, ...product.keywords]);
  for (const alias of aliases) {
    const phrase = tokenize(alias);
    if (phrase.length === 0) continue;

    for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
      if (!phrase.every((word, index) => tokens[start + index] === word)) {
        continue;
      }
      const end = start + phrase.length;
      if (
        quantityAt(tokens, start - 1) !== undefined ||
        (tokens[start - 1] === 'x' &&
          quantityAt(tokens, start - 2) !== undefined) ||
        quantityAt(tokens, end) !== undefined ||
        (tokens[end] === 'x' && quantityAt(tokens, end + 1) !== undefined)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function parseFacebookConfirmation(message: string) {
  const tokens = tokenize(message);
  const affirmative = new Set([
    'oui',
    'je',
    'confirme',
    'confirmer',
    'confirmez',
    'daccord',
    'ok',
    'okay',
    'valide',
    'valider',
    'c',
    'est',
    'bon',
    'tout',
    'correct',
    'exact',
  ]);
  const negative = new Set(['non', 'annule', 'annuler', 'annulation', 'merci']);
  if (tokens.length === 0) return undefined;
  if (tokens.every((token) => affirmative.has(token))) return true;
  if (tokens.every((token) => negative.has(token))) return false;
  return undefined;
}

export function isValidFacebookPhone(message: string) {
  const phone = message.trim();
  const digits = phone.replace(/\D/g, '');
  return (
    digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(phone)
  );
}

function quantityAt(tokens: string[], index: number) {
  const token = tokens[index];
  if (!token) return undefined;
  const compactQuantity = /^x(\d+)$/.exec(token)?.[1];
  const quantity = compactQuantity
    ? Number(compactQuantity)
    : /^\d+$/.test(token)
      ? Number(token)
      : WRITTEN_NUMBERS[token];
  return quantity;
}

function parseQuantity(tokens: string[], match: KeywordMatch) {
  const beforeMarker = tokens[match.start - 1] === 'x';
  const beforeIndex = beforeMarker ? match.start - 2 : match.start - 1;
  const beforeQuantity = quantityAt(tokens, beforeIndex);

  const afterMarker = tokens[match.end] === 'x';
  const afterIndex = afterMarker ? match.end + 1 : match.end;
  const afterQuantity = quantityAt(tokens, afterIndex);

  if (beforeQuantity !== undefined && afterQuantity !== undefined) {
    return beforeQuantity === afterQuantity ? beforeQuantity : Number.NaN;
  }
  return beforeQuantity ?? afterQuantity ?? 1;
}

function findKeywordMatches(
  tokens: string[],
  products: FacebookCatalogProduct[],
) {
  const matches: KeywordMatch[] = [];
  for (const product of products) {
    const aliases = new Set([product.nom, ...product.keywords]);
    for (const alias of aliases) {
      const phrase = tokenize(alias);
      if (phrase.length === 0) continue;

      for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
        const matchesPhrase = phrase.every(
          (word, index) => tokens[start + index] === word,
        );
        if (matchesPhrase) {
          matches.push({
            start,
            end: start + phrase.length,
            phraseLength: phrase.length,
            product,
          });
        }
      }
    }
  }
  return matches;
}

export function matchFacebookProductMessage(
  message: string,
  products: FacebookCatalogProduct[],
): FacebookProductMatch {
  const tokens = tokenize(message);
  if (tokens.length === 0) return { kind: 'none' };

  const candidates = findKeywordMatches(tokens, products).sort(
    (left, right) =>
      left.start - right.start ||
      right.phraseLength - left.phraseLength ||
      left.product.id.localeCompare(right.product.id),
  );
  if (candidates.length === 0) return { kind: 'none' };

  const selected: KeywordMatch[] = [];
  let nextAvailableToken = 0;
  let candidateIndex = 0;
  while (candidateIndex < candidates.length) {
    const start = candidates[candidateIndex]?.start;
    if (start === undefined) break;
    let groupEnd = candidateIndex + 1;
    while (candidates[groupEnd]?.start === start) groupEnd += 1;
    const group = candidates.slice(candidateIndex, groupEnd);
    candidateIndex = groupEnd;
    if (start < nextAvailableToken) continue;

    const longest = group[0]?.phraseLength;
    if (longest === undefined) continue;
    const mostSpecific = group.filter(
      (candidate) => candidate.phraseLength === longest,
    );
    const productIds = new Set(
      mostSpecific.map((candidate) => candidate.product.id),
    );
    if (productIds.size > 1) return { kind: 'ambiguous' };

    const match = mostSpecific[0];
    if (!match) continue;
    selected.push(match);
    nextAvailableToken = match.end;
  }
  if (selected.length === 0) return { kind: 'none' };
  if (new Set(selected.map((match) => match.product.id)).size > 1) {
    return { kind: 'ambiguous' };
  }

  const quantities = new Map<string, ParsedFacebookOrderItem>();
  for (const match of selected) {
    const quantity = parseQuantity(tokens, match);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return { kind: 'invalid-quantity' };
    }
    const current = quantities.get(match.product.id);
    const total = (current?.quantity ?? 0) + quantity;
    if (!Number.isSafeInteger(total)) return { kind: 'invalid-quantity' };
    quantities.set(match.product.id, {
      product: match.product,
      quantity: total,
    });
  }

  return { kind: 'match', items: [...quantities.values()] };
}
