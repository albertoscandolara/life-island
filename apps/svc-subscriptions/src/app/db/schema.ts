import {
  boolean,
  date,
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
