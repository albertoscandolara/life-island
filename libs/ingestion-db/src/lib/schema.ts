import {
  bigint,
  boolean,
  type AnyPgColumn,
  char,
  check,
  index,
  integer,
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
  categoryDimensionSchema,
  DESCRIPTION_MAX_LENGTH,
  historicalStatusSchema,
  reclassificationRunStatusSchema,
  fileFormatSchema,
  parseQueueStatusSchema,
  suggestionStatusSchema,
  TITLE_MAX_LENGTH,
  uploadStatusSchema,
  type CategoryDimension,
  type CategoryTemplate,
  DOCUMENT_LINK_STATUSES,
  type DocumentAnalysis,
  type DocumentLinkStatus,
  type ExtractedFields,
  type FileFormat,
  type HistoricalStatus,
  type HistoricalSuggestion,
  type ParseQueueStatus,
  type ReclassificationBlock,
  type ReclassificationRunStatus,
  type ReclassificationTrigger,
  type ParseStep,
  type ProviderErrorDetails,
  type SuggestionStatus,
  type TransactionFacts,
  type UploadStatus,
} from '@life-island/contracts';
import { sql } from 'drizzle-orm';

/**
 * Tables of the `ingestion` schema. svc-ingestion owns the migrations; the
 * parse worker, part of the same bounded context, reads and updates them.
 * `outbox` and `processed_events` come from infra/postgres/init/02-outbox.sql.
 */
export const ingestion = pgSchema('ingestion');

export const uploadStatus = ingestion.enum(
  'upload_status',
  uploadStatusSchema.options as [UploadStatus, ...UploadStatus[]],
);
export const fileFormat = ingestion.enum(
  'file_format',
  fileFormatSchema.options as [FileFormat, ...FileFormat[]],
);
export const suggestionStatus = ingestion.enum(
  'suggestion_status',
  suggestionStatusSchema.options as [SuggestionStatus, ...SuggestionStatus[]],
);
export const categoryDimension = ingestion.enum(
  'category_dimension',
  categoryDimensionSchema.options as [
    CategoryDimension,
    ...CategoryDimension[],
  ],
);
export const parseQueueStatus = ingestion.enum(
  'parse_queue_status',
  parseQueueStatusSchema.options as [ParseQueueStatus, ...ParseQueueStatus[]],
);

export const historicalStatus = ingestion.enum(
  'historical_status',
  historicalStatusSchema.options as [HistoricalStatus, ...HistoricalStatus[]],
);
export const reclassificationRunStatus = ingestion.enum(
  'reclassification_run_status',
  reclassificationRunStatusSchema.options as [
    ReclassificationRunStatus,
    ...ReclassificationRunStatus[],
  ],
);

export const documentLinkStatus = ingestion.enum(
  'document_link_status',
  DOCUMENT_LINK_STATUSES as unknown as [
    DocumentLinkStatus,
    ...DocumentLinkStatus[],
  ],
);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/**
 * One row per uploaded file. Holds the metadata (the file itself lives in
 * object storage under `storage_key`) and, once parsed, the categories and
 * the details JSON extracted by the parser.
 */
export const uploads = ingestion.table(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: TITLE_MAX_LENGTH }).notNull(),
    description: varchar('description', { length: DESCRIPTION_MAX_LENGTH }),
    originalFilename: text('original_filename').notNull(),
    declaredMime: text('declared_mime'),
    detectedMime: text('detected_mime'),
    fileFormat: fileFormat('file_format'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: char('sha256', { length: 64 }),
    storageKey: text('storage_key').notNull(),
    status: uploadStatus('status').notNull().default('UPLOADING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Set on each claim; every write of the worker checks it, so a lost lease writes nothing. */
    lockToken: uuid('lock_token'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Ids of rows in `document_categories` (an array has no foreign key; the worker checks them). */
    categories: text('categories').array().notNull().default([]),
    /** Parse steps whose results are saved; a resumed document skips them. */
    completedSteps: text('completed_steps')
      .array()
      .$type<ParseStep[]>()
      .notNull()
      .default([]),
    currentStep: text('current_step').$type<ParseStep>(),
    analysis: jsonb('analysis').$type<DocumentAnalysis>(),
    extractedFields: jsonb('extracted_fields').$type<ExtractedFields>(),
    targetKey: text('target_key'),
    details: jsonb('details'),
    confidence: numeric('confidence', {
      precision: 3,
      scale: 2,
      mode: 'number',
    }),
    flags: text('flags').array().notNull().default([]),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    /**
     * Taxonomy version the CLASSIFY step saw: every category up to it was
     * already compared with the document. Written by the initial parser only.
     */
    classifiedCategoryVersion: integer('classified_category_version'),
    /**
     * Taxonomy version against which the historical reclassification last
     * finished with the document (no findings, or your review done). Null:
     * never. Written by the historical workflow only.
     */
    historicalReviewedVersion: integer('historical_reviewed_version'),
    /** Version a run checked it against while its findings wait for your review. */
    historicalProcessingVersion: integer('historical_processing_version'),
    /** Null: normal. RECLASSIFYING while a run checks it, PENDING_REVIEW while findings wait. */
    historicalStatus: historicalStatus('historical_status'),
    historicalSuggestions: jsonb('historical_suggestions')
      .$type<HistoricalSuggestion[]>()
      .notNull()
      .default([]),
    /** The run that set RECLASSIFYING, so a crashed run's documents can be reset. */
    historicalRunId: uuid('historical_run_id'),
    /** Categories declined for this document (by any workflow); never proposed for it again. */
    rejectedCategories: text('rejected_categories')
      .array()
      .notNull()
      .default([]),
    /**
     * The money facts (invoice, quote, payment or none) read from the content
     * once the document is PARSED; null until then. The invoice and payment
     * matcher works on these only. Cleared when the document is parsed again.
     */
    transactionFacts: jsonb('transaction_facts').$type<TransactionFacts>(),
    ...timestamps,
  },
  (table) => [
    index('uploads_claim_idx').on(table.status, table.nextAttemptAt),
    index('uploads_historical_status_idx')
      .on(table.historicalStatus)
      .where(sql`${table.historicalStatus} is not null`),
    index('uploads_created_at_idx').on(table.createdAt),
    index('uploads_categories_idx').using('gin', table.categories),
    uniqueIndex('uploads_sha256_idx').on(table.sha256),
  ],
);

/** One row per model call, for cost tracking, debugging and evals. */
export const parseRuns = ingestion.table('parse_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadId: uuid('upload_id')
    .notNull()
    .references(() => uploads.id, { onDelete: 'cascade' }),
  step: text('step').notNull(), // classify | extract | correct
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  rawOutput: jsonb('raw_output'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The category taxonomy (`WATER_BILL`, `INVOICE`, `LIDL`...). The AI assigns
 * existing ones and suggests new ones; a suggestion becomes a row here only
 * once you approve it (or when automatic approval is configured).
 *
 * Categories form trees: `parent_id` points at the direct parent (null for a
 * root). The foreign key keeps a parent from being deleted under its
 * children, and a trigger (migration 0004) rejects cycles. `dimension` says
 * which metadata dimension a tree belongs to (document type, subject,
 * property...); a child always has its parent's.
 */
export const documentCategories = ingestion.table(
  'document_categories',
  {
    id: text('id').primaryKey(),
    title: varchar('title', { length: 100 }).notNull(),
    description: text('description').notNull(),
    templateJson: jsonb('template_json')
      .$type<CategoryTemplate>()
      .notNull()
      .default({ fields: [] }),
    parentId: text('parent_id').references(
      (): AnyPgColumn => documentCategories.id,
      { onDelete: 'restrict' },
    ),
    dimension: categoryDimension('dimension'),
    /** The taxonomy version that confirmed it (one per confirming operation). */
    taxonomyVersion: integer('taxonomy_version').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('document_categories_version_idx').on(table.taxonomyVersion),
    check(
      'document_categories_id_format',
      sql`${table.id} ~ '^[A-Z][A-Z0-9_]{1,63}$'`,
    ),
    check(
      'document_categories_not_own_parent',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    uniqueIndex('document_categories_title_idx').on(sql`lower(${table.title})`),
    index('document_categories_parent_idx').on(table.parentId),
  ],
);

/**
 * Categories the AI proposed. At most one PENDING row per proposed id, so
 * documents that suggest the same category add themselves to `upload_ids`
 * instead of creating duplicates.
 */
export const categorySuggestions = ingestion.table(
  'category_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: text('category_id').notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    description: text('description').notNull(),
    templateJson: jsonb('template_json').$type<CategoryTemplate>().notNull(),
    reason: text('reason'),
    /**
     * Where the AI would place the category: an existing parent (no foreign
     * key: the parent may be deleted before you decide, and approval checks
     * it again) and the dimension (issuer, property...). Your edits win.
     */
    parentId: text('parent_id'),
    dimension: categoryDimension('dimension'),
    status: suggestionStatus('status').notNull().default('PENDING'),
    uploadIds: uuid('upload_ids').array().notNull().default([]),
    approvedCategoryId: text('approved_category_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('category_suggestions_pending_idx')
      .on(table.categoryId)
      .where(sql`${table.status} = 'PENDING'`),
    index('category_suggestions_upload_ids_idx').using('gin', table.uploadIds),
  ],
);

/**
 * The parse queue's durable state: one row (`id = 'documents'`). It records
 * a quota or rate-limit pause and when to try again, so a restart neither
 * forgets the pause nor hammers the provider.
 */
export const parseQueue = ingestion.table('parse_queue', {
  id: text('id').primaryKey(),
  status: parseQueueStatus('status').notNull().default('IDLE'),
  pauseReason: text('pause_reason'),
  providerError: jsonb('provider_error').$type<ProviderErrorDetails>(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  resumeAt: timestamp('resume_at', { withTimezone: true }),
  resumeAtReliable: boolean('resume_at_reliable').notNull().default(false),
  /** Consecutive pauses without a successful AI call; spaces out blind retries. */
  resumeAttempts: integer('resume_attempts').notNull().default(0),
  runStartedAt: timestamp('run_started_at', { withTimezone: true }),
  runFinishedAt: timestamp('run_finished_at', { withTimezone: true }),
  nextScheduledRunAt: timestamp('next_scheduled_run_at', {
    withTimezone: true,
  }),
  /** When you last pressed Parse now; the worker hears it through NOTIFY parse_requested. */
  runRequestedAt: timestamp('run_requested_at', { withTimezone: true }),
  lastRunSummary: jsonb('last_run_summary').$type<Record<string, number>>(),
  /** The parse worker's heartbeat: it writes it every few seconds while it runs. */
  workerSeenAt: timestamp('worker_seen_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The taxonomy's state: one row (`id = 'global'`). `version` goes up by one
 * for every operation that confirms categories, however many it confirms,
 * in the same transaction. Also the reclassification schedule and requests.
 */
export const taxonomyState = ingestion.table('taxonomy_state', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
  nextReclassificationAt: timestamp('next_reclassification_at', {
    withTimezone: true,
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per reclassification run, including those that could not start
 * (BLOCKED). A RUNNING row whose lease has not expired is the global lock:
 * at most one exists (unique partial index).
 */
export const reclassificationRuns = ingestion.table(
  'reclassification_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: text('trigger').$type<ReclassificationTrigger>().notNull(),
    status: reclassificationRunStatus('status').notNull(),
    targetVersion: integer('target_version'),
    blockedReasons: jsonb('blocked_reasons')
      .$type<ReclassificationBlock[]>()
      .notNull()
      .default([]),
    /** Renewed by the worker while it runs; once past, the lock is free. */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    summary: jsonb('summary')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('reclassification_runs_one_running_idx')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'RUNNING'`),
    index('reclassification_runs_requested_at_idx').on(table.requestedAt),
  ],
);

/**
 * An invoice (or quote) and a payment that settles it. The matcher writes
 * AUTO and SUGGESTED rows and recomputes them from all documents whenever
 * money facts change, so the result never depends on the upload order; your
 * CONFIRMED and REJECTED rows are decisions it never touches. Deleting either
 * document deletes the link.
 */
export const documentLinks = ingestion.table(
  'document_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceUploadId: uuid('invoice_upload_id')
      .notNull()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    paymentUploadId: uuid('payment_upload_id')
      .notNull()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    status: documentLinkStatus('status').notNull(),
    score: numeric('score', { precision: 6, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    /** When you confirmed, linked or rejected it; null for the matcher's own rows. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('document_links_pair_idx').on(
      table.invoiceUploadId,
      table.paymentUploadId,
    ),
    index('document_links_payment_idx').on(table.paymentUploadId),
    index('document_links_status_idx').on(table.status),
    check(
      'document_links_two_documents',
      sql`${table.invoiceUploadId} <> ${table.paymentUploadId}`,
    ),
  ],
);

export type UploadRow = typeof uploads.$inferSelect;
export type DocumentLinkRow = typeof documentLinks.$inferSelect;
export type CategoryRow = typeof documentCategories.$inferSelect;
export type CategorySuggestionRow = typeof categorySuggestions.$inferSelect;
export type ParseQueueRow = typeof parseQueue.$inferSelect;
export type ReclassificationRunRow = typeof reclassificationRuns.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;
export type ParseRunRow = typeof parseRuns.$inferInsert;

/**
 * The parse worker's copy of the settings it reads (svc-settings publishes
 * `settings.changed@1`): the switch of every document AI tool and the
 * auto-approval of suggested categories (libs/be-common ai-tools.ts).
 */
export const settingsReplica = ingestion.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
