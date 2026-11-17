import { z } from 'zod';

/*
 * The AI spending guard (docs/security.md, "AI cost guards"): before a model
 * call, its service reserves the call's worst-case cost with svc-settings;
 * after, it settles the real cost. The limits come from the server's
 * environment, not from Settings, so nobody signed in can raise them.
 */

export const aiReserveRequestSchema = z.object({
  toolId: z.string().min(1).max(100),
  service: z.string().min(1).max(100),
  /** The signed-in person; null for background work. */
  userId: z.string().max(100).nullable(),
  /** The most the call can cost, in USD. */
  maxUsd: z.number().nonnegative().max(1000),
});
export type AiReserveRequest = z.infer<typeof aiReserveRequestSchema>;

export const aiSettleRequestSchema = z.object({
  actualUsd: z.number().nonnegative().max(1000),
});
export type AiSettleRequest = z.infer<typeof aiSettleRequestSchema>;

export interface AiReservationDto {
  reservationId: string;
}

/** The limits and what the signed-in person used of them, for Settings. */
export interface AiGuardStatusDto {
  limits: AiGuardLimits;
  monthSpentUsd: number;
  todaySpentUsd: number;
  lastHourCalls: number;
}

export interface AiGuardLimits {
  /** The whole island in a calendar month, whatever Settings says. */
  monthlyUsd: number;
  /** One person in a day. */
  userDailyUsd: number;
  userPerMinute: number;
  userPerHour: number;
  /** The worst case of one call. */
  maxCallUsd: number;
}
