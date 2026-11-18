import type { HttpErrorResponse } from '@angular/common/http';

/*
 * How the record-keeping areas write numbers, dates and errors, so every area
 * says "in 5 days", "€ 12,50" and "11 nov 2026" the same way.
 */

// Italian leaves 4-digit amounts ungrouped (3200,00 €); 'always' groups them
// too, as every area writes them. The ES2023 option is missing from the
// es2022 lib typings.
const GROUP_THOUSANDS = {
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions;

export function euro(value: number | null | undefined, cents = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return value.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    ...GROUP_THOUSANDS,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** "11 nov 2026". */
export function dateText(date: string | null | undefined): string {
  if (!date) return '–';
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

/** "mer 11 nov". */
export function dayText(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
}

/** "November 2026" from `2026-11` or a date. */
export function monthText(month: string, short = false): string {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString('en-GB', {
        month: short ? 'short' : 'long',
        year: short ? '2-digit' : 'numeric',
      });
}

/** "in 5 days", "today", "3 days ago". */
export function daysText(days: number | null | undefined): string {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0)
    return days > 60 ? `in ${Math.round(days / 30)} months` : `in ${days} days`;
  return -days > 60
    ? `${Math.round(-days / 30)} months ago`
    : `${-days} days ago`;
}

/** "2 h 30 min", "45 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function percent(share: number | null | undefined, digits = 0): string {
  if (share === null || share === undefined || Number.isNaN(share)) return '–';
  return `${(share * 100).toFixed(digits)}%`;
}

/** Today on this device, as `YYYY-MM-DD`. */
export function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** What the API said went wrong, or a sentence naming the service. */
export function errorText(
  error: unknown,
  fallback: string,
  service = 'The service',
): string {
  const e = error as HttpErrorResponse | null;
  const body = e?.error as {
    message?: unknown;
    issues?: { path?: string; message: string }[];
  } | null;
  if (Array.isArray(body?.issues) && body.issues.length)
    return body.issues
      .map((issue) =>
        issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      )
      .join(' · ');
  const message = body?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message) return message;
  if (e?.status === 0 || e?.status === 502 || e?.status === 504)
    return `${service} is not reachable. Is it running (npm run dev)?`;
  return fallback;
}

/** Empty text becomes null; a number field becomes a number or null. */
export const textOrNull = (value: string) => value.trim() || null;
export function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? n : null;
}

/** How a tile's number moved against what it is compared with. */
export interface Delta {
  /** 'up', 'down' or 'flat' (a change under 1%, or both zero). */
  direction: 'up' | 'down' | 'flat';
  /** Good news, bad news or neither, from which way is better. */
  tone: 'success' | 'danger' | 'neutral';
  /** "+12%", "−8%", "+150 €" (when the old value is 0), "same". */
  text: string;
}

/**
 * `now` against `before` for a stat tile. `better` says which way is good
 * news (spending: 'down'; income: 'up'; 'none' for a neutral number).
 * Null when there is nothing to compare with.
 */
export function delta(
  now: number | null | undefined,
  before: number | null | undefined,
  better: 'up' | 'down' | 'none' = 'up',
  unit: 'euro' | 'number' | 'points' = 'euro',
): Delta | null {
  if (now === null || now === undefined || Number.isNaN(now)) return null;
  if (before === null || before === undefined || Number.isNaN(before))
    return null;
  const diff = now - before;
  let text: string;
  let flat: boolean;
  if (unit === 'points') {
    // Two shares (0–1): the change in percentage points.
    const points = Math.round(diff * 100);
    flat = points === 0;
    text = `${points > 0 ? '+' : '−'}${Math.abs(points)} pt`;
  } else if (before === 0) {
    flat = Math.abs(diff) < 0.005;
    const size =
      unit === 'euro' ? euro(Math.abs(diff), false) : String(Math.abs(diff));
    text = `${diff > 0 ? '+' : '−'}${size}`;
  } else {
    const share = diff / Math.abs(before);
    flat = Math.abs(share) < 0.01;
    text = `${share > 0 ? '+' : '−'}${Math.round(Math.abs(share) * 100)}%`;
  }
  if (flat) return { direction: 'flat', tone: 'neutral', text: 'same' };
  const direction = diff > 0 ? 'up' : 'down';
  const tone =
    better === 'none' ? 'neutral' : direction === better ? 'success' : 'danger';
  return { direction, tone, text };
}
