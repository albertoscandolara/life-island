import {
  DREAM_STUCK_DAYS,
  HABIT_HISTORY_DAYS,
  isoAddDays,
  isoDaysBetween,
  isoWeekStart,
  type DreamStatus,
  type HabitDto,
} from '@life-island/contracts';

/*
 * Habits and the pulse of a dream as pure functions: how each habit went
 * this week and its streak (moved here from Goals & habits), and whether a
 * dream that is taking steps has gone quiet.
 */

export function withChecks(
  habit: Omit<HabitDto, 'checked' | 'thisWeek' | 'streak'>,
  checks: readonly string[],
  today: string,
): HabitDto {
  const week = isoWeekStart(today);
  const inWeek = (start: string) =>
    checks.filter((d) => d >= start && d <= isoAddDays(start, 6)).length;
  const thisWeek = inWeek(week);
  let streak = thisWeek >= habit.perWeek ? 1 : 0;
  for (
    let start = isoAddDays(week, -7);
    inWeek(start) >= habit.perWeek;
    start = isoAddDays(start, -7)
  )
    streak++;
  return {
    ...habit,
    checked: checks
      .filter((d) => d > isoAddDays(today, -HABIT_HISTORY_DAYS))
      .sort(),
    thisWeek,
    streak,
  };
}

/**
 * How long a dream has been quiet. It is stuck only while it is taking
 * steps, has a chosen step and nothing was done for DREAM_STUCK_DAYS days:
 * a dream you are still thinking through, or resting, never is.
 */
export function dreamPulse(
  dream: { status: DreamStatus; createdAt: string; targetDate: string | null },
  steps: readonly { status: string; doneOn: string | null }[],
  today: string,
): { idleDays: number; stuck: boolean; daysLeft: number | null } {
  const lastDone = steps
    .filter((s) => s.status === 'done')
    .map((s) => s.doneOn)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const since = lastDone ?? dream.createdAt.slice(0, 10);
  const idleDays = Math.max(0, isoDaysBetween(since, today));
  return {
    idleDays,
    stuck:
      dream.status === 'moving' &&
      steps.some((s) => s.status === 'chosen') &&
      idleDays >= DREAM_STUCK_DAYS,
    daysLeft: dream.targetDate ? isoDaysBetween(today, dream.targetDate) : null,
  };
}
