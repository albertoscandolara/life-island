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
import type { DocumentAnalysis, ExtractedFields } from './categories.js';

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
  category: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Review API

export const recordSortSchema = z.enum(['uploadedAt', 'parsedAt', 'title']);

const optionalDate = z.iso.date().optional();

export const listRecordsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: recordStatusSchema.optional(),
  category: z.string().trim().max(64).optional(),
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
  confidence: number | null;
  flags: string[];
  uploadedAt: string;
  parsedAt: string | null;
  confirmedAt: string | null;
  loadedAt: string | null;
}

export interface RecordDetailDto extends RecordDto {
  /** The details extracted by the parser, shaped by the target schema of `targetKey`. */
  details: unknown;
  parseError: string | null;
  loadError: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
