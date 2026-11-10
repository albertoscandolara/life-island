import {
  learningPath,
  pathStep,
  STEP_KIND_LABELS,
  STUDY_TOPIC_LABELS,
  type CertificationDto,
  type CourseDto,
  type PathProgressDto,
  type StudyPlanOutput,
  type StudyReminderDto,
  type StudyStatsDto,
} from '@life-island/contracts';

/*
 * The study coach (AI tool studies.study-coach): the dossier it reads, its
 * instructions, and the plan Life Island writes with its own rules when the
 * tool is off or there is no API key.
 */

export interface CoachInput {
  paths: PathProgressDto[];
  courses: CourseDto[];
  certifications: CertificationDto[];
  stats: StudyStatsDto;
  reminders: StudyReminderDto[];
  /** Hours you have this week; null uses the weekly goal. */
  hours: number | null;
  today: string;
}

export const COACH_INSTRUCTIONS = `You are a study coach for one software developer who studies on their own, around a full-time job. They are a beginner in every path below. You get a dossier: the learning paths they follow with each step's status, their courses, exams ahead, the time they logged week by week against their weekly goal, and reminders.

Write a plan for this week:
- focus: one to four things, taken from the steps not done of the paths they follow (use the step id from the dossier) or from a course in progress. Prefer finishing what is "studying" over starting new steps. Never invent a step id; leave it empty for a course or anything else.
- Keep the total hours within the hours they have this week. If they fell behind the goal lately, plan a smaller week that they will actually finish rather than a big one.
- schedule: spread it over the week in sessions of 25 to 90 minutes, with rest days; weekday evenings are short, weekends can be longer.
- An exam within a month comes first.
- tips: up to three, concrete and specific to this dossier (not generic study advice).
- summary: two or three honest sentences on where they stand.
Answer their own question if they ask one, inside the same structure. Write in plain English, second person, no emojis.`;

const hoursText = (minutes: number) =>
  `${Math.round((minutes / 60) * 10) / 10} h`;

/** The dossier the coach reads: only what you recorded in Studies. */
export function coachDossier(input: CoachInput): string {
  const lines: string[] = [`Today: ${input.today}`];
  const s = input.stats;
  lines.push(
    `Weekly goal: ${s.weeklyGoalHours} h. This week so far: ${hoursText(s.weekMinutes)}. Hours available this week: ${input.hours ?? s.weeklyGoalHours} h.`,
    `Average of the last 8 weeks: ${hoursText(s.averageWeekMinutes)} per week. Streak: ${s.streakWeeks} week(s) at goal.`,
    `Last 12 weeks (oldest first, hours): ${s.weeks.map((w) => Math.round((w.minutes / 60) * 10) / 10).join(', ')}`,
  );
  if (s.daysSinceLastSession !== null)
    lines.push(`Days since the last session: ${s.daysSinceLastSession}`);

  const followed = input.paths.filter((p) => p.status === 'following');
  lines.push('', '## Paths followed');
  if (!followed.length) lines.push('None yet.');
  for (const p of followed) {
    const path = learningPath(p.pathId);
    if (!path) continue;
    lines.push(
      `### ${path.name} (${p.doneSteps}/${p.totalSteps} steps, ${p.hoursDone}/${p.hoursTotal} h${p.targetOn ? `, target ${p.targetOn}` : ''}${p.projectedOn ? `, projected ${p.projectedOn}` : ''})`,
    );
    for (const step of p.steps) {
      if (step.status === 'done') continue;
      const def = pathStep(step.stepId);
      if (!def) continue;
      lines.push(
        `- [${step.status === 'doing' ? 'studying' : 'not started'}] ${step.stepId}: ${def.title} (${STEP_KIND_LABELS[def.kind]}, about ${def.hours} h${step.minutes ? `, ${hoursText(step.minutes)} logged` : ''})`,
      );
    }
  }
  const paused = input.paths.filter((p) => p.status === 'paused');
  if (paused.length)
    lines.push(
      '',
      `Paused paths: ${paused.map((p) => learningPath(p.pathId)?.name ?? p.pathId).join(', ')}`,
    );

  const courses = input.courses.filter(
    (c) => c.status === 'in_progress' || c.status === 'planned',
  );
  if (courses.length) {
    lines.push('', '## Courses');
    for (const c of courses)
      lines.push(
        `- ${c.title} (${c.status === 'in_progress' ? `${c.progress}% done` : 'planned'}${c.platformName ? `, ${c.platformName}` : ''}, ${STUDY_TOPIC_LABELS[c.topic]}${c.hours ? `, ${c.hours} h long` : ''})`,
      );
  }
  const exams = input.certifications.filter(
    (c) => c.status === 'planned' || c.status === 'booked',
  );
  if (exams.length) {
    lines.push('', '## Exams ahead');
    for (const c of exams)
      lines.push(
        `- ${c.name} (${c.status}${c.examOn ? `, on ${c.examOn}` : ', no date'})`,
      );
  }
  if (input.reminders.length) {
    lines.push('', '## Reminders');
    for (const r of input.reminders) lines.push(`- ${r.title}`);
  }
  return lines.join('\n');
}

const WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * The plan with no AI: an exam within a month first, then the steps you are
 * studying, then the next step of each path you follow, filled up to the
 * hours you have; spread over four evenings and the weekend.
 */
export function offlinePlan(
  input: CoachInput,
  question: string | null,
): StudyPlanOutput {
  const budget = input.hours ?? input.stats.weeklyGoalHours;
  const focus: StudyPlanOutput['focus'] = [];
  let left = budget;
  const add = (item: StudyPlanOutput['focus'][number]) => {
    if (left <= 0 || focus.length >= 4) return;
    const hours = Math.min(item.hours, left);
    if (hours <= 0) return;
    focus.push({ ...item, hours: Math.round(hours * 2) / 2 || 0.5 });
    left -= hours;
  };

  const exam = input.certifications
    .filter(
      (c) =>
        (c.status === 'booked' || c.status === 'planned') &&
        c.examOn !== null &&
        c.examOn >= input.today,
    )
    .sort((a, b) => (a.examOn ?? '').localeCompare(b.examOn ?? ''))[0];
  if (exam?.examOn) {
    const days = Math.round(
      (Date.parse(exam.examOn) - Date.parse(input.today)) / 86_400_000,
    );
    if (days <= 30)
      add({
        stepId: '',
        title: `Prepare ${exam.name}`,
        why: `The exam is in ${days} day${days === 1 ? '' : 's'}: practice exams and the topics you got wrong.`,
        hours: budget / 2,
      });
  }

  const followed = input.paths.filter((p) => p.status === 'following');
  for (const p of followed)
    for (const step of p.steps.filter((s) => s.status === 'doing')) {
      const def = pathStep(step.stepId);
      if (def)
        add({
          stepId: step.stepId,
          title: `Finish "${def.title}"`,
          why: `You started it${step.startedOn ? ` on ${step.startedOn}` : ''}: finishing beats starting something new.`,
          hours: Math.max(1, def.hours - step.minutes / 60),
        });
    }
  for (const p of followed) {
    const next = p.steps.find((s) => s.status === 'todo');
    if (!next) continue;
    const def = pathStep(next.stepId);
    const path = learningPath(p.pathId);
    if (def && path)
      add({
        stepId: def.id,
        title: `Start "${def.title}"`,
        why: `Next step of ${path.name}: ${def.outcome}`,
        hours: def.hours,
      });
  }
  for (const c of input.courses.filter((c) => c.status === 'in_progress'))
    add({
      stepId: '',
      title: `Continue ${c.title}`,
      why: `${c.progress}% done${c.platformName ? ` on ${c.platformName}` : ''}.`,
      hours: 2,
    });

  const planned = focus.reduce((sum, f) => sum + f.hours, 0);
  const schedule = spread(planned * 60, focus);
  const tips: string[] = [];
  const s = input.stats;
  if (!followed.length)
    tips.push('Pick one path to follow first: one at a time goes further.');
  if (followed.length > 2)
    tips.push(
      `You follow ${followed.length} paths at once: pause all but two, so each one moves every week.`,
    );
  if (s.averageWeekMinutes > 0 && s.averageWeekMinutes < s.weeklyGoalHours * 30)
    tips.push(
      `You averaged ${hoursText(s.averageWeekMinutes)} a week lately, under half your goal: lower the goal in Settings so it is one you meet, then raise it.`,
    );
  if (tips.length < 3)
    tips.push(
      'Log each session right after it, with the step: your weeks, streak and projections count only what you log.',
    );

  const summary = [
    followed.length
      ? `You follow ${followed.length} path${followed.length === 1 ? '' : 's'} and have done ${s.stepsDone} step${s.stepsDone === 1 ? '' : 's'} so far.`
      : 'You do not follow a learning path yet.',
    `This week: ${hoursText(s.weekMinutes)} of your ${s.weeklyGoalHours} h goal${s.streakWeeks ? `, ${s.streakWeeks} week streak` : ''}.`,
    question
      ? 'Life Island’s own rules cannot answer questions: turn the study coach on in Settings → AI tools, with an API key, for that.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { summary, focus, schedule, tips: tips.slice(0, 3) };
}

/** Sessions of at most 90 minutes on Monday, Tuesday, Thursday and the weekend. */
function spread(
  minutes: number,
  focus: StudyPlanOutput['focus'],
): StudyPlanOutput['schedule'] {
  if (minutes <= 0 || !focus.length) return [];
  const days = [0, 1, 3, 5, 6];
  const weights = [1, 1, 1, 2, 1.5];
  const total = weights.reduce((a, b) => a + b, 0);
  const schedule: StudyPlanOutput['schedule'] = [];
  let item = 0;
  days.forEach((day, i) => {
    const share = Math.round((minutes * weights[i]) / total / 5) * 5;
    if (share < 20) return;
    schedule.push({
      day: WEEK[day],
      minutes: share,
      what: focus[item % focus.length].title,
    });
    item++;
  });
  return schedule;
}
