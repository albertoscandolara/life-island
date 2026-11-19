import { AI_TOOLS, type ReceiptReadingOutput } from '@life-island/contracts';
import { checkReceiptFiles, cleanReading, RECEIPT_TOOL } from './receipts.js';

const reading = (
  change: Partial<ReceiptReadingOutput> = {},
): ReceiptReadingOutput => ({
  merchant: ' Amazon ',
  date: '2026-11-11',
  total: 192.75,
  channel: 'online',
  category: 'groceries',
  splits: [],
  note: 'ACE detergent x2 €26.64, placemats €27.99',
  items: [{ name: 'Placemats', amount: 27.99 }],
  ...change,
});

describe('the receipt reader', () => {
  it('is registered in AI_TOOLS', () => {
    expect(AI_TOOLS.some((t) => t.id === RECEIPT_TOOL)).toBe(true);
  });

  it('keeps a reading safe to apply', () => {
    const clean = cleanReading(
      reading({
        date: '11/11/2026',
        total: -192.75,
        splits: [
          { category: 'shopping', amount: 20 },
          { category: 'shopping', amount: 7.99 },
          { category: 'groceries', amount: 50 }, // its own category
          { category: 'health', amount: 0 },
        ],
      }),
    );
    expect(clean.merchant).toBe('Amazon');
    expect(clean.date).toBe('');
    expect(clean.total).toBe(192.75);
    expect(clean.splits).toEqual([{ category: 'shopping', amount: 27.99 }]);
  });

  it('drops parts that add up to more than the total', () => {
    const clean = cleanReading(
      reading({ total: 20, splits: [{ category: 'shopping', amount: 27.99 }] }),
    );
    expect(clean.splits).toEqual([]);
  });

  it('takes photos and PDFs only, a few at a time', () => {
    const file = (contentType: string, size = 10) => ({
      name: 'r',
      contentType,
      data: Buffer.alloc(size),
    });
    expect(() => checkReceiptFiles([])).toThrow(/at least one/);
    expect(() => checkReceiptFiles([file('text/plain')])).toThrow(/JPEG/);
    expect(() =>
      checkReceiptFiles([file('image/jpeg', 11 * 1024 * 1024)]),
    ).toThrow(/at most 10 MB/);
    expect(() =>
      checkReceiptFiles(Array.from({ length: 7 }, () => file('image/png'))),
    ).toThrow(/at most 6/);
    expect(() =>
      checkReceiptFiles([
        file('image/jpeg; charset=x'),
        file('application/pdf'),
      ]),
    ).not.toThrow();
  });
});
