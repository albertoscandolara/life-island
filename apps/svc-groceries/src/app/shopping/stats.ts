import {
  FOI_ANNUAL_CHANGE_PCT,
  FOI_PARTIAL_YEAR,
  GROCERY_ITEM_CATEGORIES,
  isoAddDays,
  isoAddMonths,
  isoDaysBetween,
  isNotAProduct,
  productKey,
  type GroceryBasketDto,
  type GroceryItemCategory,
  type GroceryItemStatsDto,
  type GroceryMonthDto,
  type ShoppingListOutput,
  euroText,
} from '@life-island/contracts';

/*
 * What you buy, from the confirmed receipts: how often each item, at what
 * price, per month and per category; and the shopping list's own rules.
 */

export interface PurchaseLine {
  name: string;
  category: string;
  date: string;
  unitPrice: number | null;
  lineTotal: number;
  merchant: string;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** What you keep about an item: its id, link, photo, and whether you removed it. */
export interface ProductInfo {
  id: string;
  link: string | null;
  imageUpdatedAt: Date | null;
  hidden: boolean;
}

/**
 * Each item you buy (lines of the same name, without case), how often and
 * at what price. Lines that are not a product (VAT, bags, discounts) and
 * items you removed are left out.
 */
export function itemStats(
  lines: readonly PurchaseLine[],
  products: ReadonlyMap<string, ProductInfo> = new Map(),
): GroceryItemStatsDto[] {
  const groups = new Map<string, PurchaseLine[]>();
  for (const l of lines) {
    const key = productKey(l.name);
    if (!key || isNotAProduct(l.name) || products.get(key)?.hidden) continue;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      const product = products.get(key);
      const name = sorted[sorted.length - 1].name.trim();
      const days = [...new Set(sorted.map((l) => l.date))];
      const prices = sorted
        .filter((l) => l.unitPrice !== null && l.unitPrice > 0)
        .map((l) => ({
          date: l.date,
          price: l.unitPrice!,
          merchant: l.merchant,
        }));
      const first = prices[0]?.price;
      const last = prices[prices.length - 1]?.price;
      return {
        id: product?.id ?? null,
        name,
        link: product?.link ?? null,
        imageVersion: product?.imageUpdatedAt?.getTime() ?? null,
        category: sorted[sorted.length - 1].category,
        purchases: days.length,
        lastBought: days[days.length - 1],
        everyDays:
          days.length > 1
            ? Math.round(
                isoDaysBetween(days[0], days[days.length - 1]) /
                  (days.length - 1),
              )
            : null,
        lastPrice: last ?? null,
        averagePrice: prices.length
          ? round(prices.reduce((s, p) => s + p.price, 0) / prices.length)
          : null,
        priceChange: first && last ? round((last - first) / first) : null,
        prices: prices.slice(-12),
      };
    })
    .sort((a, b) => b.purchases - a.purchases || a.name.localeCompare(b.name));
}

/**
 * Your grocery inflation: for each item with a unit price in both the last
 * 365 days and the 365 before, the average price now over the average then,
 * weighted by the purchases of the last year; next to ISTAT FOI.
 */
export function basketChange(
  lines: readonly PurchaseLine[],
  today: string,
): GroceryBasketDto {
  const yearAgo = isoAddDays(today, -365);
  const twoYearsAgo = isoAddDays(today, -730);
  const groups = new Map<string, { now: number[]; then: number[] }>();
  for (const l of lines) {
    if (l.unitPrice === null || l.unitPrice <= 0 || l.date > today) continue;
    const g = groups.get(l.name) ?? { now: [], then: [] };
    if (l.date > yearAgo) g.now.push(l.unitPrice);
    else if (l.date > twoYearsAgo) g.then.push(l.unitPrice);
    groups.set(l.name, g);
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const compared = [...groups.entries()]
    .filter(([, g]) => g.now.length && g.then.length)
    .map(([name, g]) => ({
      name,
      weight: g.now.length,
      change: mean(g.now) / mean(g.then) - 1,
    }));
  const weights = compared.reduce((s, c) => s + c.weight, 0);
  const year = Number(today.slice(0, 4));
  const officialYear = FOI_ANNUAL_CHANGE_PCT[year] !== undefined ? year : null;
  return {
    change: weights
      ? Math.round(
          (compared.reduce((s, c) => s + c.change * c.weight, 0) / weights) *
            1000,
        ) / 1000
      : null,
    items: compared.length,
    risers: compared
      .filter((c) => c.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 3)
      .map((c) => ({
        name: c.name,
        change: Math.round(c.change * 1000) / 1000,
      })),
    officialPct: officialYear ? FOI_ANNUAL_CHANGE_PCT[officialYear] : null,
    officialLabel: officialYear
      ? `ISTAT FOI ${officialYear}${officialYear === FOI_PARTIAL_YEAR.year ? `, ${FOI_PARTIAL_YEAR.months}` : ''}`
      : null,
  };
}

export function months(
  receipts: readonly { date: string; total: number }[],
  today: string,
): GroceryMonthDto[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = isoAddMonths(`${today.slice(0, 7)}-01`, i - 11).slice(0, 7);
    const own = receipts.filter((r) => r.date.startsWith(month));
    return {
      month,
      total: round(own.reduce((s, r) => s + r.total, 0)),
      receipts: own.length,
    };
  });
}

export function categorySpend(lines: readonly PurchaseLine[], today: string) {
  const [m3, m2, m1, now] = [-3, -2, -1, 0].map((n) =>
    isoAddMonths(`${today.slice(0, 7)}-01`, n).slice(0, 7),
  );
  const spent = (category: string, month: string) =>
    lines
      .filter((l) => l.category === category && l.date.startsWith(month))
      .reduce((s, l) => s + l.lineTotal, 0);
  return [...new Set(lines.map((l) => l.category))]
    .map((category) => ({
      category,
      thisMonth: round(spent(category, now)),
      average: round(
        (spent(category, m1) + spent(category, m2) + spent(category, m3)) / 3,
      ),
    }))
    .filter((c) => c.thisMonth || c.average)
    .sort((a, b) => b.average - a.average);
}

const asCategory = (c: string): GroceryItemCategory =>
  (GROCERY_ITEM_CATEGORIES as readonly string[]).includes(c)
    ? (c as GroceryItemCategory)
    : 'other';

/** Items you buy regularly and are about due, the most overdue first. */
export function dueItems(
  items: readonly GroceryItemStatsDto[],
  today: string,
  onList: ReadonlySet<string>,
) {
  return items
    .filter(
      (i) =>
        i.everyDays && i.purchases >= 3 && !onList.has(i.name.toLowerCase()),
    )
    .map((i) => ({ item: i, since: isoDaysBetween(i.lastBought, today) }))
    .filter(
      ({ item, since }) =>
        since >= item.everyDays! * 0.85 && since <= item.everyDays! * 4,
    )
    .sort((a, b) => b.since / b.item.everyDays! - a.since / a.item.everyDays!);
}

export function offlineList(
  items: readonly GroceryItemStatsDto[],
  today: string,
  onList: ReadonlySet<string>,
): ShoppingListOutput {
  const due = dueItems(items, today, onList).slice(0, 20);
  const pricier = items
    .filter(
      (i) =>
        i.priceChange !== null && i.priceChange >= 0.15 && i.purchases >= 3,
    )
    .slice(0, 3);
  return {
    summary: due.length
      ? `${due.length} item${due.length === 1 ? '' : 's'} you buy regularly ${due.length === 1 ? 'is' : 'are'} about due, from your receipts.`
      : 'Nothing you buy regularly looks due yet. Once more receipts are confirmed, the list gets better.',
    items: due.map(({ item, since }) => ({
      name: item.name,
      category: asCategory(item.category),
      why: `Bought about every ${item.everyDays} days; last ${since} days ago.`,
    })),
    tips: pricier.map(
      (i) =>
        `${i.name} costs ${Math.round(i.priceChange! * 100)}% more than when you first bought it: compare shops or brands.`,
    ),
  };
}

export const LIST_INSTRUCTIONS = `You help one household shop smarter with Life Island, which reads their confirmed supermarket receipts.

You receive the items they buy (how many times, about every how many days, days since the last purchase, last and first price), what is already on their list, and optionally a request. Write:
- summary: one or two sentences on the habits behind the list.
- items: up to twenty items to buy now, the most due first, as they would write them on a list, with a category and why (e.g. "every 7 days, last 9 days ago"). Never repeat what is already on the list.
- tips: up to three concrete ways to spend less, from the price history (a price that rose, a cheaper shop seen for the same item).

Rules: use only the items given unless the request asks for something else (a recipe, a party). Plain English, no emojis.`;

export function listDossier(
  items: readonly GroceryItemStatsDto[],
  today: string,
  onList: readonly string[],
): string {
  const lines = [`Today is ${today}.`, '<items>'];
  for (const i of items.slice(0, 120))
    lines.push(
      `- ${i.name} (${i.category}): ${i.purchases} times${i.everyDays ? `, about every ${i.everyDays} days` : ''}, last ${isoDaysBetween(i.lastBought, today)} days ago${i.lastPrice ? `, ${euroText(i.lastPrice)}` : ''}${i.priceChange ? ` (${i.priceChange > 0 ? '+' : ''}${Math.round(i.priceChange * 100)}% since first)` : ''}${i.prices.length > 1 ? `; shops: ${[...new Set(i.prices.map((p) => `${p.merchant} ${euroText(p.price)}`))].slice(-3).join(', ')}` : ''}`,
    );
  lines.push(
    '</items>',
    `Already on the list: ${onList.length ? onList.join(', ') : 'nothing'}`,
  );
  return lines.join('\n');
}
