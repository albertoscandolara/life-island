import type {
  GroceryItemStatsDto,
  ShoppingItemDto,
} from '@life-island/contracts';
import { groceriesAttention, runningOut } from './running-out.js';

const item = (
  name: string,
  lastBought: string,
  everyDays: number | null,
  purchases = 4,
): GroceryItemStatsDto => ({
  name,
  category: 'other',
  purchases,
  lastBought,
  everyDays,
  lastPrice: null,
  averagePrice: null,
  priceChange: null,
  prices: [],
});

describe('runningOut', () => {
  const day = '2026-11-17';

  it('counts regular items past their usual gap and not on the list', () => {
    const items = [
      item('Milk', '2026-11-10', 6), // due on the 16th
      item('Coffee', '2026-11-15', 14), // not yet
      item('Bread', '2026-11-12', 3), // on the list
      item('Saffron', '2026-11-01', 10, 2), // bought twice: no habit yet
      item('Ice cream', '2026-08-01', 7), // stopped buying it
    ];
    const list = [
      { name: 'bread ', done: false } as ShoppingItemDto,
      { name: 'Milk', done: true } as ShoppingItemDto,
    ];
    expect(runningOut(items, list, day).map((i) => i.name)).toEqual(['Milk']);
    expect(groceriesAttention(items, list, day)).toEqual({
      expired: 0,
      expiring: 1,
      toReview: 0,
    });
  });
});
