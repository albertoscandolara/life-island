import { isoAddDays } from './life-dates.js';

/*
 * The email digest of the Agenda (svc-agenda, docs/guides/email-digest.md):
 * what is overdue, what is coming and what waits for you, sent to a person of
 * People every day, week or month. Its settings live in Settings (group
 * "Email digest"); svc-agenda reads them from its replica and sends.
 */

export const DIGEST_FREQUENCY_SETTING = 'agenda.digest-frequency';
export const DIGEST_RECIPIENT_SETTING = 'agenda.digest-recipient';
export const DIGEST_TIME_SETTING = 'agenda.digest-time';
export const DIGEST_WEEKDAY_SETTING = 'agenda.digest-weekday';
export const DIGEST_MONTH_DAY_SETTING = 'agenda.digest-month-day';
/** The recipient setting's value while nobody is picked. */
export const DIGEST_NOBODY = 'none';

export const DIGEST_SETTING_KEYS = [
  DIGEST_FREQUENCY_SETTING,
  DIGEST_RECIPIENT_SETTING,
  DIGEST_TIME_SETTING,
  DIGEST_WEEKDAY_SETTING,
  DIGEST_MONTH_DAY_SETTING,
] as const;

export const DIGEST_FREQUENCIES = [
  'off',
  'daily',
  'weekly',
  'monthly',
] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const DIGEST_FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  off: 'Off',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const DIGEST_WEEKDAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
] as const;

/** The days a digest looks ahead, by how often it comes. */
export const DIGEST_HORIZON_DAYS: Record<
  Exclude<DigestFrequency, 'off'>,
  number
> = { daily: 3, weekly: 7, monthly: 31 };

/** A send missed by more than this (the service was down) waits for the next one. */
export const DIGEST_GRACE_HOURS = 24;

export interface DigestSettings {
  frequency: DigestFrequency;
  /** A person of People; null while nobody is picked. */
  recipientId: string | null;
  /** `HH:MM`, in the island's time zone. */
  time: string;
  /** 1 (Monday) to 7 (Sunday), for a weekly digest. */
  weekday: number;
  /** 1 to 28, for a monthly digest. */
  monthDay: number;
}

export const DIGEST_DEFAULTS: DigestSettings = {
  frequency: 'off',
  recipientId: null,
  time: '07:30',
  weekday: 1,
  monthDay: 1,
};

/** The digest settings from the replicated values, each one checked. */
export function digestSettings(
  values: ReadonlyMap<string, unknown>,
): DigestSettings {
  const frequency = values.get(DIGEST_FREQUENCY_SETTING);
  const recipient = values.get(DIGEST_RECIPIENT_SETTING);
  const time = values.get(DIGEST_TIME_SETTING);
  const weekday = Number(values.get(DIGEST_WEEKDAY_SETTING));
  const monthDay = values.get(DIGEST_MONTH_DAY_SETTING);
  return {
    frequency: (DIGEST_FREQUENCIES as readonly unknown[]).includes(frequency)
      ? (frequency as DigestFrequency)
      : DIGEST_DEFAULTS.frequency,
    recipientId:
      typeof recipient === 'string' && recipient !== DIGEST_NOBODY
        ? recipient
        : null,
    time:
      typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
        ? time
        : DIGEST_DEFAULTS.time,
    weekday:
      Number.isInteger(weekday) && weekday >= 1 && weekday <= 7
        ? weekday
        : DIGEST_DEFAULTS.weekday,
    monthDay:
      typeof monthDay === 'number' &&
      Number.isInteger(monthDay) &&
      monthDay >= 1 &&
      monthDay <= 28
        ? monthDay
        : DIGEST_DEFAULTS.monthDay,
  };
}

/** A moment on the island's clock: `YYYY-MM-DDTHH:MM`. */
export type LocalMoment = string;

/** The island's clock at an instant: `YYYY-MM-DDTHH:MM` in the time zone. */
export function localMoment(
  timeZone = 'Europe/Rome',
  now: Date = new Date(),
): LocalMoment {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map((part) => [part.type, part.value]),
    );
    return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
  } catch {
    return now.toISOString().slice(0, 16);
  }
}

const isoWeekday = (date: string) =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Whether a digest goes out on this day. */
function sendsOn(settings: DigestSettings, date: string): boolean {
  switch (settings.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return isoWeekday(date) === settings.weekday;
    case 'monthly':
      return Number(date.slice(8, 10)) === settings.monthDay;
    default:
      return false;
  }
}

/** One digest: the period it covers (its key, sent once) and when it goes. */
export interface DigestSlot {
  /** `daily:2026-11-18`, `weekly:2026-11-16`, `monthly:2026-11`. */
  period: string;
  at: LocalMoment;
}

function slotOn(settings: DigestSettings, date: string): DigestSlot {
  const period =
    settings.frequency === 'monthly'
      ? `monthly:${date.slice(0, 7)}`
      : `${settings.frequency}:${date}`;
  return { period, at: `${date}T${settings.time}` };
}

/** The latest digest due at or before `now`; null when it is off. */
export function lastDigestSlot(
  settings: DigestSettings,
  now: LocalMoment,
): DigestSlot | null {
  if (settings.frequency === 'off') return null;
  const today = now.slice(0, 10);
  for (let back = 0; back <= 31; back++) {
    const date = isoAddDays(today, -back);
    if (!sendsOn(settings, date)) continue;
    const slot = slotOn(settings, date);
    if (slot.at <= now) return slot;
  }
  return null;
}

/** The next digest after `now`; null when it is off. */
export function nextDigestSlot(
  settings: DigestSettings,
  now: LocalMoment,
): DigestSlot | null {
  if (settings.frequency === 'off') return null;
  const today = now.slice(0, 10);
  for (let ahead = 0; ahead <= 62; ahead++) {
    const date = isoAddDays(today, ahead);
    if (!sendsOn(settings, date)) continue;
    const slot = slotOn(settings, date);
    if (slot.at > now) return slot;
  }
  return null;
}

/** `at` plus some hours, on the same clock. */
function addHours(at: LocalMoment, hours: number): LocalMoment {
  const ms = Date.parse(`${at}:00Z`) + hours * 3_600_000;
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * The digest to send now, if any: the latest one due, unless it was missed
 * by more than DIGEST_GRACE_HOURS (the service was down: the next one will
 * come) or was due before the digest was turned on or rescheduled (`since`),
 * so turning it on in the afternoon does not send this morning's at once.
 */
export function dueDigestSlot(
  settings: DigestSettings,
  now: LocalMoment,
  since: LocalMoment | null,
): DigestSlot | null {
  const slot = lastDigestSlot(settings, now);
  if (!slot) return null;
  if (now >= addHours(slot.at, DIGEST_GRACE_HOURS)) return null;
  if (since && slot.at < since) return null;
  return slot;
}

/** "Every Monday at 07:30", "Every day at 07:30", "On the 1st of every month at 07:30". */
export function digestScheduleText(settings: DigestSettings): string {
  switch (settings.frequency) {
    case 'daily':
      return `Every day at ${settings.time}`;
    case 'weekly':
      return `Every ${DIGEST_WEEKDAYS[settings.weekday - 1].label} at ${settings.time}`;
    case 'monthly':
      return `On the ${ordinal(settings.monthDay)} of every month at ${settings.time}`;
    default:
      return 'Off';
  }
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

// ---------------------------------------------------------------------------
// What the Agenda page shows and asks
// ---------------------------------------------------------------------------

export type DigestSendStatus = 'sending' | 'sent' | 'failed' | 'empty';

export interface DigestSendDto {
  period: string;
  /** Who it went to (an address), or null for one that had nothing to say. */
  recipient: string | null;
  status: DigestSendStatus;
  attempts: number;
  error: string | null;
  /** When it was sent, or last tried. */
  at: string;
}

/** Why the digest cannot go out now, with where to fix it. */
export type DigestProblem =
  | 'off'
  | 'no-mail'
  | 'no-recipient'
  | 'people-down'
  | 'recipient-missing'
  | 'no-email';

/** `GET /digest`: how the digest is set, whether it can go, and the last sends. */
export interface DigestStatusDto {
  settings: DigestSettings;
  /** "Every Monday at 07:30". */
  schedule: string;
  /** The person picked, as People names them, and their address. */
  recipient: { id: string; name: string; email: string | null } | null;
  /** Whether email is set up on the server (SMTP_URL). */
  mailConfigured: boolean;
  /** The first thing in the way, or null when it will go. */
  problem: DigestProblem | null;
  /** When the next one goes (`YYYY-MM-DDTHH:MM`, the island's clock), or null. */
  next: LocalMoment | null;
  sends: DigestSendDto[];
}

/** One line of the digest. */
export interface DigestLineDto {
  date: string | null;
  daysLeft: number | null;
  area: string;
  emblem: string;
  title: string;
  detail: string | null;
  amount: number | null;
  /** The page it opens, as a full link to the island. */
  url: string | null;
}

/** The digest as it is sent (also `GET /digest/preview`). */
export interface DigestDto {
  subject: string;
  /** "Wednesday 18 November". */
  heading: string;
  summary: string;
  overdue: DigestLineDto[];
  coming: DigestLineDto[];
  waiting: DigestLineDto[];
  /** How many days ahead `coming` looks. */
  horizonDays: number;
  /** Nothing overdue, coming or waiting: a scheduled one is not sent. */
  empty: boolean;
  text: string;
  html: string;
}

/** `POST /digest/test`: sent now to the person picked. */
export interface DigestTestDto {
  to: string;
  subject: string;
}
