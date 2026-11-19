import { isNotAProduct } from '@life-island/contracts';
import { basketChange, itemStats, type PurchaseLine } from './stats.js';

const line = (name: string, date: string, unitPrice: number | null) =>
  ({
    name,
    category: 'pantry',
    date,
    unitPrice,
    lineTotal: unitPrice ?? 1,
    merchant: 'Esselunga',
  }) as PurchaseLine;

describe('your grocery inflation', () => {
  const today = '2026-11-18';

  it('weights each item by how often you bought it in the last year', () => {
    const basket = basketChange(
      [
        // Pasta: 1.00 then, 1.10 now, bought 3 times: +10%.
        line('pasta', '2025-03-01', 1),
        line('pasta', '2026-02-01', 1.1),
        line('pasta', '2026-05-01', 1.1),
        line('pasta', '2026-09-01', 1.1),
        // Milk: 2.00 then, 1.90 now, once: -5%.
        line('milk', '2025-06-01', 2),
        line('milk', '2026-10-01', 1.9),
        // Only this year, or with no price: left out.
        line('coffee', '2026-10-01', 4),
        line('bread', '2025-06-01', null),
        line('bread', '2026-06-01', 2),
        // More than two years ago: left out.
        line('rice', '2024-10-01', 1),
        line('rice', '2026-10-01', 3),
      ],
      today,
    );
    expect(basket.items).toBe(2);
    // (0.10 × 3 − 0.05 × 1) / 4 = 0.0625.
    expect(basket.change).toBe(0.063);
    expect(basket.risers).toEqual([{ name: 'pasta', change: 0.1 }]);
    expect(basket.officialPct).toBe(2.5);
    expect(basket.officialLabel).toBe('ISTAT FOI 2026, January to September');
  });

  it('says nothing without items in both years', () => {
    expect(basketChange([line('pasta', '2026-10-01', 1)], today).change).toBe(
      null,
    );
  });
});

describe('what you buy', () => {
  it('leaves out lines that are not a product', () => {
    for (const name of [
      'VAT Italy 22%',
      'IVA 22%',
      'Imposta di bollo',
      'Shopping bag',
      'Shopper',
      'Sacchetto biodegradabile',
      'Busta spesa',
      'Sconto fedeltà',
      'Spese di spedizione',
      'Arrotondamento',
      'Totale',
    ])
      expect(isNotAProduct(name)).toBe(true);
    for (const name of [
      'Mortadella',
      'Trash bags 30 L',
      'De Cecco semolina pasta 500 g',
      'Ivanhoe biscuits',
      'Vaticano wine',
    ])
      expect(isNotAProduct(name)).toBe(false);

    const items = itemStats([
      line('Mortadella', '2026-11-19', 6.54),
      line('Shopping bag', '2026-11-19', 0.1),
      line('VAT Italy 22%', '2026-11-19', 4.4),
    ]);
    expect(items.map((i) => i.name)).toEqual(['Mortadella']);
  });

  it('joins names without case and adds what you keep about the item', () => {
    const items = itemStats(
      [
        line('whole milk 1 L', '2026-10-01', 1.5),
        line('Whole milk 1 L', '2026-11-01', 1.6),
        line('Removed thing', '2026-11-01', 2),
      ],
      new Map([
        [
          'whole milk 1 l',
          {
            id: 'p1',
            link: 'https://shop.example/milk',
            imageUpdatedAt: new Date(1000),
            hidden: false,
          },
        ],
        [
          'removed thing',
          { id: 'p2', link: null, imageUpdatedAt: null, hidden: true },
        ],
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'p1',
      name: 'Whole milk 1 L',
      link: 'https://shop.example/milk',
      imageVersion: 1000,
      purchases: 2,
      priceChange: 0.07,
    });
  });
});
