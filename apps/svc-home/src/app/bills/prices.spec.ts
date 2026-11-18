import type { BillDto } from '@life-island/contracts';
import { priceRises } from '../attention.controller.js';
import { contractPrices, type PriceBill } from './prices.js';

const bill = (over: Partial<PriceBill>): PriceBill => ({
  uploadId: Math.random().toString(36),
  contractId: 'c1',
  utility: 'INTERNET',
  amount: 30.98,
  consumption: null,
  fee: 30.98,
  periodStart: null,
  issueDate: null,
  ...over,
});

describe('contractPrices', () => {
  it('finds the month an internet fee changed', () => {
    const prices = contractPrices([
      bill({ periodStart: '2026-03-01' }),
      bill({ periodStart: '2026-01-01', fee: 27.98, amount: 27.98 }),
      bill({ periodStart: '2026-02-01', uploadId: 'feb', amount: 34 }),
    ]);
    expect(prices.get('c1')).toEqual({
      price: 30.98,
      change: { from: 27.98, to: 30.98, since: '2026-02-01', uploadId: 'feb' },
    });
  });

  it('says nothing while a fee holds', () => {
    const prices = contractPrices([
      bill({ periodStart: '2026-01-01' }),
      bill({ periodStart: '2026-02-01' }),
    ]);
    expect(prices.get('c1')?.change).toBeNull();
  });

  it('compares a summer gas bill with last summer, not with the winter', () => {
    const gas = (day: string, amount: number, consumption: number) =>
      bill({
        utility: 'GAS',
        fee: null,
        periodStart: day,
        amount,
        consumption,
        uploadId: day,
      });
    // 18 € of fixed charges over 20 Smc in July, over 200 Smc in winter.
    const prices = contractPrices([
      gas('2025-07-01', 39, 20),
      gas('2026-01-01', 228, 200),
      gas('2026-03-01', 123, 100),
      gas('2026-07-01', 39, 20),
    ]);
    expect(prices.get('c1')?.change).toBeNull();
  });

  it('reads a metered price per unit, and only a real move as a change', () => {
    const gas = (day: string, amount: number, consumption: number) =>
      bill({
        utility: 'GAS',
        fee: null,
        periodStart: day,
        amount,
        consumption,
        uploadId: day,
      });
    // A cold month uses more, at the same price: no change.
    const same = contractPrices([
      gas('2026-01-01', 100, 100),
      gas('2026-02-01', 105, 100),
      gas('2026-03-01', 300, 290),
    ]);
    expect(same.get('c1')?.change).toBeNull();
    // A new tariff: 1,00 → 1,30 €/Smc.
    const rise = contractPrices([
      gas('2026-01-01', 100, 100),
      gas('2026-02-01', 100, 100),
      gas('2026-03-01', 130, 100),
    ]);
    expect(rise.get('c1')).toEqual({
      price: 1.3,
      change: { from: 1, to: 1.3, since: '2026-03-01', uploadId: '2026-03-01' },
    });
  });
});

describe('priceRises', () => {
  const dto = (over: Partial<BillDto>): BillDto =>
    ({
      id: over.uploadId,
      title: 'Bill',
      utilityOverridden: false,
      propertyId: 'p1',
      assignment: 'SUPPLY_CODE',
      provider: 'Fibra Esempio',
      customerId: null,
      periodEnd: null,
      dueDate: null,
      currency: 'EUR',
      unit: '',
      invoiceNumber: null,
      totalDue: null,
      supplierId: 's1',
      supplyPointId: 'line',
      directDebit: true,
      autoPaid: true,
      bankPayment: null,
      utility: 'INTERNET',
      contractId: 'c1',
      consumption: null,
      issueDate: null,
      uploadId: 'x',
      amount: 30.98,
      fee: 30.98,
      periodStart: null,
      ...over,
    }) as BillDto;

  it('asks for a look at a fee that just went up, on the line’s current contract', () => {
    const items = priceRises(
      [
        dto({
          uploadId: 'a',
          periodStart: '2026-09-01',
          fee: 27.98,
          amount: 27.98,
        }),
        dto({ uploadId: 'b', periodStart: '2026-10-01' }),
        dto({ uploadId: 'c', periodStart: '2026-11-01' }),
      ],
      '2026-11-18',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'price-rise:c1:2026-10-01',
      kind: 'price-rise',
      title: 'Internet price went up: Fibra Esempio',
      since: '2026-10-01',
      path: '/home/bills',
    });
    expect(items[0].detail).toContain('27,98 €/month → 30,98 €/month (+11%)');
  });

  it('forgets an old rise, and one on a contract you left', () => {
    expect(
      priceRises(
        [
          dto({
            uploadId: 'a',
            periodStart: '2026-01-01',
            fee: 27.98,
            amount: 27.98,
          }),
          dto({ uploadId: 'b', periodStart: '2026-02-01' }),
        ],
        '2026-11-18',
      ),
    ).toEqual([]);
    expect(
      priceRises(
        [
          dto({
            uploadId: 'a',
            periodStart: '2026-09-01',
            fee: 27.98,
            amount: 27.98,
          }),
          dto({ uploadId: 'b', periodStart: '2026-10-01' }),
          dto({ uploadId: 'c', periodStart: '2026-11-01', contractId: 'c2' }),
        ],
        '2026-11-18',
      ),
    ).toEqual([]);
  });
});
