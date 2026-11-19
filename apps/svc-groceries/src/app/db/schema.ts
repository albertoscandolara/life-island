import { paymentsTable } from '@life-island/be-common';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  GroceryItemCategory,
  ShoppingListOutput,
} from '@life-island/contracts';

export const grocery = pgSchema('grocery');

/** Shops, one row per VAT number (or per name when the receipt shows none). */
export const merchants = grocery.table(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `vat:<number>` or `name:<lower-case name>`: how a merchant is recognised again. */
    merchantKey: text('merchant_key').notNull(),
    name: text('name').notNull(),
    vatNumber: text('vat_number'),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('merchants_key_idx').on(table.merchantKey)],
);

const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2, mode: 'number' });

/** One confirmed receipt. `source_staging_id` makes loading it idempotent. */
export const receipts = grocery.table(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The review record it came from; by id only, no cross-schema foreign key. */
    sourceStagingId: uuid('source_staging_id').notNull(),
    uploadId: uuid('upload_id').notNull(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    /** Your own name for it; the shop's name when null. */
    title: text('title'),
    /** Not groceries (software, credits): off the Groceries page, still in Money. */
    notGroceries: boolean('not_groceries').notNull().default(false),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull(),
    currency: text('currency').notNull(),
    total: money('total').notNull(),
    paymentMethod: text('payment_method'),
    /** The document's template fields as you reviewed them. */
    documentFields: jsonb('document_fields'),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('receipts_source_staging_id_idx').on(table.sourceStagingId),
    index('receipts_purchased_at_idx').on(table.purchasedAt),
  ],
);

export const receiptItems = grocery.table(
  'receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    rawName: text('raw_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    category: text('category').notNull(),
    quantity: numeric('quantity', {
      precision: 12,
      scale: 3,
      mode: 'number',
    }).notNull(),
    unitPrice: money('unit_price'),
    lineTotal: money('line_total').notNull(),
  },
  (table) => [
    uniqueIndex('receipt_items_position_idx').on(
      table.receiptId,
      table.position,
    ),
    index('receipt_items_category_idx').on(table.category),
  ],
);

/**
 * Each item you buy, one row per name the receipt lines carry
 * (`normalized_name`, matched without case): its link, its photo (in this
 * service's bucket, never in the database) and whether you removed it from
 * "What you buy". Its receipt lines stay: they are what you paid.
 */
export const products = grocery.table(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `lower(btrim(name))`: how a receipt line finds its product. */
    nameKey: text('name_key').notNull(),
    name: text('name').notNull(),
    link: text('link'),
    imageKey: text('image_key'),
    imageType: text('image_type'),
    imageUpdatedAt: timestamp('image_updated_at', { withTimezone: true }),
    /** Removed from "What you buy" and from the suggested list. */
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('products_name_key_idx').on(table.nameKey)],
);
export type ProductRow = typeof products.$inferSelect;

export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptItemRow = typeof receiptItems.$inferSelect;
export type MerchantRow = typeof merchants.$inferSelect;

/** Your shopping list: what to buy next time. */
export const shoppingItems = grocery.table('shopping_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  quantity: text('quantity'),
  category: text('category')
    .$type<GroceryItemCategory>()
    .notNull()
    .default('other'),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type ShoppingItemRow = typeof shoppingItems.$inferSelect;

/** The lists the shopping-list tool suggested, newest kept. */
export const shoppingSuggestions = grocery.table('shopping_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<ShoppingListOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type ShoppingSuggestionRow = typeof shoppingSuggestions.$inferSelect;

/** svc-groceries' copy of the settings it reads (the AI switches), kept by its settings.changed@1 consumer. */
export const settingsReplica = grocery.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

/**
 * The bank payments Money says a receipt was paid with
 * (`groceries:receipt:<id>`), one row per link you confirmed there. Kept by
 * paymentEventHandler (libs/be-common), the same in every area.
 */
export const payments = paymentsTable(grocery);
export type PaymentRow = typeof payments.$inferSelect;
