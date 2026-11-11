import { z } from 'zod';

/*
 * Field schemas the record-keeping modules share (Agenda, Money, Goals,
 * Health, Subscriptions, Mailbox, Travel, Fitness), so a date, an amount or a
 * note is checked the same way in every one of them.
 */

export const lifeDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-11');

/** A required short text, e.g. a name. */
export const lifeName = (max = 120) =>
  z.string().trim().min(1, 'Write something here').max(max);

/** An optional text: empty becomes null. */
export const lifeNote = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const lifeOptionalDate = lifeDate.nullable().optional();

/** An amount in euro; negative only where the field says so. */
export const lifeAmount = z.number().min(0).max(10_000_000);
export const lifeSignedAmount = z.number().min(-10_000_000).max(10_000_000);

export const lifeUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\//i, 'Start the link with https://')
  .nullable()
  .optional();

/** `HH:MM`, 24 hours. */
export const lifeTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30')
  .nullable()
  .optional();

/** What a record-keeping module returns for one row: the request's fields, an id and when it was added. */
export type LifeRecord<T> = T & { id: string; createdAt: string };

/** The badge of an island area: what needs you (same shape as People's). */
export interface LifeAttentionDto {
  expired: number;
  expiring: number;
  toReview: number;
}

/** An AI tool's answer kept by a module, with who wrote it. */
export interface LifeAiAnswerDto<T> {
  id: string;
  question: string | null;
  output: T;
  /** `claude`, or `offline` when Life Island's own rules wrote it. */
  source: 'claude' | 'offline';
  model: string | null;
  createdAt: string;
}

export const lifeQuestionRequestSchema = z.object({
  question: z.string().trim().max(1000).nullable().optional(),
});
export type LifeQuestionRequest = z.input<typeof lifeQuestionRequestSchema>;
