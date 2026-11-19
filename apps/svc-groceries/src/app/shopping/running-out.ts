import {
  isoAddDays,
  type GroceryItemStatsDto,
  type LifeAttentionDto,
  type ShoppingItemDto,
} from '@life-island/contracts';

/**
 * The items you buy regularly that are probably running out: bought at
 * least three times, with their usual gap already past, not on the list
 * yet. An item whose gap passed three times over is one you stopped buying.
 */
export function runningOut(
  items: GroceryItemStatsDto[],
  list: ShoppingItemDto[],
  day: string,
): GroceryItemStatsDto[] {
  const listed = new Set(
    list.filter((i) => !i.done).map((i) => i.name.trim().toLowerCase()),
  );
  return items.filter((item) => {
    if (item.everyDays === null || item.purchases < 3) return false;
    if (listed.has(item.name.trim().toLowerCase())) return false;
    const due = isoAddDays(item.lastBought, Math.round(item.everyDays));
    const stopped = isoAddDays(item.lastBought, Math.round(item.everyDays * 3));
    return due <= day && day < stopped;
  });
}

/**
 * Groceries' badge (`GET /attention`): what is running out, listed for the
 * Agenda since the day it was due.
 */
export function groceriesAttention(
  items: GroceryItemStatsDto[],
  list: ShoppingItemDto[],
  day: string,
): LifeAttentionDto {
  const out = runningOut(items, list, day);
  return {
    expired: 0,
    expiring: out.length,
    toReview: 0,
    items: out.map((item) => ({
      id: `running-out:${item.name.trim().toLowerCase()}`,
      kind: 'running-out',
      title: `${item.name} is probably running out`,
      detail: `You buy it about every ${Math.round(item.everyDays ?? 0)} days.`,
      since: isoAddDays(item.lastBought, Math.round(item.everyDays ?? 0)),
      path: `/groceries?add=${encodeURIComponent(item.name)}#shopping-list`,
      action: 'Add to list',
    })),
  };
}
