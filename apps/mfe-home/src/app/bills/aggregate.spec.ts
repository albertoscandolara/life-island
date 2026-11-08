import type { BillDto } from '@life-island/contracts';
import {
  addMonths,
  aggregate,
  bucketsOf,
  extent,
  groupRows,
  previousRange,
  shares,
  totalIn,
  utilityStats,
  yearOverYear,
} from './aggregate';

const bill = (overrides: Partial<BillDto>): BillDto => ({
  id: Math.random().toString(36),
  uploadId: Math.random().toString(36),
  title: 'Bill',
  utility: 'GAS',
  utilityOverridden: false,
  propertyId: 'p1',
  assignment: 'ADDRESS',
  provider: 'Hera',
  customerId: null,
  periodStart: null,
  periodEnd: null,
  issueDate: null,
  dueDate: null,
  amount: 100,
  currency: 'EUR',
  consumption: null,
  unit: 'Smc',
  invoiceNumber: null,
  totalDue: null,
  supplierId: null,
  supplyPointId: null,
  contractId: null,
  ...overrides,
});

describe('months', () => {
  it('adds months across years', () => {
    expect(addMonths('2025-11', 3)).toBe('2026-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('lists buckets of a range at each grain', () => {
    const range = { from: '2025-11', to: '2026-04' };
    expect(bucketsOf(range, 'month')).toHaveLength(6);
    expect(bucketsOf(range, 'quarter')).toEqual([
      '2025-Q4',
      '2026-Q1',
      '2026-Q2',
    ]);
    expect(bucketsOf(range, 'year')).toEqual(['2025', '2026']);
  });

  it('gives the previous range of the same length', () => {
    expect(previousRange({ from: '2026-01', to: '2026-06' })).toEqual({
      from: '2025-07',
      to: '2025-12',
    });
  });
});

describe('shares', () => {
  it('spreads a bill over the days of its period', () => {
    // 31 days of January + 28 of February
    const parts = shares(
      bill({ periodStart: '2026-01-01', periodEnd: '2026-02-28' }),
      'period',
    );
    expect(parts.map((p) => p.month)).toEqual(['2026-01', '2026-02']);
    expect(parts[0].weight).toBeCloseTo(31 / 59);
    expect(parts[0].weight + parts[1].weight).toBeCloseTo(1);
  });

  it('puts the whole bill in its issue month on the date basis', () => {
    expect(
      shares(
        bill({
          periodStart: '2026-01-01',
          periodEnd: '2026-02-28',
          issueDate: '2026-03-10',
        }),
        'date',
      ),
    ).toEqual([{ month: '2026-03', weight: 1 }]);
  });

  it('falls back to a date when there is no period, and skips undated bills', () => {
    expect(shares(bill({ issueDate: '2026-05-02' }), 'period')).toEqual([
      { month: '2026-05', weight: 1 },
    ]);
    expect(shares(bill({}), 'period')).toEqual([]);
  });
});

describe('aggregate', () => {
  const bills = [
    bill({
      utility: 'GAS',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      amount: 120,
      consumption: 100,
    }),
    bill({
      utility: 'ELECTRICITY',
      issueDate: '2026-02-15',
      amount: 60,
      consumption: 200,
    }),
    bill({ utility: 'WATER', issueDate: '2025-12-20', amount: 30 }),
  ];
  const range = { from: '2026-01', to: '2026-03' };

  it('sums each series per bucket, in the order of its keys', () => {
    const result = aggregate(bills, {
      range,
      grain: 'month',
      basis: 'period',
      metric: 'amount',
      keys: ['ELECTRICITY', 'GAS', 'WATER'],
      keyOf: (b) => b.utility,
    });
    expect(result.buckets).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(result.series).toEqual([
      { id: 'ELECTRICITY', values: [0, 60, 0] },
      { id: 'GAS', values: [120, 0, 0] },
      { id: 'WATER', values: [0, 0, 0] },
    ]);
  });

  it('sums consumption, skipping bills that print none', () => {
    const result = aggregate(bills, {
      range,
      grain: 'quarter',
      basis: 'period',
      metric: 'consumption',
      keys: ['GAS'],
      keyOf: (b) => b.utility,
    });
    expect(result.series[0].values).toEqual([100]);
  });

  it('totals a range and finds the extent of the bills', () => {
    expect(totalIn(bills, range, 'period')).toBe(180);
    expect(extent(bills, 'period')).toEqual({ from: '2025-12', to: '2026-02' });
  });

  it('computes the cost per unit on metered bills only', () => {
    const [electricity, , water] = utilityStats(bills, range, 'period', [
      'ELECTRICITY',
      'GAS',
      'WATER',
    ]);
    expect(electricity).toMatchObject({
      amount: 60,
      consumption: 200,
      unitCost: 0.3,
      bills: 1,
    });
    expect(water).toMatchObject({ amount: 0, unitCost: null, bills: 0 });
  });
});

describe('yearOverYear', () => {
  it('lines up the same months of different years', () => {
    const lines = yearOverYear(
      [
        bill({ issueDate: '2025-01-10', amount: 80 }),
        bill({ issueDate: '2026-01-10', amount: 95 }),
      ],
      'date',
      'amount',
      [2025, 2026],
    );
    expect(lines[0].values[0]).toBe(80);
    expect(lines[1].values[0]).toBe(95);
    expect(lines[1].values[1]).toBeNull();
  });
});

describe('groupRows', () => {
  it('groups by property and counts each bill once', () => {
    const rows = groupRows(
      [
        bill({
          propertyId: 'p1',
          periodStart: '2026-01-15',
          periodEnd: '2026-02-14',
          amount: 90,
        }),
        bill({ propertyId: null, issueDate: '2026-01-02', amount: 10 }),
      ],
      {
        range: { from: '2026-01', to: '2026-12' },
        basis: 'period',
        grain: 'month',
        by: 'property',
        labelOfProperty: (id) => (id === 'p1' ? 'Via Ponzilovo' : 'Unassigned'),
      },
    );
    expect(rows).toEqual([
      { key: 'Via Ponzilovo', amount: 90, consumption: {}, bills: 1 },
      { key: 'Unassigned', amount: 10, consumption: {}, bills: 1 },
    ]);
  });
});
