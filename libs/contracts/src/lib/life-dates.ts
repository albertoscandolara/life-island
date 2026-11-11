/*
 * Calendar dates as `YYYY-MM-DD` strings, the way every module stores a day.
 * Pure functions, shared by the services and the pages, so a "days left"
 * reads the same everywhere.
 */

/** Today in a time zone (SETTINGS_TIMEZONE on the services, Europe/Rome by default). */
export function isoToday(
  timeZone = 'Europe/Rome',
  now: Date = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

export function isoAddDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: negative when `to` is earlier. */
export function isoDaysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** The same day `months` later; the 31st becomes the month's last day. */
export function isoAddMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Monday of the week the date is in. */
export function isoWeekStart(date: string): string {
  const day = new Date(utc(date)).getUTCDay();
  return isoAddDays(date, -((day + 6) % 7));
}

export function isLifeIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(utc(value))
  );
}

/**
 * The next time a repeating date comes round, on or after `from`: every
 * `months` months (12 for yearly) counted from `start`.
 */
export function isoNextOccurrence(
  start: string,
  months: number,
  from: string,
): string {
  if (months <= 0 || start >= from) return start;
  const [sy, sm] = start.split('-').map(Number);
  const [fy, fm] = from.split('-').map(Number);
  let steps = Math.max(
    0,
    Math.floor(((fy - sy) * 12 + (fm - sm)) / months) - 1,
  );
  let next = isoAddMonths(start, steps * months);
  while (next < from) {
    steps += 1;
    next = isoAddMonths(start, steps * months);
  }
  return next;
}
