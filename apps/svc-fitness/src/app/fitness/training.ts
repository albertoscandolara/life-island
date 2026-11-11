import {
  activeMinutes,
  isoAddDays,
  isoWeekStart,
  WORKOUT_KIND_LABELS,
  type FitnessEventDto,
  type FitnessOverviewDto,
  type FitnessWeekDto,
  type MeasurementDto,
  type TrainingPlanOutput,
  type WorkoutDto,
  type WorkoutKind,
} from '@life-island/contracts';

/*
 * Fitness as a pure computation: active minutes per week against the goal,
 * the streak of weeks at goal, weight and sleep trends, and the coach's own
 * plan.
 */

const round1 = (v: number) => Math.round(v * 10) / 10;

export function weeks(
  workouts: readonly WorkoutDto[],
  today: string,
): FitnessWeekDto[] {
  const current = isoWeekStart(today);
  return Array.from({ length: 12 }, (_, i) => {
    const weekStart = isoAddDays(current, (i - 11) * 7);
    const end = isoAddDays(weekStart, 6);
    const own = workouts.filter((w) => w.date >= weekStart && w.date <= end);
    const byKind: Partial<Record<WorkoutKind, number>> = {};
    for (const w of own) byKind[w.kind] = (byKind[w.kind] ?? 0) + w.minutes;
    return {
      weekStart,
      activeMinutes: own.reduce((s, w) => s + w.activeMinutes, 0),
      workouts: own.length,
      byKind,
    };
  });
}

export function stats(
  list: readonly FitnessWeekDto[],
  measurements: readonly MeasurementDto[],
  goal: number,
  today: string,
): FitnessOverviewDto['stats'] {
  const thisWeek = list[list.length - 1]?.activeMinutes ?? 0;
  let streak = 0;
  for (let i = list.length - 2; i >= 0 && list[i].activeMinutes >= goal; i--)
    streak++;
  if (thisWeek >= goal) streak++;
  const full = list.slice(-5, -1);
  const weights = measurements
    .filter((m) => m.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = weights[weights.length - 1] ?? null;
  const monthAgo =
    [...weights].reverse().find((m) => m.date <= isoAddDays(today, -30)) ??
    null;
  const sleep = measurements.filter(
    (m) => m.sleepHours !== null && m.date > isoAddDays(today, -7),
  );
  return {
    thisWeek,
    streak,
    averageLast4: full.length
      ? Math.round(full.reduce((s, w) => s + w.activeMinutes, 0) / full.length)
      : 0,
    latestWeight: latest?.weightKg ?? null,
    weightChange30:
      latest && monthAgo ? round1(latest.weightKg! - monthAgo.weightKg!) : null,
    averageSleep7: sleep.length
      ? round1(sleep.reduce((s, m) => s + m.sleepHours!, 0) / sleep.length)
      : null,
  };
}

export function withActive(w: Omit<WorkoutDto, 'activeMinutes'>): WorkoutDto {
  return { ...w, activeMinutes: activeMinutes(w.minutes, w.intensity) };
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** A simple week towards the goal: alternate moving days and rest, a longer one at the weekend. */
export function offlinePlan(
  s: FitnessOverviewDto['stats'],
  goal: number,
  favourite: WorkoutKind | null,
  nextEvent: FitnessEventDto | null,
): TrainingPlanOutput {
  // Build up gently: at most 20% more than the last weeks' average.
  const target = Math.max(
    60,
    Math.min(goal, Math.round((s.averageLast4 || 60) * 1.2)),
  );
  const main = favourite
    ? WORKOUT_KIND_LABELS[favourite].toLowerCase()
    : 'brisk walk';
  const sessions = Math.max(3, Math.min(5, Math.round(target / 40)));
  const moving = [0, 2, 4, 5, 6].slice(0, sessions);
  const each = Math.round(target / sessions / 5) * 5;
  return {
    summary:
      `This week you have ${s.thisWeek} active minutes of ${goal}. ` +
      (s.streak
        ? `${s.streak} week${s.streak === 1 ? '' : 's'} in a row at goal: keep it going.`
        : `Aim for ${target} this week, then build up.`),
    days: DAYS.map((day, i) => {
      const on = moving.includes(i);
      const long = i === 5 && on;
      return {
        day,
        session: on
          ? i === 2
            ? 'Strength or mobility, at home or at the gym'
            : long
              ? `Longer ${main}`
              : main[0].toUpperCase() + main.slice(1)
          : 'Rest, or a relaxed walk',
        minutes: on ? (long ? each + 15 : each) : 0,
        intensity: on
          ? i === 2
            ? 'moderate'
            : long
              ? 'easy'
              : 'moderate'
          : 'easy',
      };
    }),
    tips: [
      'Increase by no more than 10–20% a week.',
      ...(s.averageSleep7 !== null && s.averageSleep7 < 7
        ? ['You sleep under 7 hours: rest helps more than an extra session.']
        : []),
      ...(nextEvent
        ? [
            `${nextEvent.name} is in ${nextEvent.daysToGo} days: keep the last week lighter.`,
          ]
        : []),
    ].slice(0, 3),
  };
}

export const COACH_INSTRUCTIONS = `You are a sensible fitness coach inside Life Island, an app that helps one person look after their life. They are not an athlete unless the data says so.

You receive their weekly active minutes for the last weeks against their goal (WHO: 150 a week), this week's workouts, the streak, weight and sleep trends, and the events they train for. Write:
- summary: two sentences on where their fitness stands this week, honest and encouraging.
- days: seven days, Monday to Sunday, each with a session (or Rest), minutes and intensity. Build up by at most 20% over the recent average; include rest days and at least one strength or mobility session; taper before an event.
- tips: up to three short, safe tips.

Rules: never give medical advice; suggest seeing a doctor before starting hard training after a long break or with symptoms. Plain English, no emojis.`;

export function coachDossier(
  today: string,
  goal: number,
  list: readonly FitnessWeekDto[],
  s: FitnessOverviewDto['stats'],
  events: readonly FitnessEventDto[],
): string {
  return [
    `Today is ${today}. Weekly goal: ${goal} active minutes.`,
    'Last weeks (active minutes, workouts, minutes by kind):',
    ...list.slice(-6).map(
      (w) =>
        `- week of ${w.weekStart}: ${w.activeMinutes} min, ${w.workouts} workouts${
          Object.keys(w.byKind).length
            ? ` (${Object.entries(w.byKind)
                .map(([k, m]) => `${k} ${m}`)
                .join(', ')})`
            : ''
        }`,
    ),
    `Streak at goal: ${s.streak} weeks. Average of the last 4 full weeks: ${s.averageLast4} min.`,
    `Weight: ${s.latestWeight ?? 'unknown'} kg${s.weightChange30 !== null ? ` (${s.weightChange30 > 0 ? '+' : ''}${s.weightChange30} kg in 30 days)` : ''}. Sleep, last 7 days: ${s.averageSleep7 ?? 'unknown'} h.`,
    'Events ahead:',
    ...events
      .filter((e) => !e.done && e.daysToGo >= 0)
      .map(
        (e) =>
          `- ${e.name} in ${e.daysToGo} days${e.target ? `, target: ${e.target}` : ''}`,
      ),
  ].join('\n');
}
