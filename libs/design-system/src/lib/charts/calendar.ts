/*
 * The arithmetic of <ui-calendar-heatmap>: days laid out in weeks (columns,
 * Monday first) and weekdays (rows), the month labels over them, and how
 * strong each day's colour is.
 */

const DAY_MS = 86_400_000;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface CalendarCell {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Column, from 0. */
  week: number;
  /** Row: 0 is Monday, 6 is Sunday. */
  weekday: number;
}

export interface CalendarGrid {
  cells: CalendarCell[];
  weeks: number;
  /** A month's short name over the first column that holds its 1st. */
  months: { week: number; label: string }[];
}

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Every day from `from` to `to` (both included), in Monday-first weeks. */
export function calendarGrid(from: string, to: string): CalendarGrid {
  const start = toTime(from);
  const end = toTime(to);
  if (!(start <= end)) return { cells: [], weeks: 0, months: [] };
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  const months: CalendarGrid['months'] = [];
  for (let t = start, i = offset; t <= end; t += DAY_MS, i++) {
    const date = toDate(t);
    const week = Math.floor(i / 7);
    cells.push({ date, week, weekday: i % 7 });
    const label = MONTHS[Number(date.slice(5, 7)) - 1];
    // The first month is labelled even when the range starts mid-month.
    if (date.endsWith('-01') || t === start) {
      const last = months[months.length - 1];
      // Two labels on one column, or a column apart, would overlap.
      if (last && week - last.week < 2) months.pop();
      months.push({ week, label });
    }
  }
  return {
    cells,
    weeks: Math.floor((offset + cells.length - 1) / 7) + 1,
    months,
  };
}

/** 0 for nothing, then 1 to 4 as the value nears the highest one. */
export function heatLevel(value: number | undefined, max: number): number {
  if (!value || value <= 0 || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * value) / max)));
}
