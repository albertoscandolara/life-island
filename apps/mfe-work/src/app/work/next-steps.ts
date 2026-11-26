import type { WorkOverviewDto } from '@life-island/contracts';
import type { UiIconName } from '@life-island/design-system';
import { euro } from './labels';
import {
  certificateMatches,
  dueThrough,
  type PayslipYear,
} from './payslip-months';
import { periodText } from './labels';

/** How much a step needs you: late, to do now, to look at, a good idea. */
export type WorkStepLevel = 'late' | 'due' | 'check' | 'idea';

export const WORK_STEP_RANK: Record<WorkStepLevel, number> = {
  late: 0,
  due: 1,
  check: 2,
  idea: 3,
};

export const WORK_STEP_BADGES: Record<
  WorkStepLevel,
  { label: string; tone: 'danger' | 'warning' | 'info' }
> = {
  late: { label: 'Late', tone: 'danger' },
  due: { label: 'To do', tone: 'warning' },
  check: { label: 'To check', tone: 'warning' },
  idea: { label: 'Worth it', tone: 'info' },
};

/** Where a step's button takes you: a section of the page, or the review. */
export type WorkStepTarget =
  { kind: 'review' } | { kind: 'section'; id: string; year?: number };

export interface WorkStep {
  id: string;
  level: WorkStepLevel;
  icon: UiIconName;
  title: string;
  detail: string;
  target: WorkStepTarget;
  /** The day that counts, for sorting steps of the same level. */
  date: string | null;
}

/** Hours of holidays and ROL left in the last quarter that are worth planning. */
const TIME_OFF_HOURS = 40;
/** Months without a rise after which a talk is worth preparing. */
const RISE_MONTHS = 24;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * What Work needs from you, the most urgent first: documents to review,
 * payslips missing or to check, a CU that does not add up, the pension
 * fund's dates and room, then the ideas (a talk about a rise, time off to
 * plan, profiles and applications to follow up). Each one opens the place
 * where it is done.
 */
export function workSteps(
  overview: WorkOverviewDto,
  years: readonly PayslipYear[],
  today: string,
): WorkStep[] {
  const steps: WorkStep[] = [];
  const add = (step: WorkStep) => steps.push(step);

  if (overview.reviews.length)
    add({
      id: 'review',
      level: 'due',
      icon: 'inbox',
      title: `Review ${plural(overview.reviews.length, 'work document', 'work documents')}`,
      detail: 'They count in your pay and career only once you approve them.',
      target: { kind: 'review' },
      // Before every other step of its level: the rest waits on it.
      date: '',
    });

  const through = dueThrough(today);
  const missing = years
    .flatMap((y) => y.months)
    .filter((m) => m.state === 'missing')
    .sort((a, b) => b.period.localeCompare(a.period));
  if (missing.length) {
    const latest = missing[0];
    add({
      id: 'missing',
      level: latest.period === through ? 'due' : 'check',
      icon: 'file',
      title:
        missing.length === 1
          ? `Load the payslip of ${periodText(latest.period)}`
          : `Load ${missing.length} missing payslips`,
      detail:
        missing.length === 1
          ? 'Without it your pay, TFR and CU checks have a gap.'
          : `Latest: ${periodText(latest.period)}. Without them your pay, TFR and CU checks have gaps.`,
      target: {
        kind: 'section',
        id: 'work-payslips',
        year: Number(latest.period.slice(0, 4)),
      },
      date: latest.period,
    });
  }

  const toCheck = years.reduce((n, y) => n + y.toCheck, 0);
  if (toCheck) {
    const year = years.find((y) => y.toCheck)?.year;
    add({
      id: 'checks',
      level: 'check',
      icon: 'alert',
      title: `Look at ${plural(toCheck, 'payslip', 'payslips')} that did not add up`,
      detail:
        'A value not read, or a check against your CCNL that failed: each is marked on its month.',
      target: { kind: 'section', id: 'work-payslips', year },
      date: null,
    });
  }

  for (const c of overview.certificates) {
    if (certificateMatches(c) !== false) continue;
    add({
      id: `cu-${c.uploadId}`,
      level: 'check',
      icon: 'file',
      title: `CU ${c.year} of ${c.workplaceName} differs from your payslips`,
      detail: c.missingMonths.length
        ? `No payslip for ${c.missingMonths.map(periodText).join(', ')}.`
        : 'A payslip differs from the one your employer counted, or a conguaglio.',
      target: { kind: 'section', id: 'work-payslips', year: c.year },
      date: null,
    });
  }

  const pension = overview.pension;
  if (pension.pending.length)
    add({
      id: 'pension-pending',
      level: 'due',
      icon: 'layers',
      title: `Confirm ${plural(pension.pending.length, 'pension fund statement', 'pension fund statements')}`,
      detail: 'Read from your documents: they update what your fund is worth.',
      target: { kind: 'section', id: 'work-pension' },
      date: null,
    });
  for (const y of pension.years) {
    if (!y.noticeDue || y.noticeSentAt || y.running) continue;
    add({
      id: `notice-${y.year}`,
      level: y.noticeDue < today ? 'late' : 'due',
      icon: 'calendar',
      title: `Tell your fund what you did not deduct in ${y.year}`,
      detail: `By ${periodText(y.noticeDue)}, so ${euro(y.over)} is not taxed again when you retire.`,
      target: { kind: 'section', id: 'work-pension' },
      date: y.noticeDue,
    });
  }
  const thisYear = pension.thisYear;
  if (
    thisYear &&
    thisYear.room > 0 &&
    thisYear.saving &&
    today.slice(5, 7) >= '10'
  )
    add({
      id: 'pension-room',
      level: 'idea',
      icon: 'layers',
      title: `Pay into your pension fund by ${periodText(thisYear.deadline)}`,
      detail: `${euro(thisYear.room)} more is still deductible this year: about ${euro(thisYear.saving)} less tax.`,
      target: { kind: 'section', id: 'work-pension' },
      date: thisYear.deadline,
    });

  const stats = overview.stats;
  if (
    stats.monthsSinceLastRise !== null &&
    stats.monthsSinceLastRise >= RISE_MONTHS
  )
    add({
      id: 'rise',
      level: 'idea',
      icon: 'chart',
      title: 'Prepare a talk about a rise',
      detail: `No rise for ${Math.floor(stats.monthsSinceLastRise / 12)} years: your negotiation brief has the facts.`,
      target: { kind: 'section', id: 'work-tools' },
      date: null,
    });

  const timeOff = (stats.vacationLeft ?? 0) + (stats.leaveLeft ?? 0);
  if (timeOff >= TIME_OFF_HOURS && today.slice(5, 7) >= '09')
    add({
      id: 'time-off',
      level: 'idea',
      icon: 'calendar',
      title: `Plan your time off: ${Math.round(timeOff)} hours left`,
      detail:
        'Holidays and ROL from your latest payslip, before the year ends.',
      target: { kind: 'section', id: 'work-analysis' },
      date: null,
    });

  const stale = overview.platforms.filter((p) => p.stale).length;
  if (stale)
    add({
      id: 'platforms',
      level: 'idea',
      icon: 'external',
      title: `Refresh ${plural(stale, 'hiring profile', 'hiring profiles')}`,
      detail: 'Not updated for months: recruiters see an old you.',
      target: { kind: 'section', id: 'work-platforms' },
      date: null,
    });
  if (overview.jobSearch.stale)
    add({
      id: 'applications',
      level: 'idea',
      icon: 'search',
      title: `Follow up ${plural(overview.jobSearch.stale, 'application', 'applications')}`,
      detail: 'No news for a while: a short message, or close them.',
      target: { kind: 'section', id: 'work-jobs' },
      date: null,
    });

  return steps.sort(
    (a, b) =>
      WORK_STEP_RANK[a.level] - WORK_STEP_RANK[b.level] ||
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
  );
}
