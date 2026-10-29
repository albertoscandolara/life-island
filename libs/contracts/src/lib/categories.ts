import { z } from 'zod';
import {
  FIELD_STATUSES,
  PARSE_QUEUE_STATUSES,
  PARSE_STEPS,
  SUGGESTION_STATUSES,
  TEMPLATE_FIELD_TYPES,
  type FieldStatus,
  type ParseQueueStatus,
  type ParseStep,
  type SuggestionStatus,
} from './constants.js';

/**
 * Document categories: a reusable taxonomy (`BILL`, `WATER_BILL`, `LIDL`...)
 * stored in `ingestion.document_categories`. A document can have many. Each
 * category carries a template: the fields worth extracting from documents
 * that belong to it.
 */

/** Stable category id: UPPER_SNAKE_CASE, e.g. `WATER_BILL`. */
export const CATEGORY_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Template field key: lower_snake_case, shared across templates when the meaning is the same. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const parseStepSchema = z.enum(PARSE_STEPS);
export const parseQueueStatusSchema = z.enum(PARSE_QUEUE_STATUSES);
export const suggestionStatusSchema = z.enum(SUGGESTION_STATUSES);
export const fieldStatusSchema = z.enum(FIELD_STATUSES);
export const templateFieldTypeSchema = z.enum(TEMPLATE_FIELD_TYPES);

export const categoryIdSchema = z
  .string()
  .trim()
  .regex(CATEGORY_ID_PATTERN, 'use UPPER_SNAKE_CASE, e.g. WATER_BILL');

export const templateFieldSchema = z
  .object({
    key: z
      .string()
      .regex(FIELD_KEY_PATTERN, 'use lower_snake_case, e.g. total_amount'),
    label: z.string().trim().min(1).max(100),
    type: templateFieldTypeSchema,
    description: z.string().trim().max(500).default(''),
    required: z.boolean().default(false),
    /** Unit of a numeric field, e.g. `m3` or `kWh`. */
    unit: z.string().trim().max(20).optional(),
    /** Allowed values of an `enum` field. */
    options: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    /** Optional regular expression the value must match, e.g. an Italian VAT number. */
    pattern: z.string().max(200).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && !field.options?.length)
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'an enum field needs options',
      });
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['pattern'],
          message: 'not a valid regular expression',
        });
      }
    }
  });
export type TemplateField = z.output<typeof templateFieldSchema>;

/** `template_json`: the fields to extract from documents of a category. */
export const categoryTemplateSchema = z
  .object({ fields: z.array(templateFieldSchema).max(40) })
  .superRefine((template, ctx) => {
    const seen = new Set<string>();
    template.fields.forEach((field, index) => {
      if (seen.has(field.key))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: `duplicate field key "${field.key}"`,
        });
      seen.add(field.key);
    });
  });
export type CategoryTemplate = z.output<typeof categoryTemplateSchema>;

export interface CategoryDto {
  id: string;
  title: string;
  description: string;
  template: CategoryTemplate;
  createdAt: string;
  updatedAt: string;
}

export const updateCategoryRequestSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  template: categoryTemplateSchema.optional(),
});
export type UpdateCategoryRequest = z.input<typeof updateCategoryRequestSchema>;

export interface CategorySuggestionDto {
  id: string;
  /** The proposed category id, e.g. `ELECTRICITY_BILL`. */
  categoryId: string;
  title: string;
  description: string;
  template: CategoryTemplate;
  /** Why the AI proposed it, from the first document that did. */
  reason: string | null;
  status: SuggestionStatus;
  /** Documents that led to the suggestion; they get the category when it is approved. */
  uploadIds: string[];
  /** Id the category was saved under (it can be renamed on approval). */
  approvedCategoryId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export const listSuggestionsQuerySchema = z.object({
  status: suggestionStatusSchema.optional(),
  uploadId: z.uuid().optional(),
});

/** Approve a suggestion as is, or with your edits to any field. */
export const approveSuggestionRequestSchema = z
  .object({
    id: categoryIdSchema.optional(),
    title: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    template: categoryTemplateSchema.optional(),
  })
  .default({});
export type ApproveSuggestionRequest = z.input<
  typeof approveSuggestionRequestSchema
>;

// ---------------------------------------------------------------------------
// What the parse worker saves on each upload

/** Result of the CLASSIFY step, stored in `uploads.analysis`. */
export interface DocumentAnalysis {
  /** What the document is, e.g. "water bill". */
  documentType: string;
  /** What it is for, e.g. "request to pay for water used in Q3 2026". */
  purpose: string;
  /** Other useful traits: "recurring", "paid by direct debit"... */
  characteristics: string[];
  issuer: string | null;
  language: string;
  summary: string;
  /** Why each existing category was assigned. */
  categoryEvidence: { id: string; evidence: string }[];
  confidence: number;
  warnings: string[];
}

export interface ExtractedField {
  label: string;
  type: TemplateField['type'];
  /** Normalized value (ISO dates, numbers); null unless `status` is `found`. */
  value: string | number | boolean | null;
  status: FieldStatus;
  /** What the document says, when it differs from `value` or could not be used. */
  raw?: string | null;
  /** The competing readings of an ambiguous or conflicting field. */
  candidates?: string[];
  note?: string | null;
  unit?: string;
  required: boolean;
  /** Categories whose templates ask for this field. */
  categories: string[];
}

/** Result of the EXTRACT step, stored in `uploads.extracted_fields`. */
export interface ExtractedFields {
  fields: Record<string, ExtractedField>;
  /** Unresolved issues: missing required fields, conflicts, template clashes. */
  warnings: string[];
}

export interface ProviderErrorDetails {
  status?: number;
  type?: string;
  message: string;
  requestId?: string;
}

/** The parse queue, for the status banner in the review UI. */
export interface ParseQueueDto {
  status: ParseQueueStatus;
  /** Plain-language reason processing stopped. */
  pauseReason: string | null;
  providerError: ProviderErrorDetails | null;
  pausedAt: string | null;
  /** When the worker will next try the AI provider again. */
  resumeAt: string | null;
  /**
   * True when `resumeAt` comes from the provider (a reset time or retry-after);
   * false when it is only the worker's next conservative check.
   */
  resumeAtReliable: boolean;
  runStartedAt: string | null;
  runFinishedAt: string | null;
  nextScheduledRunAt: string | null;
  lastRunSummary: Record<string, number> | null;
  /** How many documents wait for the AI. */
  pendingDocuments: number;
}

export type { ParseStep };
