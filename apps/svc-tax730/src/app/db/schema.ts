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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tax730 = pgSchema('tax730');

/** The tax years that have at least one expense. */
export const taxYears = tax730.table('tax_years', {
  taxYear: integer('tax_year').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One confirmed expense. `source_staging_id` makes loading it idempotent. */
export const expenses = tax730.table(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The review record it came from; by id only, no cross-schema foreign key. */
    sourceStagingId: uuid('source_staging_id').notNull(),
    uploadId: uuid('upload_id').notNull(),
    taxYear: integer('tax_year')
      .notNull()
      .references(() => taxYears.taxYear),
    expenseType: text('expense_type').notNull(),
    frame730: text('frame730'),
    date: date('date', { mode: 'string' }).notNull(),
    amount: numeric('amount', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }).notNull(),
    beneficiaryFiscalCode: text('beneficiary_fiscal_code'),
    traceablePayment: boolean('traceable_payment'),
    issuer: text('issuer').notNull(),
    documentNumber: text('document_number'),
    /** The document's template fields as you reviewed them. */
    documentFields: jsonb('document_fields'),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('expenses_source_staging_id_idx').on(table.sourceStagingId),
    index('expenses_tax_year_type_idx').on(table.taxYear, table.expenseType),
  ],
);

export type ExpenseRow = typeof expenses.$inferSelect;
