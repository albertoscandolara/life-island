import type { AccountDto, TransactionDto } from '@life-island/contracts';
import { balanceMonthAgo, lastMonthToDate } from './analysis.js';

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
