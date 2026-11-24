import {
  UTILITIES,
  type BillDto,
  type UtilityKind,
} from '@life-island/contracts';
import { bucketLabel, formatDate, formatEuro } from '../shared/format';
import type { MissingMonths } from './aggregate';

/** What a utility needs from you, the most urgent first. */
export type StepLevel = 'late' | 'due' | 'missing' | 'rising' | 'empty' | 'ok';

/** The order of the levels: what is late before what is due, and so on. */
export const STEP_RANK: Record<StepLevel, number> = {
  late: 0,
  due: 1,
  missing: 2,
  rising: 3,
  empty: 4,
  ok: 5,
};

export const STEP_BADGES: Record<
  StepLevel,
  { label: string; tone: 'danger' | 'warning' | 'info' | 'success' }
> = {
  late: { label: 'Late', tone: 'danger' },
  due: { label: 'To pay', tone: 'warning' },
  missing: { label: 'Bills missing', tone: 'warning' },
  rising: { label: 'Price up', tone: 'warning' },
  empty: { label: 'No bills', tone: 'info' },
  ok: { label: 'In order', tone: 'success' },
};

/** The next step of one utility: what to do, by when, and the bill it is about. */
export interface UtilityStep {
  utility: UtilityKind;
  level: StepLevel;
  heading: string;
  detail: string | null;
  /** The day that counts (a due date), for sorting What's next. */
  date: string | null;
  /** The bill to open, when the step is about one. */
  bill: BillDto | null;
}

/** A bill is late for this many days, then it is history (or paid outside Money). */
const LATE_DAYS = 30;

/** Left to pay on a bill: nothing when it goes by direct debit or Money matched its payment. */
export function unpaid(bill: BillDto): boolean {
  return (
    !bill.autoPaid &&
    !bill.bankPayment?.full &&
    (bill.totalDue ?? bill.amount) > 0
  );
}

/**
 * The next step of one utility, from its bills (any date) and what the page
 * worked out for the range: in order, a bill past its due date and not paid,
 * a bill to pay, months with no bill (internet), a price up on a year ago;
 * else nothing to do.
 */
export function utilityStep(
  utility: UtilityKind,
  bills: readonly BillDto[],
  context: {
    today: string;
    /** Price against a year ago (0.12 = +12%), when known. */
    change: number | null;
    missing: readonly MissingMonths[];
  },
): UtilityStep {
  const own = bills.filter((b) => b.utility === utility);
  const label = UTILITIES[utility].label.toLowerCase();
  const due = (b: BillDto) => b.totalDue ?? b.amount;
  const who = (b: BillDto) => b.supplierName ?? b.provider ?? 'your supplier';
  const lateFrom = addDays(context.today, -LATE_DAYS);
  const byDue = own
    .filter((b) => b.dueDate && unpaid(b))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  const late = byDue.find(
    (b) => b.dueDate! < context.today && b.dueDate! >= lateFrom,
  );
  if (late)
    return {
      utility,
      level: 'late',
      heading: `Pay ${formatEuro(due(late))} to ${who(late)}`,
      detail: `It was due on ${formatDate(late.dueDate!)}. Paid already? Match the payment in Money and it leaves this list.`,
      date: late.dueDate,
      bill: late,
    };

  const next = byDue.find((b) => b.dueDate! >= context.today);
  if (next)
    return {
      utility,
      level: 'due',
      heading: `Pay ${formatEuro(due(next))} by ${formatDate(next.dueDate!)}`,
      detail: `${who(next)}, ${inDays(context.today, next.dueDate!)}. Not by direct debit: pay it by the due date.`,
      date: next.dueDate,
      bill: next,
    };

  const gap = context.missing[0];
  if (gap)
    return {
      utility,
      level: 'missing',
      heading: `Load the ${label} bill of ${monthList(gap.months)}`,
      detail: `No bill from ${gap.provider ?? 'your provider'} for ${gap.months.length === 1 ? 'that month' : 'those months'}: the totals miss ${gap.months.length === 1 ? 'it' : 'them'}.`,
      date: null,
      bill: null,
    };

  const latest = newest(own);
  if (context.change !== null && context.change >= 0.1)
    return {
      utility,
      level: 'rising',
      heading:
        utility === 'WATER'
          ? `Check your water readings: price ${percent(context.change)}`
          : `Compare offers: price ${percent(context.change)}`,
      detail:
        utility === 'WATER'
          ? 'On a year ago. You cannot change water operator: send your own meter reading, so it bills what you used.'
          : 'On a year ago. A supplier that changes its terms lets you leave without penalties.',
      date: null,
      bill: latest,
    };

  if (!own.length)
    return {
      utility,
      level: 'empty',
      heading: `Load your ${label} bills`,
      detail:
        'Once confirmed in the documents app they show up here, filed under their home.',
      date: null,
      bill: null,
    };

  const auto = own
    .filter((b) => b.dueDate && b.dueDate >= context.today && b.autoPaid)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  return {
    utility,
    level: 'ok',
    heading: 'Nothing to do',
    detail: auto
      ? `${formatEuro(due(auto))} goes by direct debit on ${formatDate(auto.dueDate!)}.`
      : latest
        ? `Latest bill: ${formatEuro(latest.amount)}${latest.periodEnd ? `, up to ${formatDate(latest.periodEnd)}` : ''}.`
        : null,
    date: auto?.dueDate ?? null,
    bill: latest,
  };
}

/** Most urgent first; at the same level, the earliest date first. */
export function byUrgency(a: UtilityStep, b: UtilityStep): number {
  return (
    STEP_RANK[a.level] - STEP_RANK[b.level] ||
    (a.date ?? '9999').localeCompare(b.date ?? '9999')
  );
}

/** The newest bill: by the end of its period, else its issue date. */
export function newest(bills: readonly BillDto[]): BillDto | null {
  const day = (b: BillDto) => b.periodEnd ?? b.issueDate ?? b.dueDate ?? '';
  return [...bills].sort((a, b) => day(b).localeCompare(day(a)))[0] ?? null;
}

/** "Feb 2026, Mar 2026 and May 2026". */
export function monthList(months: readonly string[]): string {
  const names = months.map((m) => bucketLabel(m));
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function percent(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function inDays(today: string, day: string): string {
  const days = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
