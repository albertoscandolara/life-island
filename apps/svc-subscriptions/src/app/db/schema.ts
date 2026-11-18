import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BillingCycle,
  RenewalAdvisorOutput,
  SubscriptionKind,
  SubscriptionStatus,
  UsageLevel,
} from '@life-island/contracts';

export const subscriptionsSchema = pgSchema('subscriptions');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const euro = (name: string) =>
  numeric(name, { precision: 10, scale: 2, mode: 'number' });

/** A contract or subscription that renews: phone, streaming, gym, insurance. */
export const contracts = subscriptionsSchema.table('contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  provider: text('provider'),
  kind: text('kind').$type<SubscriptionKind>().notNull().default('other'),
  cost: euro('cost').notNull(),
  cycle: text('cycle').$type<BillingCycle>().notNull().default('monthly'),
  startOn: date('start_on'),
  renewsOn: date('renews_on'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  /** Charged on its own (card on file, direct debit): its renewals are no warning. */
  autoPay: boolean('auto_pay').notNull().default(true),
  noticeDays: integer('notice_days').notNull().default(0),
  lockedUntil: date('locked_until'),
  status: text('status')
    .$type<SubscriptionStatus>()
    .notNull()
    .default('active'),
  usage: text('usage').$type<UsageLevel>(),
  paidWith: text('paid_with'),
  cancelUrl: text('cancel_url'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type ContractRow = typeof contracts.$inferSelect;

/** Each time a contract's cost changed. */
export const priceChanges = subscriptionsSchema.table('price_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id')
    .notNull()
    .references(() => contracts.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  fromCost: euro('from_cost').notNull(),
  toCost: euro('to_cost').notNull(),
});

/** What the renewal advisor wrote, newest kept. */
export const renewalAdvice = subscriptionsSchema.table('renewal_advice', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<RenewalAdvisorOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type RenewalAdviceRow = typeof renewalAdvice.$inferSelect;

/** svc-subscriptions' copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = subscriptionsSchema.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

/**
 * The bank payments Money says a charge was paid with
 * (`subscriptions:charge:<contract id>.<day>`), one row per link you confirmed
 * there. Kept by paymentEventHandler (libs/be-common), the same in every area.
 * Shows the last charge, and what it really cost when the price went up.
 */
export const payments = subscriptionsSchema.table(
  'payments',
  {
    linkId: uuid('link_id').primaryKey(),
    payableKey: text('payable_key').notNull(),
    amount: numeric('amount', {
      precision: 14,
      scale: 2,
      mode: 'number',
    }).notNull(),
    /** The day the money moved; null on a link undone before it arrived. */
    paidOn: date('paid_on', { mode: 'string' }),
    accountName: text('account_name'),
    description: text('description'),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('payments_payable_idx').on(table.payableKey)],
);
export type PaymentRow = typeof payments.$inferSelect;
