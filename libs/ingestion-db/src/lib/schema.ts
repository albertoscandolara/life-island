import {
  bigint,
  boolean,
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
  DESCRIPTION_MAX_LENGTH,
  fileFormatSchema,
  parseQueueStatusSchema,
  suggestionStatusSchema,
  TITLE_MAX_LENGTH,
  uploadStatusSchema,
  type CategoryTemplate,
  type DocumentAnalysis,
  type ExtractedFields,
  type FileFormat,
  type ParseQueueStatus,
  type ParseStep,
  type ProviderErrorDetails,
  type SuggestionStatus,
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
export const parseQueueStatus = ingestion.enum(
  'parse_queue_status',
  parseQueueStatusSchema.options as [ParseQueueStatus, ...ParseQueueStatus[]],
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
    ...timestamps,
  },
  (table) => [
    index('uploads_claim_idx').on(table.status, table.nextAttemptAt),
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
    ...timestamps,
  },
  (table) => [
    check(
      'document_categories_id_format',
      sql`${table.id} ~ '^[A-Z][A-Z0-9_]{1,63}$'`,
    ),
    uniqueIndex('document_categories_title_idx').on(sql`lower(${table.title})`),
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
  lastRunSummary: jsonb('last_run_summary').$type<Record<string, number>>(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UploadRow = typeof uploads.$inferSelect;
export type CategoryRow = typeof documentCategories.$inferSelect;
export type CategorySuggestionRow = typeof categorySuggestions.$inferSelect;
export type ParseQueueRow = typeof parseQueue.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;
export type ParseRunRow = typeof parseRuns.$inferInsert;
