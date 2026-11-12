import {
  LEARNING_PATHS,
  pathOfStep,
  pathSteps,
  type CertificationDto,
  type CourseDto,
  type LearningPath,
  type PathProgressDto,
  type StepProgressDto,
  type StudyReminderDays,
  type StudyReminderDto,
  type StudySessionDto,
  type StudyStatsDto,
  type StudyTopic,
  type StudyWeekDto,
  type TrainingPlatformDto,
} from '@life-island/contracts';

/*
 * What Studies computes from what you recorded, with no database: weeks and
 * streak against your goal, the progress and pace of each path, what you
 * spend, and the reminders. Every function takes `today` so it is testable.
 */

const DAY = 86_400_000;

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromTime = (time: number) => new Date(time).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromTime(toTime(date) + days * DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY);
}

/** Monday of the week of a date. */
export function weekStart(date: string): string {
  const day = new Date(toTime(date)).getUTCDay(); // 0 Sunday
  return addDays(date, -((day + 6) % 7));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The yearly cost of a subscription; null for a free or per-course platform. */
export function yearlyCost(
  platform: Pick<TrainingPlatformDto, 'plan' | 'price' | 'billingPeriod'>,
): number | null {
  if (platform.plan !== 'subscription' || platform.price === null) return null;
  return round2(
    platform.billingPeriod === 'month' ? platform.price * 12 : platform.price,
  );
}

/**
 * The renewal of a subscription that is still ahead: the stored date, moved
 * on by its period until it is today or later (a renewal you never updated
 * still renews).
 */
export function nextRenewal(
  renewsOn: string | null,
  period: TrainingPlatformDto['billingPeriod'],
  today: string,
): string | null {
  if (!renewsOn) return null;
  let date = renewsOn;
  for (let i = 0; date < today && i < 600; i++) {
    const d = new Date(toTime(date));
    if (period === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
    date = fromTime(d.getTime());
  }
  return date;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface StatsInput {
  sessions: StudySessionDto[];
  courses: CourseDto[];
  certifications: CertificationDto[];
  platforms: TrainingPlatformDto[];
  paths: PathProgressDto[];
  weeklyGoalHours: number;
  /** All minutes ever logged (sessions holds the last 90 days only). */
  totalMinutes: number;
  /** The date of your last session, if older than the sessions given. */
  lastSessionOn: string | null;
  /** Subscription payments that fell this year, computed by the service. */
  subscriptionSpendThisYear: number;
  today: string;
}

/** The last `count` weeks, oldest first, with their minutes per topic. */
export function studyWeeks(
  sessions: StudySessionDto[],
  goalMinutes: number,
  today: string,
  count = 12,
): StudyWeekDto[] {
  const current = weekStart(today);
  const weeks: StudyWeekDto[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(current, -7 * i);
    const end = addDays(start, 7);
    const byTopic: Partial<Record<StudyTopic, number>> = {};
    let minutes = 0;
    for (const s of sessions)
      if (s.date >= start && s.date < end) {
        minutes += s.minutes;
        byTopic[s.topic] = (byTopic[s.topic] ?? 0) + s.minutes;
      }
    weeks.push({
      weekStart: start,
      minutes,
      byTopic,
      goalMet: goalMinutes > 0 && minutes >= goalMinutes,
    });
  }
  return weeks;
}

/**
 * Weeks in a row that met the goal, counting back from last week; this week
 * adds one once it is met (an unfinished week never breaks the streak).
 */
export function streakWeeks(weeks: StudyWeekDto[]): number {
  if (!weeks.length) return 0;
  const current = weeks[weeks.length - 1];
  let streak = 0;
  for (let i = weeks.length - 2; i >= 0 && weeks[i].goalMet; i--) streak++;
  return streak + (current.goalMet ? 1 : 0);
}

export function studyStats(input: StatsInput): StudyStatsDto {
  const goalMinutes = input.weeklyGoalHours * 60;
  const weeks = studyWeeks(input.sessions, goalMinutes, input.today);
  const fullWeeks = weeks.slice(-9, -1);
  const since = addDays(input.today, -90);
  const topics = new Map<StudyTopic, number>();
  for (const s of input.sessions)
    if (s.date > since)
      topics.set(s.topic, (topics.get(s.topic) ?? 0) + s.minutes);
  const year = input.today.slice(0, 4);
  const inYear = (date: string | null) => !!date && date.startsWith(year);
  const courseSpend = input.courses
    .filter((c) => c.cost !== null && inYear(c.startedOn ?? c.createdAt))
    .reduce((sum, c) => sum + (c.cost ?? 0), 0);
  const examSpend = input.certifications
    .filter((c) => c.cost !== null && inYear(c.examOn ?? c.createdAt))
    .reduce((sum, c) => sum + (c.cost ?? 0), 0);
  const last =
    input.sessions
      .map((s) => s.date)
      .sort()
      .at(-1) ?? input.lastSessionOn;
  return {
    weeklyGoalHours: input.weeklyGoalHours,
    weekMinutes: weeks[weeks.length - 1]?.minutes ?? 0,
    streakWeeks: streakWeeks(weeks),
    weeks,
    averageWeekMinutes: Math.round(
      fullWeeks.reduce((sum, w) => sum + w.minutes, 0) /
        Math.max(1, fullWeeks.length),
    ),
    topics: [...topics.entries()]
      .map(([topic, minutes]) => ({ topic, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    totalHours: round1(input.totalMinutes / 60),
    daysSinceLastSession: last ? daysBetween(last, input.today) : null,
    spentThisYear: round2(
      courseSpend + examSpend + input.subscriptionSpendThisYear,
    ),
    subscriptionsPerYear: round2(
      input.platforms
        .filter((p) => p.status === 'active')
        .reduce((sum, p) => sum + (p.yearlyCost ?? 0), 0),
    ),
    coursesCompleted: input.courses.filter((c) => c.status === 'completed')
      .length,
    coursesInProgress: input.courses.filter((c) => c.status === 'in_progress')
      .length,
    certificationsPassed: input.certifications.filter(
      (c) => c.status === 'passed',
    ).length,
    stepsDone: input.paths.reduce((sum, p) => sum + p.doneSteps, 0),
  };
}

/**
 * What subscriptions cost this calendar year: each active subscription's
 * renewals that fell between 1 January and today (the stored renewal date
 * walked back by its period).
 */
export function subscriptionSpend(
  platforms: TrainingPlatformDto[],
  today: string,
): number {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  let total = 0;
  for (const p of platforms) {
    if (p.plan !== 'subscription' || p.price === null || !p.renewsOn) continue;
    const next = nextRenewal(p.renewsOn, p.billingPeriod, today);
    if (!next) continue;
    const step = p.billingPeriod === 'month' ? 1 : 12;
    const d = new Date(toTime(next));
    for (let i = 0; i < 24; i++) {
      d.setUTCMonth(d.getUTCMonth() - step);
      const date = fromTime(d.getTime());
      if (date < yearStart) break;
      if (date < toDateOf(p.createdAt)) break;
      if (date <= today) total += p.price;
    }
  }
  return round2(total);
}

const toDateOf = (timestamp: string) => timestamp.slice(0, 10);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface PathRowInput {
  pathId: string;
  status: PathProgressDto['status'];
  startedOn: string | null;
  targetOn: string | null;
}

export interface StepRowInput {
  stepId: string;
  status: StepProgressDto['status'];
  startedOn: string | null;
  doneOn: string | null;
  notes: string | null;
}

/** Your progress on every path, followed or not, in catalog order. */
export function pathsProgress(
  pathRows: PathRowInput[],
  stepRows: StepRowInput[],
  sessions: StudySessionDto[],
  allSessionMinutes: {
    pathId: string | null;
    stepId: string | null;
    minutes: number;
  }[],
  weeklyGoalHours: number,
  today: string,
  catalogue: readonly LearningPath[] = LEARNING_PATHS,
): PathProgressDto[] {
  const following = pathRows.filter((p) => p.status === 'following').length;
  return catalogue.map((path) =>
    pathProgress(
      path,
      pathRows.find((p) => p.pathId === path.id) ?? null,
      stepRows,
      sessions,
      allSessionMinutes,
      weeklyGoalHours / Math.max(1, following),
      today,
    ),
  );
}

export function pathProgress(
  path: LearningPath,
  row: PathRowInput | null,
  stepRows: StepRowInput[],
  sessions: StudySessionDto[],
  allSessionMinutes: {
    pathId: string | null;
    stepId: string | null;
    minutes: number;
  }[],
  shareOfGoalHours: number,
  today: string,
): PathProgressDto {
  const steps = pathSteps(path);
  const minutesOf = (stepId: string) =>
    allSessionMinutes
      .filter((s) => s.stepId === stepId)
      .reduce((sum, s) => sum + s.minutes, 0);
  const progress: StepProgressDto[] = steps.map((step) => {
    const found = stepRows.find((s) => s.stepId === step.id);
    return {
      stepId: step.id,
      status: found?.status ?? 'todo',
      startedOn: found?.startedOn ?? null,
      doneOn: found?.doneOn ?? null,
      notes: found?.notes ?? null,
      minutes: minutesOf(step.id),
    };
  });
  const done = new Set(
    progress.filter((p) => p.status === 'done').map((p) => p.stepId),
  );
  const hoursTotal = steps.reduce((sum, s) => sum + s.hours, 0);
  const hoursDone = steps
    .filter((s) => done.has(s.id))
    .reduce((sum, s) => sum + s.hours, 0);
  const minutesLogged = allSessionMinutes
    .filter(
      (s) =>
        s.pathId === path.id ||
        (s.stepId !== null && pathOfStep(s.stepId)?.id === path.id),
    )
    .reduce((sum, s) => sum + s.minutes, 0);
  const next = steps.find((s) => !done.has(s.id)) ?? null;

  // Your pace on this path over the last 8 weeks, else your share of the goal.
  const since = addDays(today, -56);
  const recent = sessions
    .filter(
      (s) =>
        s.date > since &&
        (s.pathId === path.id ||
          (s.stepId !== null && pathOfStep(s.stepId)?.id === path.id)),
    )
    .reduce((sum, s) => sum + s.minutes, 0);
  const hoursPerWeek =
    recent > 0
      ? recent / 60 / 8
      : row?.status === 'following'
        ? shareOfGoalHours
        : 0;
  const left = hoursTotal - hoursDone;
  const projectedOn =
    left <= 0 || hoursPerWeek <= 0
      ? null
      : addDays(today, Math.ceil((left / hoursPerWeek) * 7));
  return {
    pathId: path.id,
    status: row?.status ?? null,
    startedOn: row?.startedOn ?? null,
    targetOn: row?.targetOn ?? null,
    steps: progress,
    doneSteps: done.size,
    totalSteps: steps.length,
    hoursDone,
    hoursTotal,
    minutesLogged,
    nextStepId: next?.id ?? null,
    projectedOn,
    behind:
      !!row?.targetOn &&
      left > 0 &&
      (projectedOn === null || projectedOn > row.targetOn),
  };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export interface ReminderInput {
  platforms: TrainingPlatformDto[];
  certifications: CertificationDto[];
  paths: PathProgressDto[];
  daysSinceLastSession: number | null;
  /** Whether you follow a path or have a course in progress. */
  studying: boolean;
  days: StudyReminderDays;
  today: string;
}

const formatDays = (days: number) =>
  days === 0
    ? 'today'
    : days > 0
      ? `in ${days} day${days === 1 ? '' : 's'}`
      : `${-days} day${days === -1 ? '' : 's'} ago`;

/** What needs you in Studies, the most urgent first. */
export function studyReminders(input: ReminderInput): StudyReminderDto[] {
  const reminders: StudyReminderDto[] = [];
  const { today, days } = input;

  for (const p of input.platforms) {
    if (p.status !== 'active' || p.plan !== 'subscription') continue;
    const renewal = nextRenewal(p.renewsOn, p.billingPeriod, today);
    if (!renewal) continue;
    const left = daysBetween(today, renewal);
    if (left > days.subscription) continue;
    reminders.push({
      kind: 'subscription',
      refId: p.id,
      title: `${p.name} renews ${formatDays(left)}`,
      detail:
        p.price !== null
          ? `€${p.price.toFixed(2)} per ${p.billingPeriod ?? 'year'}. Keep it only if you used it this ${p.billingPeriod === 'month' ? 'month' : 'year'}: ${p.courses} course${p.courses === 1 ? '' : 's'} tracked on it.`
          : `Keep it only if you are using it: ${p.courses} course${p.courses === 1 ? '' : 's'} tracked on it.`,
      date: renewal,
      daysLeft: left,
      severity: left <= 3 ? 'danger' : 'warning',
    });
  }

  for (const c of input.certifications) {
    if ((c.status === 'planned' || c.status === 'booked') && c.examOn) {
      const left = daysBetween(today, c.examOn);
      if (left < 0)
        reminders.push({
          kind: 'exam',
          refId: c.id,
          title: `${c.name}: exam date passed`,
          detail: 'Mark it passed or not passed, or move the date.',
          date: c.examOn,
          daysLeft: left,
          severity: 'danger',
        });
      else if (left <= days.exam)
        reminders.push({
          kind: 'exam',
          refId: c.id,
          title: `${c.name}: exam ${formatDays(left)}`,
          detail:
            c.status === 'planned'
              ? 'Not booked yet: book it, or move the date.'
              : 'Booked. Plan the last weeks around practice exams.',
          date: c.examOn,
          daysLeft: left,
          severity: left <= 7 ? 'danger' : 'warning',
        });
    }
    if (c.status === 'passed' && c.expiresOn) {
      const left = daysBetween(today, c.expiresOn);
      if (left <= days.certification)
        reminders.push({
          kind: 'certification',
          refId: c.id,
          title:
            left < 0
              ? `${c.name} expired ${formatDays(left)}`
              : `${c.name} expires ${formatDays(left)}`,
          detail: 'Renew it, or decide you no longer need it.',
          date: c.expiresOn,
          daysLeft: left,
          severity: left < 0 ? 'danger' : 'warning',
        });
    }
  }

  for (const p of input.paths) {
    if (p.status !== 'following' || !p.behind || !p.targetOn) continue;
    const path = LEARNING_PATHS.find((l) => l.id === p.pathId);
    reminders.push({
      kind: 'target',
      refId: p.pathId,
      title: `${path?.name ?? p.pathId}: behind your target`,
      detail: p.projectedOn
        ? `At your pace you finish on ${p.projectedOn}, after your target of ${p.targetOn}. Give it more time or move the target.`
        : `No time logged on it lately: you will not reach ${p.targetOn} without it.`,
      date: p.targetOn,
      daysLeft: daysBetween(today, p.targetOn),
      severity: 'info',
    });
  }

  if (
    input.studying &&
    (input.daysSinceLastSession === null ||
      input.daysSinceLastSession >= days.idle)
  )
    reminders.push({
      kind: 'idle',
      refId: null,
      title:
        input.daysSinceLastSession === null
          ? 'No study time logged yet'
          : `No study time for ${input.daysSinceLastSession} days`,
      detail:
        'Even 25 minutes keeps a path alive. Log a session when you study, so your weeks count.',
      date: null,
      daysLeft: null,
      severity: 'info',
    });

  const rank = { danger: 0, warning: 1, info: 2 } as const;
  return reminders.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
  );
}
