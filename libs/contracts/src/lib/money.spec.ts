import {
  moneyChannel,
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
