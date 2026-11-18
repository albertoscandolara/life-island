import {
  BILLING_CYCLE_MONTHS,
  isoAddDays,
  isoAddMonths,
  type SubscriptionDto,
} from '@life-island/contracts';

/** One month of the fixed cost: its total, and what changed against the month before. */
export interface CostMonth {
  /** `YYYY-MM`. */
  month: string;
  /** What the contracts in force cost a month, in euros. */
  total: number;
  /** A contract started, or a price went up or down, in this month. */
  changes: string[];
}

/** The price of a contract on a day, from its price changes. */
export function priceOn(item: SubscriptionDto, date: string): number {
  // The first change after the day says what the price was before it.
  const later = item.priceChanges
    .filter((c) => c.date > date)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return later ? later.from : item.cost;
}

/**
 * What the contracts you still have cost a month, month by month over the
 * last `count` months: each one from the month it started, at the price of
 * the end of each month. Cancelled contracts are left out (their end date
 * is not kept), so the line shows how your current fixed costs grew.
 */
export function costHistory(
  items: readonly SubscriptionDto[],
  today: string,
  count = 24,
): CostMonth[] {
  const kept = items.filter((i) => i.status !== 'cancelled');
  const first = `${today.slice(0, 7)}-01`;
  const months: CostMonth[] = [];
  let before: Map<string, number> | null = null;
  for (let back = count - 1; back >= 0; back--) {
    const start = isoAddMonths(first, -back);
    const month = start.slice(0, 7);
    const end = back === 0 ? today : isoAddDays(isoAddMonths(start, 1), -1);
    const now = new Map<string, number>();
    for (const item of kept) {
      if (item.startOn && item.startOn > end) continue;
      now.set(item.id, priceOn(item, end) / BILLING_CYCLE_MONTHS[item.cycle]);
    }
    const changes: string[] = [];
    if (before)
      for (const item of kept) {
        const was = before.get(item.id);
        const is = now.get(item.id);
        if (is === undefined) continue;
        if (was === undefined) changes.push(`${item.name} started`);
        else if (Math.abs(is - was) >= 0.005)
          changes.push(`${item.name} ${is > was ? 'went up' : 'went down'}`);
      }
    const total = [...now.values()].reduce((s, v) => s + v, 0);
    months.push({ month, total: Math.round(total * 100) / 100, changes });
    before = now;
  }
  return months;
}
