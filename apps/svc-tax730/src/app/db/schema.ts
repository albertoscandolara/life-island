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
import { sql } from 'drizzle-orm';

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
    /** What the expense was for, as it reads in the commercialista's summary. */
    description: text('description'),
    /** Your own note, e.g. "payment proof on its way". */
    notes: text('notes'),
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

/**
 * The documents you uploaded, mirrored from ingestion's `upload.*` events so
 * the 730 area can show and attach them without reading another schema.
 * A deleted document stays as a tombstone (`deleted_at`).
 */
export const documents = tax730.table('documents', {
  uploadId: uuid('upload_id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  originalFilename: text('original_filename').notNull(),
  fileFormat: text('file_format'),
  categories: text('categories').array().notNull().default([]),
  fields:
    jsonb('fields').$type<Record<string, string | number | boolean | null>>(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
  /** `updatedAt` of the last `upload.updated` applied; older snapshots are ignored. */
  metadataUpdatedAt: timestamp('metadata_updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type DocumentRow = typeof documents.$inferSelect;

/**
 * Documents filed for the 730: an expense's invoice and payment proof, or a
 * document of the whole year (expense_id null) such as the Certificazione Unica.
 */
export const attachments = tax730.table(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taxYear: integer('tax_year')
      .notNull()
      .references(() => taxYears.taxYear),
    expenseId: uuid('expense_id').references(() => expenses.id, {
      onDelete: 'cascade',
    }),
    /** By id only: the document lives in ingestion. */
    uploadId: uuid('upload_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('attachments_expense_upload_idx')
      .on(table.expenseId, table.uploadId)
      .where(sql`${table.expenseId} is not null`),
    uniqueIndex('attachments_year_upload_idx')
      .on(table.taxYear, table.uploadId)
      .where(sql`${table.expenseId} is null`),
    index('attachments_tax_year_idx').on(table.taxYear),
  ],
);

export type AttachmentRow = typeof attachments.$inferSelect;
