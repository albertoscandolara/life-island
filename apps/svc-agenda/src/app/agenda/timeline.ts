import {
  agendaUrgency,
  isoAddDays,
  isoAddMonths,
  isoDaysBetween,
  ITALIAN_CALENDAR,
  type AgendaBriefOutput,
  type AgendaEntryDto,
  type AgendaItemDto,
  type AgendaRepeat,
  type DeadlineDto,
} from '@life-island/contracts';

/*
 * The agenda as a pure computation: the areas' deadlines, your own items
 * (repeating ones unrolled) and the yearly calendar, merged into one list with
 * how many days are left and whether you marked each one as handled.
 */

export interface Window {
  from: string;
  to: string;
}

const REPEAT_MONTHS: Record<
  Exclude<AgendaRepeat, 'none' | 'weekly'>,
  number
> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** The dates an item falls on inside the window. */
export function itemOccurrences(
  item: Pick<AgendaItemDto, 'date' | 'repeat'>,
  window: Window,
): string[] {
  if (item.repeat === 'none')
    return item.date >= window.from && item.date <= window.to
      ? [item.date]
      : [];
  const dates: string[] = [];
  if (item.repeat === 'weekly') {
    let date = item.date;
    if (date < window.from) {
      const weeks = Math.floor(isoDaysBetween(date, window.from) / 7);
      date = isoAddDays(date, weeks * 7);
      if (date < window.from) date = isoAddDays(date, 7);
    }
    for (; date <= window.to && dates.length < 60; date = isoAddDays(date, 7))
      dates.push(date);
    return dates;
  }
  const months = REPEAT_MONTHS[item.repeat];
  // Count the steps from the first date, so the 31st stays the month's end.
  let step = 0;
  if (item.date < window.from) {
    const [sy, sm] = item.date.split('-').map(Number);
    const [fy, fm] = window.from.split('-').map(Number);
    step = Math.max(0, Math.floor(((fy - sy) * 12 + (fm - sm)) / months) - 1);
  }
  for (; dates.length < 60; step++) {
    const date = isoAddMonths(item.date, step * months);
    if (date > window.to) break;
    if (date >= window.from) dates.push(date);
  }
  return dates;
}

/** The Italian calendar's dates inside the window, one per year. */
export function calendarOccurrences(
  window: Window,
): { id: string; date: string; year: number }[] {
  const first = Number(window.from.slice(0, 4));
  const last = Number(window.to.slice(0, 4));
  const found: { id: string; date: string; year: number }[] = [];
  for (let year = first; year <= last; year++)
    for (const entry of ITALIAN_CALENDAR) {
      const date = `${year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;
      if (date >= window.from && date <= window.to)
        found.push({ id: entry.id, date, year });
    }
  return found;
}

export function buildEntries(input: {
  today: string;
  window: Window;
  deadlines: DeadlineDto[];
  items: AgendaItemDto[];
  calendar: boolean;
  handled: ReadonlySet<string>;
}): AgendaEntryDto[] {
  const { today, window, handled } = input;
  const entry = (
    e: Omit<AgendaEntryDto, 'daysLeft' | 'urgency'>,
  ): AgendaEntryDto => {
    const daysLeft = isoDaysBetween(today, e.date);
    return { ...e, daysLeft, urgency: agendaUrgency(daysLeft) };
  };
  const entries: AgendaEntryDto[] = [];

  for (const d of input.deadlines) {
    if (d.date < window.from || d.date > window.to) continue;
    const key = `module:${d.module}:${d.id}`;
    entries.push(
      entry({
        key,
        source: 'module',
        module: d.module,
        kind: d.kind,
        title: d.title,
        detail: d.detail,
        date: d.date,
        time: null,
        amount: d.amount,
        path: d.path,
        handled: handled.has(key),
        itemId: null,
        category: null,
      }),
    );
  }

  for (const item of input.items)
    for (const date of itemOccurrences(item, window)) {
      const key = `item:${item.id}:${date}`;
      entries.push(
        entry({
          key,
          source: 'item',
          module: 'agenda',
          kind: item.category,
          title: item.title,
          detail: item.notes,
          date,
          time: item.time,
          amount: null,
          path: null,
          handled: item.repeat === 'none' ? item.done : handled.has(key),
          itemId: item.id,
          category: item.category,
        }),
      );
    }

  if (input.calendar)
    for (const occurrence of calendarOccurrences(window)) {
      const def = ITALIAN_CALENDAR.find((c) => c.id === occurrence.id);
      if (!def) continue;
      const key = `calendar:${def.id}:${occurrence.year}`;
      entries.push(
        entry({
          key,
          source: 'calendar',
          module: def.module,
          kind: 'calendar',
          title: def.title,
          detail: def.detail,
          date: occurrence.date,
          time: null,
          amount: null,
          path: def.path,
          handled: handled.has(key),
          itemId: null,
          category: null,
        }),
      );
    }

  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '').localeCompare(b.time ?? '') ||
      a.title.localeCompare(b.title),
  );
}

/** What still needs you: not handled, past or within `days`. */
export function openEntries(
  entries: readonly AgendaEntryDto[],
  days: number,
): AgendaEntryDto[] {
  return entries.filter((e) => !e.handled && e.daysLeft <= days);
}

/** The brief written by Life Island's own rules: overdue first, then this week's, by date. */
export function offlineBrief(
  entries: readonly AgendaEntryDto[],
  names: Readonly<Record<string, string>>,
): AgendaBriefOutput {
  const open = entries.filter((e) => !e.handled);
  const overdue = open.filter((e) => e.daysLeft < 0);
  const week = open.filter((e) => e.daysLeft >= 0 && e.daysLeft <= 7);
  const later = open.filter((e) => e.daysLeft > 7 && e.daysLeft <= 31);
  const area = (e: AgendaEntryDto) =>
    e.module === 'agenda' ? 'your agenda' : (names[e.module] ?? e.module);
  const priorities = [...overdue, ...week].slice(0, 5).map((e) => ({
    title: e.title,
    why:
      e.daysLeft < 0
        ? `It was due ${-e.daysLeft} day${e.daysLeft === -1 ? '' : 's'} ago (${area(e)}).`
        : e.daysLeft === 0
          ? `It is due today (${area(e)}).`
          : `It is due in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} (${area(e)}).`,
    when: e.daysLeft <= 0 ? 'Today' : weekday(e.date),
  }));
  const summary = !open.length
    ? 'Nothing is waiting for you: every date ahead is handled.'
    : `${overdue.length} overdue, ${week.length} in the next 7 days and ${later.length} more within a month.` +
      (overdue.length ? ' Start with what is overdue.' : '');
  return {
    summary,
    priorities,
    canWait: later
      .slice(0, 3)
      .map((e) => `${e.title}: ${e.daysLeft} days left, plan it but no rush.`),
    tips: [
      'Mark a date as handled once it is done, so the agenda shows only what is left.',
      ...(overdue.length > 3
        ? [
            'Block 30 minutes today for the overdue ones: most take less than that.',
          ]
        : []),
    ],
  };
}

function weekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export const BRIEF_INSTRUCTIONS = `You help one person keep their life under control with Life Island, an app that collects every date of their life: ID documents and car renewals, bills, exams, trips, contracts to cancel, health checkups, official letters, goals and their own reminders.

You receive the dates of the next weeks (and the overdue ones), each with its area, how many days are left and an optional detail. Write a short week brief:
- summary: two or three sentences on how the coming days look, honest and calm.
- priorities: up to five things to do first, most urgent or most costly to miss first. Say why with the date, and when to do it (a weekday or a date). Group related dates (a renewal and its payment) into one priority.
- canWait: up to three dates that look scary but can wait, and why.
- tips: up to three short, practical tips.

Rules: use only the dates given, never invent one. Write plain English, no jargon, no emojis. Overdue items come first unless a legal deadline this week is more serious (fines, taxes, insurance).`;

export function briefDossier(
  today: string,
  entries: readonly AgendaEntryDto[],
  names: Readonly<Record<string, string>>,
): string {
  const open = entries.filter((e) => !e.handled && e.daysLeft <= 45);
  if (!open.length)
    return `Today is ${today}. Nothing is open in the next 45 days.`;
  const lines = open.slice(0, 80).map((e) => {
    const area =
      e.module === 'agenda' ? 'Own item' : (names[e.module] ?? e.module);
    const when =
      e.daysLeft < 0 ? `${-e.daysLeft} days overdue` : `in ${e.daysLeft} days`;
    return `- ${e.date} (${when}) · ${area} · ${e.title}${e.amount ? ` · €${e.amount}` : ''}${e.detail ? ` — ${e.detail.slice(0, 160)}` : ''}`;
  });
  return `Today is ${today}.\n${lines.join('\n')}`;
}
