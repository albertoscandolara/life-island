import {
  boolean,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  DESCRIPTION_MAX_LENGTH,
  recordStatusSchema,
  TITLE_MAX_LENGTH,
  type RecordStatus,
} from '@life-island/contracts';

export const review = pgSchema('review');

export const recordStatus = review.enum(
  'record_status',
  recordStatusSchema.options as [RecordStatus, ...RecordStatus[]],
);

/**
 * The review inbox: one record per uploaded document, built from the
 * ingestion events (it never reads the ingestion schema). `ai_payload` is what
 * the parser produced and is never modified; `reviewed_payload` holds your
 * edits, so every correction becomes eval data.
 */
export const stagingRecords = review.table(
  'staging_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadId: uuid('upload_id').notNull(), // by id only: no cross-schema foreign keys
    title: varchar('title', { length: TITLE_MAX_LENGTH }).notNull(),
    description: varchar('description', { length: DESCRIPTION_MAX_LENGTH }),
    originalFilename: text('original_filename').notNull(),
    fileFormat: text('file_format'),
    status: recordStatus('status').notNull().default('UPLOADED'),
    /** The module the record goes to (groceries, tax730, other), from its target. */
    category: text('category'),
    targetKey: text('target_key'),
    /** The target the parser chose; kept when you move the record to another one. */
    aiTargetKey: text('ai_target_key'),
    /** Confirmed document category ids, mirrored from ingestion's `upload.updated`. */
    categories: text('categories').array().notNull().default([]),
    /** Category ids the AI suggested for the document, awaiting a decision. */
    suggestedCategories: text('suggested_categories')
      .array()
      .notNull()
      .default([]),
    /**
     * Historical reclassification overlay mirrored from `upload.updated`
     * (null: normal; RECLASSIFYING, PENDING_REVIEW). Never changes `status`.
     */
    historicalStatus: text('historical_status'),
    /** Ids of confirmed categories a later check found, awaiting your decision. */
    historicalSuggestions: text('historical_suggestions')
      .array()
      .notNull()
      .default([]),
    /** `updatedAt` of the last `upload.updated` applied; older snapshots are ignored. */
    metadataUpdatedAt: timestamp('metadata_updated_at', { withTimezone: true }),
    /** The document's template field values, mirrored from `upload.updated`. */
    documentFields:
      jsonb('document_fields').$type<
        Record<string, string | number | boolean | null>
      >(),
    aiPayload: jsonb('ai_payload'),
    reviewedPayload: jsonb('reviewed_payload'),
    confidence: numeric('confidence', {
      precision: 3,
      scale: 2,
      mode: 'number',
    }),
    flags: text('flags').array().notNull().default([]),
    parseError: text('parse_error'),
    loadError: text('load_error'),
    domainRecordId: text('domain_record_id'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    loadedAt: timestamp('loaded_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    /** Set when the document was deleted; the row stays as a tombstone so late events cannot bring it back. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('staging_records_upload_id_idx').on(table.uploadId),
    index('staging_records_status_category_idx').on(
      table.status,
      table.category,
    ),
    index('staging_records_uploaded_at_idx').on(table.uploadedAt),
    index('staging_records_categories_idx').using('gin', table.categories),
  ],
);

/**
 * The review service's copy of the category hierarchy, kept from
 * ingestion's `category.changed` events (it never reads the ingestion
 * schema). Only what filtering needs: id, title, parent and dimension. A
 * deleted category stays as a tombstone (`deleted`), so an older event cannot
 * bring it back; filters ignore tombstones.
 */
export const categoryTree = review.table(
  'category_tree',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    parentId: text('parent_id'),
    dimension: text('dimension'),
    deleted: boolean('deleted').notNull().default(false),
    /** `changedAt` of the last event applied; older ones are ignored. */
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('category_tree_parent_idx').on(table.parentId)],
);

export type StagingRecordRow = typeof stagingRecords.$inferSelect;
