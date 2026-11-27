/*
 * Study now: a session timed in the browser, logged on its step or course
 * when you stop it.
 */

/** Where the running session is kept, so a reload or a tab switch keeps it. */
export const STUDY_TIMER_KEY = 'studies.running-session';

export interface RunningSession {
  /** The Up next card it started from. */
  key: string;
  title: string;
  stepId: string | null;
  courseId: string | null;
  /** Epoch milliseconds. */
  startedAt: number;
}

/**
 * The minutes a timed session logs: to the nearest five, at least five (the
 * shortest session the API takes) and at most sixteen hours.
 */
export function sessionMinutes(elapsedMs: number): number {
  const minutes = Math.round(elapsedMs / 60_000 / 5) * 5;
  return Math.min(16 * 60, Math.max(5, minutes));
}
