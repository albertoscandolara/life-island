import {
  GOAL_AREA_LABELS,
  isoAddDays,
  isoDaysBetween,
  isoWeekStart,
  type GoalsCoachOutput,
  type GoalStepDto,
  type HabitDto,
  type LifeGoalDto,
  type WeeklyReviewDto,
} from '@life-island/contracts';

/*
 * Goals as a pure computation: how far each goal is, whether it is stuck,
 * how each habit went this week and its streak.
 */

/** A goal with no step done for this many days is stuck. */
export const STUCK_DAYS = 14;

export function withProgress(
  goal: Omit<
    LifeGoalDto,
    | 'steps'
    | 'progress'
    | 'nextStep'
    | 'overdueSteps'
    | 'idleDays'
    | 'stuck'
    | 'daysLeft'
  >,
  steps: readonly GoalStepDto[],
  today: string,
): LifeGoalDto {
  const own = steps
    .filter((s) => s.goalId === goal.id)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const done = own.filter((s) => s.done);
  const open = own.filter((s) => !s.done);
  const lastDone = done
    .map((s) => s.doneOn)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const since = lastDone ?? goal.createdAt.slice(0, 10);
  const idleDays = Math.max(0, isoDaysBetween(since, today));
  return {
    ...goal,
    steps: own,
    progress: own.length ? Math.round((done.length / own.length) * 100) : null,
    nextStep: open[0] ?? null,
    overdueSteps: open.filter((s) => s.dueDate && s.dueDate < today).length,
    idleDays,
    stuck: goal.status === 'active' && (idleDays >= STUCK_DAYS || !open.length),
    daysLeft: goal.targetDate ? isoDaysBetween(today, goal.targetDate) : null,
  };
}

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
    checked: checks.filter((d) => d > isoAddDays(today, -28)).sort(),
    thisWeek,
    streak,
  };
}

export function offlineCoach(
  goals: readonly LifeGoalDto[],
  habits: readonly HabitDto[],
): GoalsCoachOutput {
  const active = goals.filter((g) => g.status === 'active');
  const stuck = active.filter((g) => g.stuck);
  const moving = active.filter((g) => !g.stuck);
  if (!active.length)
    return {
      summary:
        'There is no active goal yet. Pick one thing that would make the next months better, and write why it matters.',
      unstuck: [],
      focus: [
        {
          title: 'Write one goal and its first small step',
          why: 'A goal with a first step gets started; one without stays a wish.',
        },
      ],
      encouragement:
        'Starting is the hardest part, and you are already looking at it.',
    };
  const reached = habits.filter((h) => h.active && h.thisWeek >= h.perWeek);
  return {
    summary:
      `${active.length} active goal${active.length === 1 ? '' : 's'}: ${moving.length} moving, ${stuck.length} stuck.` +
      (stuck.length
        ? ' Unblock one stuck goal this week, not all of them.'
        : ' Keep the pace.'),
    unstuck: stuck.slice(0, 3).map((g) => ({
      goal: g.title,
      whyStuck: !g.nextStep
        ? 'It has no next step, so there is nothing to do.'
        : `Nothing done for ${g.idleDays} days; the next step may be too big.`,
      nextStep: g.nextStep
        ? `Spend 20 minutes on the first part of “${g.nextStep.title}”.`
        : 'Write the very next step, small enough for 20 minutes.',
    })),
    focus: [...active]
      .filter((g) => g.nextStep)
      .sort((a, b) =>
        (a.nextStep?.dueDate ?? '9999').localeCompare(
          b.nextStep?.dueDate ?? '9999',
        ),
      )
      .slice(0, 3)
      .map((g) => ({
        title: g.nextStep!.title,
        why: `The next step of “${g.title}”${g.nextStep!.dueDate ? `, due ${g.nextStep!.dueDate}` : ''}.`,
      })),
    encouragement: reached.length
      ? `You already reached ${reached.length} habit${reached.length === 1 ? '' : 's'} this week: that is real progress.`
      : moving.length
        ? `${moving.length} goal${moving.length === 1 ? ' is' : 's are'} moving. Small steps add up.`
        : 'Every goal stalls sometimes. One small step today is enough to restart.',
  };
}

export const COACH_INSTRUCTIONS = `You are a warm, practical coach inside Life Island, an app that helps one person keep their life under control and get unstuck.

You receive their goals (area, why, measure, target date, status, steps with due dates and which are done, days since the last step), their habits (target days a week, this week, streak) and their last weekly reviews (wins, where they felt stuck, what is next). Write:
- summary: two or three honest sentences on where the goals stand.
- unstuck: up to three stuck goals, the most important first. For each, the likely reason from the data (no next step, a step too big, a long pause, a goal too vague) and ONE next step doable in under 30 minutes.
- focus: up to three things for this week, verb first, with why.
- encouragement: one or two warm, specific sentences about real progress in the data.

Rules: use only what is given; never invent progress. Plain, kind English, no jargon, no emojis, no therapy talk. If they wrote a question, answer it within the same fields.`;

export function coachDossier(
  today: string,
  goals: readonly LifeGoalDto[],
  habits: readonly HabitDto[],
  reviews: readonly WeeklyReviewDto[],
): string {
  const lines = [`Today is ${today}.`, '<goals>'];
  for (const g of goals.filter(
    (g) => g.status === 'active' || g.status === 'paused',
  )) {
    lines.push(
      `- ${g.title} (${GOAL_AREA_LABELS[g.area]}, ${g.status}${g.targetDate ? `, target ${g.targetDate}` : ''}; ${g.idleDays} days since the last step${g.stuck ? '; STUCK' : ''})`,
    );
    if (g.why) lines.push(`  Why: ${g.why.slice(0, 300)}`);
    if (g.measure) lines.push(`  Reached when: ${g.measure.slice(0, 200)}`);
    for (const s of g.steps.slice(0, 12))
      lines.push(
        `  [${s.done ? 'x' : ' '}] ${s.title}${s.dueDate ? ` (due ${s.dueDate})` : ''}`,
      );
  }
  lines.push('</goals>', '<habits>');
  for (const h of habits.filter((h) => h.active))
    lines.push(
      `- ${h.title}: ${h.thisWeek} of ${h.perWeek} days this week, streak ${h.streak} weeks`,
    );
  lines.push('</habits>', '<reviews>');
  for (const r of reviews.slice(0, 3))
    lines.push(
      `- Week of ${r.weekStart}${r.mood ? `, mood ${r.mood}/5` : ''}: wins: ${r.wins ?? '—'}; stuck: ${r.stuck ?? '—'}; next: ${r.next ?? '—'}`.slice(
        0,
        800,
      ),
    );
  lines.push('</reviews>');
  return lines.join('\n');
}
