import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AccountKind,
  MoneyCategory,
  MoneyChannel,
  SpendingReviewOutput,
  TransactionSplit,
} from '@life-island/contracts';

export const money = pgSchema('money');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const euro = (name: string) =>
  numeric(name, { precision: 12, scale: 2, mode: 'number' });

/** A bank account, a card, the cash in your wallet. */
export const accounts = money.table('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  institution: text('institution'),
  kind: text('kind').$type<AccountKind>().notNull().default('current'),
  openingBalance: euro('opening_balance').notNull().default(0),
  openingDate: date('opening_date').notNull().defaultNow(),
  archived: boolean('archived').notNull().default(false),
  notes: text('notes'),
  createdAt: createdAt(),
});
export type AccountRow = typeof accounts.$inferSelect;

/** One movement: money in is positive, money out negative. */
export const transactions = money.table(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    amount: euro('amount').notNull(),
    description: text('description').notNull(),
    category: text('category')
      .$type<MoneyCategory>()
      .notNull()
      .default('other'),
    notes: text('notes'),
    /** Parts in other categories (positive euro); the rest is in `category`. */
    splits: jsonb('splits').$type<TransactionSplit[]>().notNull().default([]),
    /** Bought online or in a shop; null: guessed from the description. */
    channel: text('channel').$type<MoneyChannel>(),
    createdAt: createdAt(),
  },
  (t) => [index('transactions_date_idx').on(t.date)],
);
export type TransactionRow = typeof transactions.$inferSelect;

/**
 * A receipt, an order screenshot or a photo filed with a movement. The file
 * is a document of svc-ingestion (by id); removing the movement forgets the
 * link, never the document.
 */
export const transactionAttachments = money.table(
  'transaction_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('transaction_attachments_pair').on(t.transactionId, t.uploadId),
  ],
);
export type TransactionAttachmentRow =
  typeof transactionAttachments.$inferSelect;

/** A monthly limit for one category. */
export const budgets = money.table('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').$type<MoneyCategory>().notNull().unique(),
  monthlyLimit: euro('monthly_limit').notNull(),
  createdAt: createdAt(),
});
export type BudgetRow = typeof budgets.$inferSelect;

/** The spending reviews written, newest kept. */
export const spendingReviews = money.table('spending_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<SpendingReviewOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type SpendingReviewRow = typeof spendingReviews.$inferSelect;

/** svc-money's copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = money.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

/**
 * A movement you confirmed paid (part of) an item of another area: a bill in
 * Houses, an expense of the 730. The item is named by its payable key; the
 * area learns of the link from money.payment_linked@1. A movement with links
 * cannot be removed until they are undone (Money undoes them first).
 */
export const movementLinks = money.table(
  'movement_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    payableKey: text('payable_key').notNull(),
    module: text('module').notNull(),
    /** What this movement pays of the item (positive). */
    amount: euro('amount').notNull(),
    /** The item's title and page when linked, kept if the item goes. */
    title: text('title').notNull(),
    path: text('path'),
    /**
     * Made by Money on its own: a sure match of an item paid automatically
     * (a direct debit). Undoing it says "not this one" for the pair.
     */
    auto: boolean('auto').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('movement_links_pair').on(t.transactionId, t.payableKey),
    index('movement_links_payable_idx').on(t.payableKey),
  ],
);
export type MovementLinkRow = typeof movementLinks.$inferSelect;

/** "Not this one": a pair Money never proposes again. */
export const matchRejections = money.table(
  'match_rejections',
  {
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    payableKey: text('payable_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('match_rejections_pair').on(t.transactionId, t.payableKey)],
);
