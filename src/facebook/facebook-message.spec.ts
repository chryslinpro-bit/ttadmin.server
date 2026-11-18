import {
  hasExplicitFacebookQuantity,
  isFacebookAvailabilityInquiry,
  isValidFacebookPhone,
  matchFacebookProductMessage,
  parseFacebookConfirmation,
  parseFacebookQuantityReply,
} from './facebook-message.js';

describe('matchFacebookProductMessage', () => {
  const products = [
    {
      id: '1',
      nom: 'Robe bleue',
      keywords: ['robe azur', 'robe bleu'],
    },
    { id: '2', nom: 'Sac rouge', keywords: ['sac à main', 'sac'] },
    { id: '3', nom: 'Robe noire', keywords: ['robe sombre'] },
  ];

  it('matches the product name and configured keywords without accents or case sensitivity', () => {
    expect(matchFacebookProductMessage('ROBE AZUR', products)).toEqual({
      kind: 'match',
      items: [{ product: products[0], quantity: 1 }],
    });
    expect(
      matchFacebookProductMessage('je veux une robe a main', products),
    ).toEqual({
      kind: 'none',
    });
    expect(
      matchFacebookProductMessage('Je veux un sac a main', products),
    ).toEqual({
      kind: 'match',
      items: [{ product: products[1], quantity: 1 }],
    });
  });

  describe('Facebook conversation intent helpers', () => {
    it('recognizes availability questions', () => {
      expect(
        isFacebookAvailabilityInquiry(
          'La robe bleue est-elle encore disponible ?',
        ),
      ).toBe(true);
      expect(
        isFacebookAvailabilityInquiry('Avez-vous deux robes bleues ?'),
      ).toBe(false);
    });

    it('parses a quantity-only answer without matching arbitrary numbers in text', () => {
      expect(parseFacebookQuantityReply('Je voudrais 2, merci')).toBe(2);
      expect(parseFacebookQuantityReply('deux')).toBe(2);
      expect(parseFacebookQuantityReply('0')).toBeNull();
      expect(parseFacebookQuantityReply('Je passerai demain à 2 heures')).toBe(
        undefined,
      );
    });

    it('recognizes explicit confirmation and cancellation replies', () => {
      expect(parseFacebookConfirmation('Je confirme')).toBe(true);
      expect(parseFacebookConfirmation('oui')).toBe(true);
      expect(parseFacebookConfirmation('Oui, tout est correct')).toBe(true);
      expect(parseFacebookConfirmation('non merci')).toBe(false);
      expect(parseFacebookConfirmation('je vais confirmer demain')).toBe(
        undefined,
      );
    });

    it('validates phone numbers and detects an explicit product quantity', () => {
      expect(isValidFacebookPhone('+261 34 12 345 67')).toBe(true);
      expect(isValidFacebookPhone('appelez-moi demain')).toBe(false);
      expect(
        hasExplicitFacebookQuantity('Je commande 2 robe bleue', products[0]!),
      ).toBe(true);
      expect(hasExplicitFacebookQuantity('La robe bleue', products[0]!)).toBe(
        false,
      );
    });
  });

  it('parses quantities before or after a keyword phrase', () => {
    expect(
      matchFacebookProductMessage('Je veux 2 robe bleue', products),
    ).toEqual({
      kind: 'match',
      items: [{ product: products[0], quantity: 2 }],
    });
    expect(
      matchFacebookProductMessage('Je veux sac rouge x3', products),
    ).toEqual({
      kind: 'match',
      items: [{ product: products[1], quantity: 3 }],
    });
  });

  it('accepts French number words and aggregates repeated products', () => {
    expect(
      matchFacebookProductMessage('deux robe azur et une robe bleue', products),
    ).toEqual({
      kind: 'match',
      items: [{ product: products[0], quantity: 3 }],
    });
  });

  it('requires separate messages when more than one product is requested', () => {
    expect(
      matchFacebookProductMessage(
        'Bonjour, je prends sac à main 1 et robe sombre 2',
        products,
      ),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('rejects invalid quantities', () => {
    expect(matchFacebookProductMessage('Sac rouge 0', products)).toEqual({
      kind: 'invalid-quantity',
    });
    expect(
      matchFacebookProductMessage('Sac rouge 9007199254740992', products),
    ).toEqual({ kind: 'invalid-quantity' });
    expect(matchFacebookProductMessage('un sac rouge 2', products)).toEqual({
      kind: 'invalid-quantity',
    });
  });

  it('does not match partial words or unrelated messages', () => {
    expect(matchFacebookProductMessage('robe', products)).toEqual({
      kind: 'none',
    });
    expect(matchFacebookProductMessage('bonjour', products)).toEqual({
      kind: 'none',
    });
  });

  it('rejects keywords shared by different products as ambiguous', () => {
    expect(
      matchFacebookProductMessage('sac', [
        ...products,
        { id: '4', nom: 'Petit sac', keywords: ['sac'] },
      ]),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('prefers the most specific phrase when product names overlap', () => {
    expect(
      matchFacebookProductMessage('robe noire', [
        { id: '5', nom: 'Robe', keywords: [] },
        { id: '6', nom: 'Robe noire', keywords: [] },
      ]),
    ).toEqual({
      kind: 'match',
      items: [
        {
          product: { id: '6', nom: 'Robe noire', keywords: [] },
          quantity: 1,
        },
      ],
    });
  });
});
