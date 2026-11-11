import type { HttpErrorResponse } from '@angular/common/http';

/*
 * How the record-keeping areas write numbers, dates and errors, so every area
 * says "in 5 days", "€ 12,50" and "11 nov 2026" the same way.
 */

export function euro(value: number | null | undefined, cents = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return value.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
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
