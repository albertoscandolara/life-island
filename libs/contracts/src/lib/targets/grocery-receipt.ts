import { z } from 'zod';
import { isIsoDate, isIsoDateTime } from './validators.js';

export const GROCERY_ITEM_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'fish',
  'bakery',
  'pantry',
  'beverages',
  'household',
  'personal_care',
  'pharmacy',
  'other',
] as const;

/** grocery.receipt@1: a supermarket, pharmacy or shop receipt. */
export const GroceryReceiptV1 = z
  .object({
    merchant: z.object({
      name: z.string().describe('Shop name as printed on the receipt'),
      vatNumber: z.string().optional().describe('Partita IVA / VAT number'),
      address: z.string().optional(),
    }),
    purchasedAt: z
      .string()
      .describe('Purchase date and time, ISO 8601 (e.g. 2026-10-23T18:42:00Z)')
      .refine(isIsoDateTime, 'expected an ISO 8601 date-time'),
    currency: z.string().describe('ISO 4217 code, e.g. EUR'),
    total: z.number().describe('Total paid'),
    paymentMethod: z.enum(['cash', 'card', 'other']).optional(),
    items: z.array(
      z.object({
        rawName: z.string().describe('Item text exactly as printed'),
        normalizedName: z
          .string()
          .describe('Readable item name, e.g. "Whole milk 1 L"'),
        category: z.enum(GROCERY_ITEM_CATEGORIES),
        quantity: z.number(),
        unitPrice: z.number().optional(),
        lineTotal: z.number(),
      }),
    ),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.items.length === 0) return;
    const sum = receipt.items.reduce((acc, item) => acc + item.lineTotal, 0);
    // Discounts and deposits make small differences common; flag only real mismatches.
    if (Math.abs(sum - receipt.total) > Math.max(0.05, receipt.total * 0.02)) {
      ctx.addIssue({
        code: 'custom',
        path: ['total'],
        message: `line totals add up to ${sum.toFixed(2)}, not ${receipt.total.toFixed(2)}`,
      });
    }
    if (
      isIsoDate(receipt.purchasedAt.slice(0, 10)) &&
      new Date(receipt.purchasedAt) > new Date()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['purchasedAt'],
        message: 'purchase date is in the future',
      });
    }
  });
export type GroceryReceiptV1 = z.infer<typeof GroceryReceiptV1>;
