import type { AccountDto, TransactionDto } from '@life-island/contracts';
import {
  balanceMonthAgo,
  categoryParts,
  lastMonthToDate,
  monthFlows,
  purchaseChannels,
} from './analysis.js';

const tx = (
  date: string,
  amount: number,
  category: TransactionDto['category'] = 'groceries',
  accountId = 'a',
) =>
  ({ id: date + amount, accountId, date, amount, category }) as TransactionDto;

describe('tile comparisons', () => {
  it('compares this month so far with last month up to the same day', () => {
    const txs = [
      tx('2026-10-03', -40),
      tx('2026-10-18', -60),
      tx('2026-10-19', -500), // after the 18th: left out
      tx('2026-10-01', 2000, 'salary'),
      tx('2026-10-05', -300, 'savings'), // a transfer: neither
      tx('2026-11-02', -25),
    ];
    expect(lastMonthToDate(txs, '2026-11-18')).toEqual({
      income: 2000,
      spending: 100,
    });
  });

  it('works out the balance a month ago from what moved since', () => {
    const accounts = [
      { id: 'a', balance: 1000, archived: false },
      { id: 'b', balance: 500, archived: true },
    ] as AccountDto[];
    const txs = [
      tx('2026-11-10', -200),
      tx('2026-11-01', 300, 'salary'),
      tx('2026-10-10', -50), // before the month: already in the old balance
      tx('2026-11-10', -999, 'groceries', 'b'), // closed account
    ];
    expect(balanceMonthAgo(accounts, txs, '2026-11-18')).toBe(900);
  });
});

describe('months', () => {
  it('splits what went out by category, leaving transfers out', () => {
    const txs = [
      tx('2026-11-03', -40),
      tx('2026-11-08', -10.005),
      tx('2026-11-04', -900, 'housing'),
      tx('2026-11-05', -300, 'savings'), // a transfer: neither
      tx('2026-11-01', 2000, 'salary'),
      tx('2026-10-04', -900, 'housing'),
    ];
    const months = monthFlows(txs, '2026-11-18');
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toEqual({
      month: '2026-11',
      income: 2000,
      spending: 950.01,
      net: 1049.99,
      spendingBy: { groceries: 50.01, housing: 900 },
    });
    expect(months.at(-2)?.spendingBy).toEqual({ housing: 900 });
    expect(months[0].spendingBy).toEqual({});
  });
});

describe('split movements', () => {
  const amazon = {
    ...tx('2026-11-11', -192.75, 'groceries'),
    description: 'AMAZON PAYMENTS EUROPE',
    channel: null,
    splits: [{ category: 'shopping' as const, amount: 27.99 }],
  } as TransactionDto;

  it('counts each part in its own category and keeps the total', () => {
    const parts = categoryParts([amazon, tx('2026-11-12', -20)]);
    expect(parts.map((p) => [p.category, p.amount])).toEqual([
      ['groceries', -164.76],
      ['shopping', -27.99],
      ['groceries', -20],
    ]);
    const month = monthFlows(parts, '2026-11-18').at(-1);
    expect(month?.spending).toBe(212.75);
    expect(month?.spendingBy).toEqual({ groceries: 184.76, shopping: 27.99 });
  });

  it('drops the rest when the parts cover the whole movement', () => {
    const whole = {
      ...amazon,
      splits: [
        { category: 'shopping' as const, amount: 100 },
        { category: 'health' as const, amount: 92.75 },
      ],
    };
    expect(categoryParts([whole]).map((p) => p.category)).toEqual([
      'shopping',
      'health',
    ]);
  });

  it('splits purchases by where they were made', () => {
    const shop = {
      ...tx('2026-11-03', -45.5),
      description: 'POS ESSELUNGA',
      channel: null,
      splits: [],
    } as TransactionDto;
    const told = { ...shop, amount: -10, channel: 'online' } as TransactionDto;
    const rent = {
      ...shop,
      amount: -900,
      category: 'housing',
    } as TransactionDto;
    const months = purchaseChannels(
      categoryParts([amazon, shop, told, rent]),
      '2026-11-18',
    );
    expect(months).toHaveLength(6);
    expect(months.at(-1)).toEqual({
      month: '2026-11',
      online: 202.75,
      store: 45.5,
    });
  });
});
