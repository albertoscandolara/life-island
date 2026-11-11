import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AccountKind,
  MoneyCategory,
  SpendingReviewOutput,
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
    createdAt: createdAt(),
  },
  (t) => [index('transactions_date_idx').on(t.date)],
);
export type TransactionRow = typeof transactions.$inferSelect;

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
