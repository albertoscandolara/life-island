import {
  mainPurchaseCategory,
  moneyChannel,
  purchaseDetails,
  splitsProblem,
  transactionRequestSchema,
} from './money.js';

describe('Money: parts and channels', () => {
  it('lets parts cover the movement, never more', () => {
    expect(splitsProblem(-192.75, [{ amount: 100 }, { amount: 92.75 }])).toBe(
      null,
    );
    expect(splitsProblem(-20, [{ amount: 20.01 }])).toMatch(/more than/);
  });

  it('takes parts and a channel on a movement', () => {
    const parsed = transactionRequestSchema.partial().parse({
      splits: [{ category: 'shopping', amount: 27.99 }],
      channel: 'online',
    });
    expect(parsed.splits).toEqual([{ category: 'shopping', amount: 27.99 }]);
    expect(() =>
      transactionRequestSchema
        .partial()
        .parse({ splits: [{ category: 'shopping', amount: 0 }] }),
    ).toThrow();
  });

  it('guesses online from the shop the bank names, unless you said', () => {
    expect(
      moneyChannel({ channel: null, description: 'AMZN Mktp IT*2K4' }),
    ).toBe('online');
    expect(moneyChannel({ channel: null, description: 'POS ESSELUNGA' })).toBe(
      'store',
    );
    expect(
      moneyChannel({ channel: 'store', description: 'PAYPAL *IKEA' }),
    ).toBe('store');
  });
});

describe('Money: what a receipt says', () => {
  const lines = [
    { name: 'Whole milk 1 L', amount: 1.29, category: 'groceries' as const },
    { name: 'Detergent x2', amount: 26.64, category: 'groceries' as const },
    { name: 'Bamboo placemats', amount: 27.99, category: 'shopping' as const },
    { name: 'Ibuprofen', amount: 4.5, category: 'health' as const },
  ];

  it('lists what was bought and puts the other categories in parts', () => {
    const details = purchaseDetails(lines, 'groceries', -60.42);
    expect(details.notes).toBe(
      'Bamboo placemats €27.99, Detergent x2 €26.64, Ibuprofen €4.50, Whole milk 1 L €1.29',
    );
    expect(details.splits).toEqual([
      { category: 'shopping', amount: 27.99 },
      { category: 'health', amount: 4.5 },
    ]);
  });

  it('leaves the parts out when they do not fit the movement', () => {
    expect(purchaseDetails(lines, 'groceries', -10).splits).toEqual([]);
    expect(purchaseDetails([], 'groceries', -10)).toEqual({
      notes: null,
      splits: [],
    });
  });

  it('finds the category most of the money went to', () => {
    expect(mainPurchaseCategory(lines)).toBe('shopping');
    expect(mainPurchaseCategory([])).toBe(null);
  });
});
