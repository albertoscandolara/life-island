import { suggestMatches } from '@life-island/contracts';
import {
  receiptDaysFor,
  receiptOfPayable,
  receiptPayableKey,
  receiptPayables,
  type PayableReceipt,
} from './payables.js';

const ID = '3c1c2b3a-1111-4222-8333-944455556666';

const receipt = (over: Partial<PayableReceipt> = {}): PayableReceipt => ({
  id: ID,
  merchant: 'Esselunga',
  day: '2026-11-14',
  total: 63.27,
  currency: 'EUR',
  paymentMethod: 'card',
  ...over,
});
const query = { from: '2026-11-01', to: '2026-11-30' };

describe('receipts as money going out', () => {
  it('keys a receipt and reads it back', () => {
    expect(receiptOfPayable(receiptPayableKey(ID))).toBe(ID);
    expect(receiptOfPayable('groceries:receipt:x')).toBeNull();
  });

  it('lists a receipt paid by card, booked up to 5 days later', () => {
    expect(receiptPayables([receipt()], query)).toEqual([
      {
        key: receiptPayableKey(ID),
        module: 'groceries',
        kind: 'receipt',
        title: 'Esselunga, receipt of 2026-11-14',
        payees: ['Esselunga'],
        amount: 63.27,
        direction: 'out',
        date: '2026-11-14',
        window: { from: '2026-11-13', to: '2026-11-19' },
        path: '/groceries',
      },
    ]);
    // Paid without saying how: still looked for.
    expect(
      receiptPayables([receipt({ paymentMethod: null })], query),
    ).toHaveLength(1);
  });

  it('never lists cash, meal vouchers, another currency or another week', () => {
    expect(
      receiptPayables(
        [
          receipt({ paymentMethod: 'cash' }),
          receipt({ paymentMethod: 'other' }),
          receipt({ currency: 'CHF' }),
          receipt({ total: 0 }),
        ],
        query,
      ),
    ).toEqual([]);
    expect(
      receiptPayables([receipt()], { from: '2026-11-20', to: '2026-11-30' }),
    ).toEqual([]);
  });

  it('reads the receipts of the days a movement can book them', () => {
    expect(receiptDaysFor({ from: '2026-11-10', to: '2026-11-20' })).toEqual({
      from: '2026-11-05',
      to: '2026-11-21',
    });
  });

  it('matches the card payment at the shop', () => {
    const [s] = suggestMatches(
      [
        {
          id: 'm1',
          date: '2026-11-15',
          amount: -63.27,
          description: 'PAGAMENTO POS ESSELUNGA MILANO 14/11',
        },
      ],
      receiptPayables([receipt()], query),
      [],
    );
    expect(s).toMatchObject({ confidence: 'sure' });
  });
});
