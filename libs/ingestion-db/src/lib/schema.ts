import {
  bigint,
  char,
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
  TITLE_MAX_LENGTH,
  uploadStatusSchema,
  type FileFormat,
  type UploadStatus,
} from '@life-island/contracts';

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
    lastError: text('last_error'),
    categories: text('categories').array().notNull().default([]),
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

export type UploadRow = typeof uploads.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;
export type ParseRunRow = typeof parseRuns.$inferInsert;
