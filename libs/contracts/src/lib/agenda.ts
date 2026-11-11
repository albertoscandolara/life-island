import { z } from 'zod';
import {
  lifeDate,
  lifeName,
  lifeNote,
  lifeTime,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';
import { isoAddDays } from './life-dates.js';

/*
 * Agenda (Compy, svc-agenda, mfe-agenda): every date of the island in one
 * timeline. Each area that has dates answers `GET /deadlines` with the same
 * shape (DeadlineDto); svc-agenda reads them over HTTP, adds your own items
 * and the yearly Italian household calendar, and shows what is overdue, what
 * is this week and everything ahead.
 */

// ---------------------------------------------------------------------------
// The deadline every area publishes
// ---------------------------------------------------------------------------

/** A dated thing in one area: an ID that expires, a renewal, an exam, a trip. */
export interface DeadlineDto {
  /**
   * Unique within its area, and different for each occurrence (it includes
   * the date), so marking one as handled never hides the next one.
   */
  id: string;
  /** The island area it belongs to (`people`, `cars`, `money`…). */
  module: string;
  /** What kind of date, within the area: `insurance`, `exam`, `refill`… */
  kind: string;
  title: string;
  detail: string | null;
  date: string;
  amount: number | null;
  /** Where it is handled in the Life Island app, e.g. `/cars`. */
  path: string | null;
}

/** `GET /deadlines?from&to` on every area that has dates. */
export const deadlinesQuerySchema = z.object({
  from: lifeDate.optional(),
  to: lifeDate.optional(),
});
export type DeadlinesQuery = z.infer<typeof deadlinesQuerySchema>;

/** How far back and ahead an area looks when the query says nothing. */
export const DEADLINES_DEFAULT_PAST_DAYS = 60;
export const DEADLINES_DEFAULT_AHEAD_DAYS = 400;

export function deadlineWindow(
  query: DeadlinesQuery,
  today: string,
): { from: string; to: string } {
  return {
    from: query.from ?? isoAddDays(today, -DEADLINES_DEFAULT_PAST_DAYS),
    to: query.to ?? isoAddDays(today, DEADLINES_DEFAULT_AHEAD_DAYS),
  };
}

export function inDeadlineWindow(
  date: string | null | undefined,
  window: { from: string; to: string },
): date is string {
  return !!date && date >= window.from && date <= window.to;
}

/** The areas svc-agenda asks for their deadlines, with the name it shows. */
export const DEADLINE_SOURCES = [
  { module: 'people', name: 'People & IDs', emblem: '🪪', path: '/people' },
  { module: 'cars', name: 'Cars', emblem: '🚗', path: '/cars' },
  { module: 'home', name: 'Houses', emblem: '🏡', path: '/home' },
  { module: 'studies', name: 'Studies', emblem: '📚', path: '/studies' },
  { module: 'money', name: 'Money', emblem: '💶', path: '/money' },
  { module: 'goals', name: 'Goals & habits', emblem: '🎯', path: '/goals' },
  { module: 'health', name: 'Health', emblem: '🩺', path: '/health' },
  {
    module: 'subscriptions',
    name: 'Contracts & subscriptions',
    emblem: '📑',
    path: '/subscriptions',
  },
  { module: 'travel', name: 'Travel', emblem: '✈️', path: '/travel' },
  { module: 'fitness', name: 'Fitness', emblem: '🏃', path: '/fitness' },
] as const;
export type DeadlineSourceId = (typeof DEADLINE_SOURCES)[number]['module'];

// ---------------------------------------------------------------------------
// Your own items
// ---------------------------------------------------------------------------

export const AGENDA_REPEATS = [
  'none',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;
export type AgendaRepeat = (typeof AGENDA_REPEATS)[number];

export const AGENDA_REPEAT_LABELS: Record<AgendaRepeat, string> = {
  none: 'Once',
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

export const AGENDA_CATEGORIES = [
  'personal',
  'family',
  'home',
  'work',
  'money',
  'health',
  'admin',
  'other',
] as const;
export type AgendaCategory = (typeof AGENDA_CATEGORIES)[number];

export const AGENDA_CATEGORY_LABELS: Record<AgendaCategory, string> = {
  personal: 'Personal',
  family: 'Family',
  home: 'Home',
  work: 'Work',
  money: 'Money',
  health: 'Health',
  admin: 'Paperwork',
  other: 'Other',
};

export const agendaItemRequestSchema = z.object({
  title: lifeName(160),
  date: lifeDate,
  time: lifeTime,
  repeat: z.enum(AGENDA_REPEATS).optional(),
  category: z.enum(AGENDA_CATEGORIES).optional(),
  notes: lifeNote(),
  /** Only for an item that does not repeat. */
  done: z.boolean().optional(),
});
export type AgendaItemRequest = z.input<typeof agendaItemRequestSchema>;

export type AgendaItemDto = LifeRecord<{
  title: string;
  date: string;
  time: string | null;
  repeat: AgendaRepeat;
  category: AgendaCategory;
  notes: string | null;
  done: boolean;
}>;

/** Marks a dated thing from an area (or the calendar) as handled, or not. */
export const handledRequestSchema = z.object({
  key: z.string().min(3).max(300),
  handled: z.boolean(),
});
export type HandledRequest = z.infer<typeof handledRequestSchema>;

// ---------------------------------------------------------------------------
// The yearly Italian household calendar
// ---------------------------------------------------------------------------

export interface CalendarDate {
  id: string;
  /** 1–12. */
  month: number;
  day: number;
  title: string;
  detail: string;
  /** The area it is about, for its link. */
  module: string;
  path: string | null;
}

/**
 * Dates that come round every year for a household in Italy. When a date
 * falls on a weekend the deadline usually moves to the next working day; the
 * detail says so where it matters. Turn the calendar off in Settings → Agenda.
 */
export const ITALIAN_CALENDAR: readonly CalendarDate[] = [
  {
    id: 'isee',
    month: 1,
    day: 15,
    title: 'Renew the ISEE',
    detail:
      'The ISEE expires on 31 December: a new DSU is needed for bonuses, school fees and discounts in the new year.',
    module: 'money',
    path: '/money',
  },
  {
    id: 'cu',
    month: 3,
    day: 16,
    title: 'Certificazione Unica from your employer',
    detail:
      'Employers send the CU for last year by 16 March: check it, it is the base of the 730.',
    module: 'taxes',
    path: '/taxes/730',
  },
  {
    id: '730-precompilato',
    month: 4,
    day: 30,
    title: '730 precompilato available',
    detail:
      'The pre-filled 730 opens on the Agenzia delle Entrate site around the end of April: compare it with your deductible expenses.',
    module: 'taxes',
    path: '/taxes/730',
  },
  {
    id: 'imu-acconto',
    month: 6,
    day: 16,
    title: 'IMU first instalment',
    detail:
      'Only for houses that are not your main home (or luxury categories): half of the year’s IMU, with an F24.',
    module: 'home',
    path: '/home',
  },
  {
    id: '730-deadline',
    month: 9,
    day: 30,
    title: '730 deadline',
    detail:
      'Last day to send the 730, on your own or through a CAF or the commercialista.',
    module: 'taxes',
    path: '/taxes/730',
  },
  {
    id: 'winter-tyres',
    month: 11,
    day: 15,
    title: 'Winter tyres or chains on board',
    detail:
      'Required on many roads from 15 November to 15 April: check your car’s tyre set.',
    module: 'cars',
    path: '/cars',
  },
  {
    id: 'imu-saldo',
    month: 12,
    day: 16,
    title: 'IMU balance',
    detail:
      'The second half of the year’s IMU for houses that are not your main home.',
    module: 'home',
    path: '/home',
  },
  {
    id: 'summer-tyres',
    month: 4,
    day: 15,
    title: 'Back to summer tyres',
    detail:
      'Winter tyres with a lower speed code must come off by 15 May (a month of tolerance after 15 April).',
    module: 'cars',
    path: '/cars',
  },
];

// ---------------------------------------------------------------------------
// The agenda as the page shows it
// ---------------------------------------------------------------------------

export type AgendaUrgency = 'overdue' | 'today' | 'week' | 'month' | 'later';

export interface AgendaEntryDto {
  /** `module:<area>:<id>`, `item:<id>:<date>` or `calendar:<id>:<year>`. */
  key: string;
  source: 'module' | 'item' | 'calendar';
  /** The island area, or `agenda` for your own items. */
  module: string;
  kind: string;
  title: string;
  detail: string | null;
  date: string;
  time: string | null;
  amount: number | null;
  path: string | null;
  daysLeft: number;
  urgency: AgendaUrgency;
  handled: boolean;
  /** Your own item's id, to edit it. */
  itemId: string | null;
  category: AgendaCategory | null;
}

export interface AgendaSourceDto {
  module: string;
  name: string;
  emblem: string;
  /** Whether the area answered; an area turned off or not running did not. */
  ok: boolean;
  error: string | null;
  count: number;
}

export const agendaBriefOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two or three sentences: how the coming days look'),
  priorities: z
    .array(
      z.object({
        title: z.string().describe('What to do, verb first'),
        why: z.string().describe('Why it matters now, from the dates'),
        when: z
          .string()
          .describe('When to do it: a weekday or a date, e.g. Monday'),
      }),
    )
    .describe('Up to five things to do first, most urgent first'),
  canWait: z
    .array(z.string())
    .describe('Up to three dates that look scary but can wait, and why'),
  tips: z.array(z.string()).describe('Up to three short tips'),
});
export type AgendaBriefOutput = z.infer<typeof agendaBriefOutputSchema>;
export type AgendaBriefDto = LifeAiAnswerDto<AgendaBriefOutput>;

export interface AgendaOverviewDto {
  today: string;
  /** From 60 days ago to a year ahead, oldest first. */
  entries: AgendaEntryDto[];
  items: AgendaItemDto[];
  sources: AgendaSourceDto[];
  italianCalendar: boolean;
  briefs: AgendaBriefDto[];
  /** Whether the week brief calls Claude now (key and Settings switch). */
  aiBrief: boolean;
}

/** `GET /upcoming?days=`: the next things not handled, for the island hub. */
export interface AgendaUpcomingDto {
  today: string;
  entries: AgendaEntryDto[];
}

export function agendaUrgency(daysLeft: number): AgendaUrgency {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 7) return 'week';
  if (daysLeft <= 31) return 'month';
  return 'later';
}

/** Settings → Agenda. */
export const AGENDA_CALENDAR_SETTING = 'agenda.italian-calendar';
