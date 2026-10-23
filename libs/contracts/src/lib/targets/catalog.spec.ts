import {
  catalogForApi,
  CATEGORIES,
  findTarget,
  TARGET_CATALOG,
} from './catalog.js';
import { GroceryReceiptV1 } from './grocery-receipt.js';
import { Tax730ExpenseV1 } from './tax730-expense.js';

const receipt = {
  merchant: { name: 'Esselunga' },
  purchasedAt: '2026-10-20T18:30:00Z',
  currency: 'EUR',
  total: 3.69,
  items: [
    {
      rawName: 'LATTE',
      normalizedName: 'Milk',
      category: 'dairy',
      quantity: 1,
      lineTotal: 1.29,
    },
    {
      rawName: 'PANE',
      normalizedName: 'Bread',
      category: 'bakery',
      quantity: 1,
      lineTotal: 2.4,
    },
  ],
};

describe('target catalog', () => {
  it('has unique, versioned target keys and a category for each', () => {
    const keys = TARGET_CATALOG.map((target) => target.targetKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+@\d+$/);
    expect(CATEGORIES).toEqual(['groceries', 'tax730', 'other']);
    expect(findTarget('grocery.receipt@1')?.category).toBe('groceries');
    expect(findTarget('grocery.receipt@9')).toBeUndefined();
  });

  it('publishes a JSON Schema per target, with closed objects as structured outputs require', () => {
    for (const entry of catalogForApi()) {
      const schema = entry.jsonSchema as {
        type: string;
        additionalProperties: boolean;
        properties: object;
      };
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties).length).toBeGreaterThan(2);
    }
  });
});

describe('grocery.receipt@1', () => {
  it('accepts a receipt whose lines add up', () => {
    expect(GroceryReceiptV1.safeParse(receipt).success).toBe(true);
  });

  it('flags lines that do not add up to the total', () => {
    const result = GroceryReceiptV1.safeParse({ ...receipt, total: 10 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['total']);
  });

  it('rejects a date that is not ISO 8601', () => {
    expect(
      GroceryReceiptV1.safeParse({ ...receipt, purchasedAt: '20/10/2026' })
        .success,
    ).toBe(false);
  });
});

describe('tax730.expense@1', () => {
  const expense = {
    taxYear: 2026,
    expenseType: 'medicines',
    date: '2026-10-01',
    amount: 18.9,
    issuer: 'Farmacia Centrale',
  };

  it('accepts a consistent expense', () => {
    expect(Tax730ExpenseV1.safeParse(expense).success).toBe(true);
  });

  it('flags a tax year that does not match the date', () => {
    expect(
      Tax730ExpenseV1.safeParse({ ...expense, taxYear: 2025 }).success,
    ).toBe(false);
  });
});
