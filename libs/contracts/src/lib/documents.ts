import { z } from 'zod';
import {
  FILE_FORMAT_EXTENSIONS,
  FILE_FORMAT_MIME_TYPES,
  FILE_FORMATS,
  MAX_UPLOAD_BYTES,
  DESCRIPTION_MAX_LENGTH,
  RECORD_STATUSES,
  TITLE_MAX_LENGTH,
  UPLOAD_STATUSES,
  type FileFormat,
  type ParseStep,
  type ProcessingState,
  type RecordStatus,
  type UploadStatus,
} from './constants.js';
import {
  categoryIdSchema,
  FIELD_KEY_PATTERN,
  type DocumentAnalysis,
  type ExtractedFields,
} from './categories.js';

export * from './constants.js';

/** File formats the platform accepts, detected from the file's bytes, never trusted from the client. */
export const fileFormatSchema = z.enum(FILE_FORMATS);
export const uploadStatusSchema = z.enum(UPLOAD_STATUSES);
export const recordStatusSchema = z.enum(RECORD_STATUSES);

export function fileFormatFromMime(mime: string): FileFormat | undefined {
  const normalized = mime.split(';')[0].trim().toLowerCase();
  return FILE_FORMATS.find((format) =>
    FILE_FORMAT_MIME_TYPES[format].includes(normalized),
  );
}

export function fileFormatFromFilename(
  filename: string,
): FileFormat | undefined {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return FILE_FORMATS.find((format) =>
    FILE_FORMAT_EXTENSIONS[format].includes(extension),
  );
}

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

// ---------------------------------------------------------------------------
// Ingestion API

export const createUploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  title: trimmedOptional(TITLE_MAX_LENGTH),
  description: trimmedOptional(DESCRIPTION_MAX_LENGTH),
});
export type CreateUploadRequest = z.input<typeof createUploadRequestSchema>;

/**
 * Your edits to a document. Every key is optional; what you send replaces
 * what is stored. `categories` is the full list of confirmed category ids.
 * `fields` sets extracted values by field key (null clears one); each value is
 * checked against its field type.
 */
export const updateUploadRequestSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH).optional(),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
  categories: z.array(categoryIdSchema).max(50).optional(),
  fields: z
    .record(
      z.string().regex(FIELD_KEY_PATTERN),
      z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});
export type UpdateUploadRequest = z.input<typeof updateUploadRequestSchema>;

/**
 * Parsed documents to send back to the parse queue: the AI starts over on
 * each, from classification, and assigns its categories and reads its fields
 * again. Only documents whose parsing finished (PARSED) qualify.
 */
export const reparseUploadsRequestSchema = z.object({
  uploadIds: z.array(z.uuid()).min(1).max(100),
});
export type ReparseUploadsRequest = z.input<typeof reparseUploadsRequestSchema>;

export interface ReparseUploadsResponse {
  /** Documents now waiting to be parsed again. */
  requeued: string[];
  /** Documents left as they were: unknown, or not parsed (yet, or any more). */
  skipped: string[];
}

export interface CreateUploadResponse {
  uploadId: string;
  /** Presigned PUT URL: send the file body here with the given headers. */
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export interface UploadDto {
  id: string;
  title: string;
  description: string | null;
  originalFilename: string;
  fileFormat: FileFormat | null;
  /** MIME type detected from the stored bytes; null until the upload completes. */
  mimeType: string | null;
  sizeBytes: number | null;
  status: UploadStatus;
  /** What the review UI shows: status and completed steps combined. */
  processingState: ProcessingState;
  /** Ids of the document categories assigned so far (see `/categories`). */
  categories: string[];
  targetKey: string | null;
  /** Data for the target of `targetKey`, which the review inbox confirms. */
  details: unknown;
  /** Type, purpose and characteristics; null until the CLASSIFY step is done. */
  analysis: DocumentAnalysis | null;
  /** Fields from the category templates; null until the EXTRACT step is done. */
  extractedFields: ExtractedFields | null;
  completedSteps: ParseStep[];
  remainingSteps: ParseStep[];
  /** The step running now, or the one that was interrupted. */
  currentStep: ParseStep | null;
  attempts: number;
  lastAttemptAt: string | null;
  /** When the worker may pick it up again (after a retry delay or a pause). */
  nextAttemptAt: string | null;
  flags: string[];
  lastError: string | null;
  createdAt: string;
  uploadedAt: string | null;
  parsedAt: string | null;
}

export interface CompleteUploadResponse {
  upload: UploadDto;
  /** True when the same file was already uploaded; `upload` is the earlier one. */
  duplicate: boolean;
}

export const listUploadsQuerySchema = z.object({
  status: uploadStatusSchema.optional(),
  /** A category id: matches documents with it or any of its descendants. */
  category: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Review API

/** A query parameter list: `A,B` or a repeated parameter, each a category id. */
const categoryIdListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => [
    ...new Set(
      (Array.isArray(value) ? value : [value])
        .flatMap((part) => part.split(','))
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(categoryIdSchema).max(50))
  .transform((ids) => (ids.length ? ids : undefined));

const booleanParam = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const recordSortSchema = z.enum(['uploadedAt', 'parsedAt', 'title']);

const optionalDate = z.iso.date().optional();

export const listRecordsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: recordStatusSchema.optional(),
  category: z.string().trim().max(64).optional(),
  /**
   * Confirmed document category ids, comma separated (`BILL` or
   * `BILL,MEDICAL`). A record matches when it has any of them or any of their
   * descendants, so `BILL` includes `WATER_BILL`.
   */
  documentCategory: categoryIdListSchema.optional(),
  /** `false` matches only the categories named, without their descendants. */
  includeSubcategories: booleanParam.default(true),
  fileFormat: fileFormatSchema.optional(),
  uploadedFrom: optionalDate,
  uploadedTo: optionalDate,
  sort: recordSortSchema.default('uploadedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListRecordsQuery = z.input<typeof listRecordsQuerySchema>;

export interface RecordDto {
  id: string;
  uploadId: string;
  title: string;
  description: string | null;
  fileFormat: FileFormat | null;
  status: RecordStatus;
  category: string | null;
  targetKey: string | null;
  /** Confirmed document category ids. */
  categories: string[];
  /** Category ids the AI suggested for the document, awaiting your decision. */
  suggestedCategories: string[];
  confidence: number | null;
  flags: string[];
  uploadedAt: string;
  parsedAt: string | null;
  confirmedAt: string | null;
  loadedAt: string | null;
  rejectedAt: string | null;
}

/**
 * Your corrections to a record before you confirm it: its details, checked
 * against the target schema, and optionally a different target (so a
 * different module). Changing the target checks the details against the new
 * target's schema: send details shaped for it, or the stored ones must fit.
 */
export const updateRecordRequestSchema = z
  .object({
    details: z.unknown().optional(),
    targetKey: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) => value.details !== undefined || value.targetKey !== undefined,
    'Send details, a targetKey or both',
  );
export type UpdateRecordRequest = z.input<typeof updateRecordRequestSchema>;

export interface RecordDetailDto extends RecordDto {
  /** The details to confirm: your edits if any, else what the parser extracted, shaped by the target schema of `targetKey`. */
  details: unknown;
  /** True once you edited the details. */
  edited: boolean;
  parseError: string | null;
  loadError: string | null;
  /** The target the AI chose, when you moved the record to another one. */
  aiTargetKey: string | null;
  rejectReason: string | null;
  /** The document's template fields as you reviewed them; sent along on confirm. */
  documentFields: Record<string, string | number | boolean | null> | null;
}

/** Reject a record: it is never sent to a module (reopen it to review again). */
export const rejectRecordRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RejectRecordRequest = z.input<typeof rejectRecordRequestSchema>;

/** The query of `GET /records/category-counts`: the record filters, without the category. */
export const categoryCountsQuerySchema = listRecordsQuerySchema.omit({
  documentCategory: true,
  includeSubcategories: true,
  sort: true,
  order: true,
  limit: true,
  offset: true,
});
export type CategoryCountsQuery = z.input<typeof categoryCountsQuerySchema>;

/** How many records the other filters leave in each category. */
export interface CategoryCountDto {
  id: string;
  /** Records that have this category itself. */
  direct: number;
  /** Records that have it or any of its descendants: what selecting it shows. */
  total: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
