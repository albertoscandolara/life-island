import type { HttpErrorResponse } from '@angular/common/http';
import type { StudyTopic } from '@life-island/contracts';

/** "2 h 30 min", "45 min", "0 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hours with one decimal: "3,5 h". */
export function hours(minutes: number): string {
  return `${(Math.round((minutes / 60) * 10) / 10).toLocaleString('it-IT')} h`;
}

export function euro(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: true,
  });
}

/** "11 nov 2026". */
export function dateText(date: string | null): string {
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

/** "in 5 days", "today", "3 days ago". */
export function daysText(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 0) return `in ${days} days`;
  return days === -1 ? 'yesterday' : `${-days} days ago`;
}

export function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The chart colour of a topic (semantic viz tokens). */
export const TOPIC_COLORS: Record<StudyTopic, string> = {
  ai: 'var(--viz-part-1)',
  frameworks: 'var(--viz-part-2)',
  infrastructure: 'var(--viz-part-3)',
  leadership: 'var(--viz-part-4)',
  '3d': 'var(--viz-property-2)',
  other: 'var(--viz-other)',
};

export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** What the API said went wrong, or a generic sentence. */
export function errorText(error: unknown, fallback: string): string {
  const e = error as HttpErrorResponse | null;
  const body = e?.error as {
    message?: unknown;
    issues?: { message: string }[];
  } | null;
  if (Array.isArray(body?.issues) && body.issues.length)
    return body.issues.map((issue) => issue.message).join(' ');
  const message = body?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message) return message;
  if (e?.status === 0)
    return 'svc-studies is not reachable. Is it running (npm run dev)?';
  return fallback;
}

/** Empty text becomes null; a number field becomes a number or null. */
export const textOrNull = (value: string) => value.trim() || null;
export function numberOrNull(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? n : null;
}
