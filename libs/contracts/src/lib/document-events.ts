import { z } from 'zod';
import { parseStepSchema } from './categories.js';
import { fileFormatSchema } from './documents.js';

/**
 * Events about a document's journey. Each is published from the producer's
 * outbox; the `*_EVENT` constant is the versioned type to enqueue and subscribe to.
 */

export const UPLOAD_COMPLETED_EVENT = 'upload.completed@1';
export const uploadCompletedV1 = z.object({
  uploadId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  originalFilename: z.string(),
  fileFormat: fileFormatSchema,
  sizeBytes: z.number().int(),
  uploadedAt: z.iso.datetime({ offset: true }),
});
export type UploadCompletedV1 = z.infer<typeof uploadCompletedV1>;

export const UPLOAD_PARSING_STARTED_EVENT = 'upload.parsing_started@1';
export const uploadParsingStartedV1 = z.object({
  uploadId: z.uuid(),
  attempt: z.number().int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
});
export type UploadParsingStartedV1 = z.infer<typeof uploadParsingStartedV1>;

export const DOCUMENT_PARSED_EVENT = 'document.parsed@1';
export const documentParsedV1 = uploadCompletedV1.extend({
  category: z.string(),
  targetKey: z.string(),
  details: z.unknown(),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string()),
  parsedAt: z.iso.datetime({ offset: true }),
});
export type DocumentParsedV1 = z.infer<typeof documentParsedV1>;

export const DOCUMENT_PARSE_FAILED_EVENT = 'document.parse_failed@1';
export const documentParseFailedV1 = z.object({
  uploadId: z.uuid(),
  error: z.string(),
  attempts: z.number().int(),
  failedAt: z.iso.datetime({ offset: true }),
});
export type DocumentParseFailedV1 = z.infer<typeof documentParseFailedV1>;

/**
 * Parsing stopped before every step finished, and the document will be picked
 * up again: the AI quota ran out, the provider rate-limited the worker, or a
 * temporary error will be retried. Completed steps stay saved.
 */
export const DOCUMENT_PARSE_INTERRUPTED_EVENT = 'document.parse_interrupted@1';
export const documentParseInterruptedV1 = z.object({
  uploadId: z.uuid(),
  reason: z.enum([
    'QUOTA_EXHAUSTED',
    'RATE_LIMITED',
    'CREDENTIALS',
    'TRANSIENT_ERROR',
  ]),
  completedSteps: z.array(parseStepSchema),
  error: z.string(),
  /** When parsing can resume; null when unknown. */
  resumeAt: z.iso.datetime({ offset: true }).nullable(),
  interruptedAt: z.iso.datetime({ offset: true }),
});
export type DocumentParseInterruptedV1 = z.infer<
  typeof documentParseInterruptedV1
>;

/** Emitted by the review service when you confirm a record; domain services load it. */
export const RECORD_APPROVED_EVENT = 'record.approved@1';
export const recordApprovedV1 = z.object({
  recordId: z.uuid(),
  uploadId: z.uuid(),
  category: z.string(),
  targetKey: z.string(),
  payload: z.unknown(),
  approvedAt: z.iso.datetime({ offset: true }),
});
export type RecordApprovedV1 = z.infer<typeof recordApprovedV1>;

/** Domain services answer `record.approved` with one of these two. */
export const RECORD_LOADED_EVENT = 'record.loaded@1';
export const recordLoadedV1 = z.object({
  recordId: z.uuid(),
  domainRecordId: z.string(),
  loadedAt: z.iso.datetime({ offset: true }),
});
export type RecordLoadedV1 = z.infer<typeof recordLoadedV1>;

export const RECORD_LOAD_FAILED_EVENT = 'record.load_failed@1';
export const recordLoadFailedV1 = z.object({
  recordId: z.uuid(),
  error: z.string(),
  failedAt: z.iso.datetime({ offset: true }),
});
export type RecordLoadFailedV1 = z.infer<typeof recordLoadFailedV1>;
