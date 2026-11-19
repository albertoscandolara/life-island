import {
  isoAddDays,
  type GroceryItemCategory,
  type MoneyCategory,
  type PayableDto,
  type PayableLine,
  type PayablesQuery,
} from '@life-island/contracts';

/*
 * Groceries as Money matching reads them (`GET /payables`,
 * docs/guides/money-matching.md): every receipt, with its lines. One paid by
 * card (or whose way of paying was not read) is paired with its bank
 * movement, booked the same day or a few days later. One paid in cash
 * (`paidInCash`) never is: Money offers to add it to a cash account.
 */

/** A pre-authorisation can be booked the day before… */
export const BOOKED_BEFORE_DAYS = 1;
/** …and a card payment up to a few days after the purchase. */
export const BOOKED_AFTER_DAYS = 5;

const KEY = 'groceries:receipt:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const receiptPayableKey = (id: string) => `${KEY}${id}`;

/** The receipt a payable key names, or null when it is not one. */
export function receiptOfPayable(key: string): string | null {
  if (!key.startsWith(KEY)) return null;
  const id = key.slice(KEY.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** The Money category of each kind of item on a receipt. */
export const ITEM_MONEY_CATEGORY: Record<GroceryItemCategory, MoneyCategory> = {
  produce: 'groceries',
  dairy: 'groceries',
  meat: 'groceries',
  fish: 'groceries',
  bakery: 'groceries',
  pantry: 'groceries',
  beverages: 'groceries',
  household: 'groceries',
  personal_care: 'groceries',
  pharmacy: 'health',
  digital: 'subscriptions',
  other: 'shopping',
};

/** One item of a receipt, as Money files it. */
export interface PayableReceiptItem {
  name: string;
  category: string;
  lineTotal: number;
}

/** What a receipt needs to be matched with a bank movement. */
export interface PayableReceipt {
  id: string;
  merchant: string;
  /** The day of the purchase, in Italy (YYYY-MM-DD). */
  day: string;
  total: number;
  currency: string;
  paymentMethod: string | null;
  items?: readonly PayableReceiptItem[];
}

function lineOf(item: PayableReceiptItem): PayableLine {
  return {
    name: item.name,
    amount: Math.round(item.lineTotal * 100) / 100,
    category:
      ITEM_MONEY_CATEGORY[item.category as GroceryItemCategory] ?? 'groceries',
  };
}

/** The days of receipts to read for a query: a movement books after the purchase. */
export function receiptDaysFor(query: PayablesQuery): PayablesQuery {
  return {
    from: isoAddDays(query.from, -BOOKED_AFTER_DAYS),
    to: isoAddDays(query.to, BOOKED_BEFORE_DAYS),
  };
}

export function receiptPayables(
  receipts: readonly PayableReceipt[],
  query: PayablesQuery,
): PayableDto[] {
  return receipts.flatMap((r): PayableDto[] => {
    if (r.paymentMethod === 'other') return [];
    if (r.currency !== 'EUR' || !(r.total > 0)) return [];
    const cash = r.paymentMethod === 'cash';
    // Cash moves on the day; a card is booked a little before or after.
    const window = cash
      ? { from: r.day, to: r.day }
      : {
          from: isoAddDays(r.day, -BOOKED_BEFORE_DAYS),
          to: isoAddDays(r.day, BOOKED_AFTER_DAYS),
        };
    if (window.from > query.to || window.to < query.from) return [];
    return [
      {
        key: receiptPayableKey(r.id),
        module: 'groceries',
        kind: 'receipt',
        title: `${r.merchant}, receipt of ${r.day}`,
        payees: r.merchant.trim() ? [r.merchant.trim()] : [],
        amount: Math.round(r.total * 100) / 100,
        direction: 'out',
        date: r.day,
        window,
        path: '/groceries',
        ...(cash ? { paidInCash: true } : {}),
        ...(r.items?.length ? { lines: r.items.map(lineOf) } : {}),
      },
    ];
  });
}
