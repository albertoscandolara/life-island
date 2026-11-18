import {
  date,
  index,
  numeric,
  text,
  timestamp,
  uuid,
  type PgSchema,
} from 'drizzle-orm/pg-core';

/**
 * An area's `<schema>.payments` table (docs/guides/money-matching.md): the
 * bank payments Money says its items were paid with, one row per link you
 * confirmed there, kept by paymentEventHandler. The same in every area with
 * payables; export it from the area's db/schema.ts so drizzle-kit sees it:
 *
 *   export const payments = paymentsTable(cars);
 */
export function paymentsTable<S extends string>(schema: PgSchema<S>) {
  return schema.table(
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
}
