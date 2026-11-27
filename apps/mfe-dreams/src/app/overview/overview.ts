import {
  DREAM_AREA_EMBLEMS,
  type DreamDto,
  type DreamMilestoneDto,
  type DreamsOverviewDto,
  type DreamStepDto,
} from '@life-island/contracts';

/*
 * The Overview of Dreams without the template: the four tiles, Up next (the
 * one thing to do for each dream), the proof you collected, and how hard the
 * steps were against how hard you feared they would be.
 */

/** YYYY-MM of `today` moved by `months`. */
export function monthOf(today: string, months = 0): string {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + months, 1)).toISOString().slice(0, 7);
}

const open = (d: DreamDto) => d.status === 'moving' || d.status === 'dreaming';

export interface DreamsTiles {
  next: {
    step: DreamStepDto;
    dream: DreamDto;
  } | null;
  /** Open dreams with no chosen step. */
  waiting: number;
  steps: { thisMonth: number; lastMonth: number; total: number };
  fear: {
    /** Steps done with both a forecast and how hard they really were. */
    compared: number;
    /** Of those, how many were easier than feared, or as hard. */
    easier: number;
    same: number;
  };
  habits: { onTarget: number; active: number };
}

export function dreamsTiles(data: DreamsOverviewDto): DreamsTiles {
  const month = monthOf(data.today);
  const lastMonth = monthOf(data.today, -1);
  const done = data.dreams.flatMap((d) =>
    d.steps.filter((s) => s.status === 'done' && s.doneOn),
  );
  const pairs = fearPairs(data);
  const active = data.habits.filter((h) => h.active);
  const planned = upNext(data).filter(
    (i): i is UpNextItem & { step: DreamStepDto } =>
      i.kind === 'step' && !!i.step,
  );
  // The lead tile: the step with the nearest day, else the first one.
  const first =
    [...planned]
      .filter((i) => i.step.dueDate)
      .sort((a, b) => a.step.dueDate!.localeCompare(b.step.dueDate!))[0] ??
    planned[0];
  return {
    next: first ? { step: first.step, dream: first.dream } : null,
    waiting: data.dreams.filter((d) => open(d) && !d.nextStep).length,
    steps: {
      thisMonth: done.filter((s) => s.doneOn!.startsWith(month)).length,
      lastMonth: done.filter((s) => s.doneOn!.startsWith(lastMonth)).length,
      total: done.length,
    },
    fear: {
      compared: pairs.length,
      easier: pairs.filter((p) => p.actual < p.expected).length,
      same: pairs.filter((p) => p.actual === p.expected).length,
    },
    habits: {
      onTarget: active.filter((h) => h.thisWeek >= h.perWeek).length,
      active: active.length,
    },
  };
}

export type UpNextKind = 'check-in' | 'step' | 'steps' | 'questions';

export interface UpNextItem {
  key: string;
  kind: UpNextKind;
  dream: DreamDto;
  emblem: string;
  /** "Dream · milestone 2 of 5: I know what is out there". */
  context: string;
  title: string;
  /** Why it matters: the step's purpose, or what the action is for. */
  purpose: string;
  step: DreamStepDto | null;
  milestone: DreamMilestoneDto | null;
  /** Taking steps, nothing done for two weeks. */
  stuck: boolean;
}

function milestoneContext(
  dream: DreamDto,
  milestone: DreamMilestoneDto | null,
): string {
  if (!milestone) return dream.title;
  const at = dream.milestones.indexOf(milestone) + 1;
  return `${dream.title} · milestone ${at} of ${dream.milestones.length}: ${milestone.title}`;
}

/**
 * One line per open dream, the thing that moves it now: a check-in still to
 * write, the chosen step (with its plan), a new round of steps, or Ovi's
 * questions. Check-ins first (they set the pace), then planned steps by day.
 */
export function upNext(data: DreamsOverviewDto): UpNextItem[] {
  const items: UpNextItem[] = [];
  for (const dream of data.dreams.filter(open)) {
    const emblem = DREAM_AREA_EMBLEMS[dream.area];
    const current = dream.milestones.find((m) => m.current) ?? null;
    const awaiting = dream.steps.find((s) => s.awaitingCheckIn);
    if (awaiting) {
      items.push({
        key: `check-in:${awaiting.id}`,
        kind: 'check-in',
        dream,
        emblem,
        context: dream.title,
        title: `How did “${awaiting.title}” go?`,
        purpose:
          'A short check-in sets the pace of the next steps, and keeps what it showed you.',
        step: awaiting,
        milestone: null,
        stuck: false,
      });
      continue;
    }
    if (dream.nextStep) {
      const step = dream.nextStep;
      const milestone =
        dream.milestones.find((m) => m.id === step.milestoneId) ?? current;
      items.push({
        key: `step:${step.id}`,
        kind: 'step',
        dream,
        emblem,
        context: milestoneContext(dream, milestone),
        title: step.title,
        purpose:
          step.why ??
          (milestone ? `Towards “${milestone.title}”.` : 'Your next step.'),
        step,
        milestone,
        stuck: dream.stuck,
      });
      continue;
    }
    const unanswered = dream.unansweredQuestions;
    if (!dream.questions.length || unanswered === dream.questions.length)
      items.push({
        key: `questions:${dream.id}`,
        kind: 'questions',
        dream,
        emblem,
        context: dream.title,
        title: dream.questions.length
          ? `Answer Ovi's ${unanswered} question${unanswered === 1 ? '' : 's'}`
          : 'Let Ovi ask a few questions',
        purpose:
          'Five minutes of honest answers make every step fit your life, your fears and your limits.',
        step: null,
        milestone: current,
        stuck: false,
      });
    else
      items.push({
        key: `steps:${dream.id}`,
        kind: 'steps',
        dream,
        emblem,
        context: milestoneContext(dream, current),
        title: 'Pick your next small step',
        purpose: current
          ? `Ovi suggests a few, each aimed at “${current.title}”. Choosing one is the step.`
          : 'Ovi suggests a few with their cost and how to undo them, and draws the path to the dream.',
        step: null,
        milestone: current,
        stuck: false,
      });
  }
  const order: Record<UpNextKind, number> = {
    'check-in': 0,
    step: 1,
    steps: 2,
    questions: 3,
  };
  return items.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      (a.step?.dueDate ?? '9999').localeCompare(b.step?.dueDate ?? '9999'),
  );
}

export interface FearPair {
  stepId: string;
  title: string;
  dream: string;
  date: string;
  expected: number;
  actual: number;
}

/** Steps you did with a forecast and a real hardness, oldest first, the last eight. */
export function fearPairs(data: DreamsOverviewDto): FearPair[] {
  return data.dreams
    .flatMap((d) =>
      d.checkIns
        .filter(
          (c) =>
            c.stepId &&
            c.outcome === 'done' &&
            c.expectedHard !== null &&
            c.actualHard !== null,
        )
        .map((c) => ({
          stepId: c.stepId!,
          title: c.stepTitle ?? 'A step',
          dream: d.title,
          date: c.createdAt.slice(0, 10),
          expected: c.expectedHard!,
          actual: c.actualHard!,
        })),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8);
}

export interface ProofItem {
  id: string;
  dream: string;
  emblem: string;
  step: string | null;
  learned: string;
  date: string;
}

/** What your steps showed you, newest first: proof that you can. */
export function proof(data: DreamsOverviewDto): ProofItem[] {
  return data.dreams
    .flatMap((d) =>
      d.checkIns
        .filter((c) => c.learned)
        .map((c) => ({
          id: c.id,
          dream: d.title,
          emblem: DREAM_AREA_EMBLEMS[d.area],
          step: c.stepTitle,
          learned: c.learned!,
          date: c.createdAt.slice(0, 10),
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
