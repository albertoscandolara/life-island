import { z } from 'zod';
import {
  categoryIdSchema,
  updateSuggestionRequestSchema,
} from './categories.js';
import {
  HISTORICAL_STATUSES,
  RECLASSIFICATION_BLOCK_REASONS,
  RECLASSIFICATION_RUN_STATUSES,
  RECLASSIFICATION_TRIGGERS,
  type HistoricalStatus,
  type ReclassificationBlockReason,
  type ReclassificationRunStatus,
  type ReclassificationTrigger,
} from './constants.js';

/**
 * Taxonomy evolution and historical reclassification: documents parsed in the
 * past are checked again, once a month or on request, against the categories
 * confirmed since. What it finds is kept apart from the document's categories
 * and from the parser's suggestions until you decide.
 */

export const historicalStatusSchema = z.enum(HISTORICAL_STATUSES);
export const reclassificationRunStatusSchema = z.enum(
  RECLASSIFICATION_RUN_STATUSES,
);
export const reclassificationTriggerSchema = z.enum(RECLASSIFICATION_TRIGGERS);
export const reclassificationBlockReasonSchema = z.enum(
  RECLASSIFICATION_BLOCK_REASONS,
);

/** A confirmed category that a later check found for a document. */
export interface HistoricalSuggestion {
  categoryId: string;
  /** What in the document shows it applies. */
  evidence: string;
  confidence: number;
}

export const historicalSuggestionSchema = z.object({
  categoryId: categoryIdSchema,
  evidence: z.string().max(1000),
  confidence: z.number().min(0).max(1),
});

/** Several suggested categories confirmed in one operation (one taxonomy version). */
export const approveSuggestionsRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        /** Your edits to the suggestion before it becomes a category. */
        overrides: updateSuggestionRequestSchema.optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type ApproveSuggestionsRequest = z.input<
  typeof approveSuggestionsRequestSchema
>;

/**
 * Your decisions on a document's suggested categories, sent once with the
 * review panel's final Confirm. Approved parser suggestions become categories
 * (all of them in one taxonomy version); declined ones are declined for this
 * document only. Accepted historical suggestions are added to the document;
 * rejected ones are remembered so they are never proposed again for it.
 */
export const categoryDecisionsSchema = z.object({
  approveSuggestions: z.array(z.uuid()).max(100).default([]),
  declineSuggestions: z.array(z.uuid()).max(100).default([]),
  acceptHistorical: z.array(categoryIdSchema).max(100).default([]),
  rejectHistorical: z.array(categoryIdSchema).max(100).default([]),
});
export type CategoryDecisions = z.input<typeof categoryDecisionsSchema>;

export interface ReclassificationBlock {
  code: ReclassificationBlockReason;
  message: string;
}

export interface ReclassificationRunDto {
  id: string;
  trigger: ReclassificationTrigger;
  status: ReclassificationRunStatus;
  /** The taxonomy version the documents were checked against. */
  targetVersion: number | null;
  blockedReasons: ReclassificationBlock[];
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Counts so far: eligible, checked, suggested, unchanged, failed. */
  summary: Record<string, number>;
  lastError: string | null;
}

/** Everything the documents app needs about reclassification, in one call. */
export interface ReclassificationStateDto {
  /** True while a run holds the lock: uploads, parsing and category changes wait. */
  locked: boolean;
  taxonomyVersion: number;
  currentRun: ReclassificationRunDto | null;
  lastRun: ReclassificationRunDto | null;
  /** Whether a run could start now, and if not why. */
  canStart: boolean;
  blockedReasons: ReclassificationBlock[];
  /** Documents with newer categories waiting for your decision. */
  pendingReview: number;
  nextScheduledRunAt: string | null;
}

/** The body of a 423 answer while a reclassification holds the lock. */
export interface ReclassificationLockedError {
  statusCode: 423;
  code: 'RECLASSIFICATION_RUNNING';
  message: string;
  runId: string;
  startedAt: string | null;
}

export type { HistoricalStatus };
