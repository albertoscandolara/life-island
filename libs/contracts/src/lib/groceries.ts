import { z } from 'zod';
import {
  lifeName,
  lifeNote,
  lifeUrl,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';
import { GROCERY_ITEM_CATEGORIES } from './targets/grocery-receipt.js';
import type { ReceiptDto } from './domain-dtos.js';

/*
 * Groceries (Trice, svc-groceries, mfe-groceries): the receipts you confirmed
 * in the documents app, read into spending by month and category, the price
 * of each item over time (with its link and photo), a shopping list, and an
 * AI that suggests the next list from what you usually buy.
 */

export type GroceryItemCategory = (typeof GROCERY_ITEM_CATEGORIES)[number];
export const GROCERY_CATEGORY_LABELS: Record<GroceryItemCategory, string> = {
  produce: 'Fruit and vegetables',
  dairy: 'Dairy and eggs',
  meat: 'Meat',
  fish: 'Fish',
  bakery: 'Bread and bakery',
  pantry: 'Pantry',
  beverages: 'Drinks',
  household: 'Household',
  personal_care: 'Personal care',
  pharmacy: 'Pharmacy',
  digital: 'Software and digital',
  other: 'Other',
};

export const shoppingItemRequestSchema = z.object({
  name: lifeName(120),
  quantity: lifeNote(40),
  category: z.enum(GROCERY_ITEM_CATEGORIES).optional(),
  done: z.boolean().optional(),
});
export type ShoppingItemRequest = z.input<typeof shoppingItemRequestSchema>;

export type ShoppingItemDto = LifeRecord<{
  name: string;
  quantity: string | null;
  category: GroceryItemCategory;
  done: boolean;
}>;

/**
 * Receipt lines that are not something you buy: tax, bags, discounts,
 * deposits, shipping, rounding, totals. They stay on their receipt (they are
 * part of what you paid) but never show as an item of "What you buy".
 */
const NOT_A_PRODUCT = [
  // VAT and taxes: "IVA 22%", "VAT Italy 22%", "Imposta di bollo".
  /^(iva|vat|tax|taxes|imposta|imposte|sales tax)\b/,
  /\b(iva|vat)\b.*\d+([.,]\d+)?\s*%/,
  // Shopping bags: "Shopping bag", "Shopper", "Sacchetto biodegradabile", "Busta spesa".
  /^(shopping|carrier|plastic|paper|reusable)\s+bags?\b/,
  /^(shopper|sacchett[oi]|sacchetti|bust[ae])(\s+(spesa|bio\w*|biodegradabil\w*|compostabil\w*|carta|plastica))*\s*$/,
  /^bags?$/,
  // Discounts, coupons, deposits, shipping, rounding, totals.
  /^(sconto|sconti|discount|promo|promozione|coupon|voucher|buono)\b/,
  /^(cauzione|deposit|vuoto|vuoti)\b/,
  /^(spedizione|spese di spedizione|shipping|delivery|consegna)\b/,
  /^(arrotondamento|rounding)\b/,
  /^(sub ?total|subtotale|total|totale)\b/,
];

export function isNotAProduct(name: string): boolean {
  const text = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return NOT_A_PRODUCT.some((pattern) => pattern.test(text));
}

/**
 * A receipt that is not groceries: every line is software or digital (AI
 * credits, an app). Groceries leaves it out; Money still files it.
 */
export function isDigitalOnly(items: readonly { category: string }[]): boolean {
  return items.length > 0 && items.every((i) => i.category === 'digital');
}

/** How a receipt line finds its product: its name without case or outer spaces. */
export const productKey = (name: string) => name.trim().toLowerCase();

/** One item you buy, across receipts: how often and at what price. */
export interface GroceryItemStatsDto {
  /** The product's id (`/items/:id`); null only before its first save. */
  id: string | null;
  name: string;
  /** Its page in a shop, to buy it again. */
  link: string | null;
  /** When its photo last changed (ms), to load the new one; null without a photo. */
  imageVersion: number | null;
  category: string;
  purchases: number;
  lastBought: string;
  /** Average days between two purchases; null with one purchase. */
  everyDays: number | null;
  lastPrice: number | null;
  averagePrice: number | null;
  /** Last price against the first one seen, e.g. 0.12 for +12%. */
  priceChange: number | null;
  /** Unit prices over time, oldest first. */
  prices: { date: string; price: number; merchant: string }[];
}

export interface GroceryMonthDto {
  month: string;
  total: number;
  receipts: number;
}

export const shoppingListOutputSchema = z.object({
  summary: z
    .string()
    .describe('One or two sentences on the habits behind this list'),
  items: z
    .array(
      z.object({
        name: z.string().describe('The item, as you would write it on a list'),
        category: z.enum(GROCERY_ITEM_CATEGORIES),
        why: z
          .string()
          .describe('Why now, e.g. bought every 7 days, last 9 days ago'),
      }),
    )
    .describe('Up to twenty items, grouped by category'),
  tips: z
    .array(z.string())
    .describe('Up to three ways to spend less, from the price history'),
});
export type ShoppingListOutput = z.infer<typeof shoppingListOutputSchema>;
export type ShoppingSuggestionDto = LifeAiAnswerDto<ShoppingListOutput>;

/**
 * Your own grocery inflation: what the items you buy again cost in the last
 * 12 months against the 12 before, weighted by how often you buy them, next
 * to the official figure (ISTAT FOI).
 */
export interface GroceryBasketDto {
  /** e.g. 0.042 for +4.2%; null without items bought in both years. */
  change: number | null;
  /** The items compared. */
  items: number;
  /** The three that rose the most, with their change. */
  risers: { name: string; change: number }[];
  /** The official yearly change for the year, in percent. */
  officialPct: number | null;
  /** e.g. "ISTAT FOI 2026, January to September". */
  officialLabel: string | null;
}

export interface GroceriesOverviewDto {
  today: string;
  /** The last 12 months, oldest first. */
  months: GroceryMonthDto[];
  categories: { category: string; thisMonth: number; average: number }[];
  items: GroceryItemStatsDto[];
  basket: GroceryBasketDto;
  recent: ReceiptDto[];
  /** Receipts kept out of Groceries (software, credits), newest first: Money still tracks them. */
  notGroceries: ReceiptDto[];
  totals: {
    thisMonth: number;
    lastMonth: number;
    averageMonth: number;
    receipts: number;
  };
  list: ShoppingItemDto[];
  suggestions: ShoppingSuggestionDto[];
  aiList: boolean;
}

export const applySuggestionRequestSchema = z.object({
  /** The names to add; all of them when missing. */
  names: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});
export type ApplySuggestionRequest = z.input<
  typeof applySuggestionRequestSchema
>;

/** Changing an item of "What you buy": its name and aisle change on every receipt line. */
export const groceryItemRequestSchema = z.object({
  name: lifeName(120),
  category: z.enum(GROCERY_ITEM_CATEGORIES).optional(),
  link: lifeUrl,
});
export type GroceryItemRequest = z.input<typeof groceryItemRequestSchema>;

/**
 * Your own name for a receipt (empty goes back to the shop's name), and
 * whether it is groceries at all: one that is not (software credits) leaves
 * the Groceries page but stays matched and tracked in Money.
 */
export const receiptUpdateRequestSchema = z.object({
  title: lifeNote(120),
  notGroceries: z.boolean().optional(),
});
export type ReceiptUpdateRequest = z.input<typeof receiptUpdateRequestSchema>;
