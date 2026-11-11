import { z } from 'zod';
import {
  lifeName,
  lifeNote,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';
import { GROCERY_ITEM_CATEGORIES } from './targets/grocery-receipt.js';
import type { ReceiptDto } from './domain-dtos.js';

/*
 * Groceries (Trice, svc-groceries, mfe-groceries): the receipts you confirmed
 * in the documents app, read into spending by month and category, the shops
 * you use, the price of each item over time, a shopping list, and an AI that
 * suggests the next list from what you usually buy.
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

/** One item you buy, across receipts: how often and at what price. */
export interface GroceryItemStatsDto {
  name: string;
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

export interface GroceryMerchantStatsDto {
  id: string;
  name: string;
  receipts: number;
  total: number;
  lastVisit: string;
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

export interface GroceriesOverviewDto {
  today: string;
  /** The last 12 months, oldest first. */
  months: GroceryMonthDto[];
  categories: { category: string; thisMonth: number; average: number }[];
  items: GroceryItemStatsDto[];
  merchants: GroceryMerchantStatsDto[];
  recent: ReceiptDto[];
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
