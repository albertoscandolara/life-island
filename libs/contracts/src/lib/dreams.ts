import { z } from 'zod';
import {
  lifeDate,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Dreams (Ovi, svc-dreams, mfe-dreams): something you would love to reach,
 * written in your own words, and a careful way towards it. Ovi first asks a
 * few questions (what is wrong today, what scares you, what you cannot risk),
 * then suggests a handful of small, reversible steps, each with what it costs
 * you and how to undo it. After each step you say how it felt, and the next
 * suggestions follow that pace. Ovi suggests; you decide. A dream can be
 * about any area of life, so it can read, only when you tick them, a short
 * summary of the other areas of the island (your savings for a safety net,
 * your time at work, the studies you follow).
 *
 * Dreams also holds what Goals & habits used to (merged in November 2026):
 * a dream can say how you will know it is reached and by when, the habits
 * you repeat for it (a few days a week, with streaks), and a short weekly
 * review that covers every dream.
 */

export const DREAM_AREAS = [
  'work',
  'travel',
  'fitness',
  'learning',
  'money',
  'home',
  'relationships',
  'creativity',
  'wellbeing',
  'other',
] as const;
export type DreamArea = (typeof DREAM_AREAS)[number];
export const DREAM_AREA_LABELS: Record<DreamArea, string> = {
  work: 'Work and career',
  travel: 'Travel and places',
  fitness: 'Body and sport',
  learning: 'Learning something new',
  money: 'Money and freedom',
  home: 'Home and where I live',
  relationships: 'People and relationships',
  creativity: 'Creating something',
  wellbeing: 'Calm and wellbeing',
  other: 'Something else',
};
export const DREAM_AREA_EMBLEMS: Record<DreamArea, string> = {
  work: '💼',
  travel: '🧭',
  fitness: '🏃',
  learning: '📚',
  money: '🪙',
  home: '🏡',
  relationships: '🤝',
  creativity: '🎨',
  wellbeing: '🌿',
  other: '🌄',
};

export const DREAM_STATUSES = [
  'dreaming',
  'moving',
  'paused',
  'reached',
  'let-go',
] as const;
export type DreamStatus = (typeof DREAM_STATUSES)[number];
export const DREAM_STATUS_LABELS: Record<DreamStatus, string> = {
  dreaming: 'Thinking it through',
  moving: 'Taking steps',
  paused: 'Resting',
  reached: 'Reached',
  'let-go': 'Let go',
};

/** How fast you want to go: it caps how far each step reaches outside the comfort zone. */
export const DREAM_PACES = ['gentle', 'steady', 'bolder'] as const;
export type DreamPace = (typeof DREAM_PACES)[number];
export const DREAM_PACE_LABELS: Record<DreamPace, string> = {
  gentle: 'Gentle: tiny steps, nothing anyone else sees',
  steady: 'Steady: small steps, a little stretch now and then',
  bolder: 'Bolder: I am ready for a brave step sometimes',
};

/** How far a step reaches outside the comfort zone. */
export const DREAM_STRETCHES = ['tiny', 'small', 'brave'] as const;
export type DreamStretch = (typeof DREAM_STRETCHES)[number];
export const DREAM_STRETCH_LABELS: Record<DreamStretch, string> = {
  tiny: 'Inside the comfort zone',
  small: 'A small stretch',
  brave: 'A brave step',
};

/** What kind of step it is, in the order a dream usually needs them. */
export const DREAM_STEP_KINDS = [
  'reflect',
  'explore',
  'prepare',
  'try',
  'decide',
] as const;
export type DreamStepKind = (typeof DREAM_STEP_KINDS)[number];
export const DREAM_STEP_KIND_LABELS: Record<DreamStepKind, string> = {
  reflect: 'Think',
  explore: 'Explore',
  prepare: 'Prepare',
  try: 'Try',
  decide: 'Decide',
};

export const DREAM_STEP_STATUSES = [
  'suggested',
  'chosen',
  'done',
  'skipped',
  'dismissed',
] as const;
export type DreamStepStatus = (typeof DREAM_STEP_STATUSES)[number];

/** How a step felt, 1 to 5, in the check-in after it. */
export const DREAM_FEELINGS = [
  { value: 1, emblem: '😣', label: 'Too much' },
  { value: 2, emblem: '😟', label: 'Uneasy' },
  { value: 3, emblem: '😐', label: 'OK' },
  { value: 4, emblem: '🙂', label: 'Good' },
  { value: 5, emblem: '😊', label: 'Energising' },
] as const;

/** What you want from the next steps, after a check-in. */
export const DREAM_NEXT_PACES = ['smaller', 'same', 'bigger'] as const;
export type DreamNextPace = (typeof DREAM_NEXT_PACES)[number];
export const DREAM_NEXT_PACE_LABELS: Record<DreamNextPace, string> = {
  smaller: 'Smaller next time',
  same: 'About the same',
  bigger: 'I can go a bit further',
};

// ---------------------------------------------------------------------------
// The other areas a dream can read (only the ones you tick on it)
// ---------------------------------------------------------------------------

export const DREAM_CONTEXT_AREAS = [
  'money',
  'work',
  'studies',
  'fitness',
  'travel',
] as const;
export type DreamContextArea = (typeof DREAM_CONTEXT_AREAS)[number];
export const DREAM_CONTEXT_SOURCES: Record<
  DreamContextArea,
  { name: string; emblem: string; reads: string }
> = {
  money: {
    name: 'Money',
    emblem: '💶',
    reads:
      'your total balance, what you spend in a usual month and your savings rate, for the months of safety net you have',
  },
  work: {
    name: 'Work',
    emblem: '💼',
    reads:
      'your months at the current job, since the last rise, your monthly salary and job applications (no company names)',
  },
  studies: {
    name: 'Studies',
    emblem: '📚',
    reads:
      'the learning paths you follow, your study time a week and the courses in progress',
  },
  fitness: {
    name: 'Fitness',
    emblem: '🏃',
    reads: 'your active minutes a week against your goal, and your sleep',
  },
  travel: {
    name: 'Travel',
    emblem: '✈️',
    reads: 'the trips ahead and what travel cost you this year',
  },
};

/** The areas a new dream offers to read, by its area of life. */
export const DREAM_DEFAULT_CONTEXT: Record<DreamArea, DreamContextArea[]> = {
  work: ['money', 'work', 'studies'],
  travel: ['money', 'travel'],
  fitness: ['fitness'],
  learning: ['studies', 'money'],
  money: ['money', 'work'],
  home: ['money'],
  relationships: [],
  creativity: ['studies'],
  wellbeing: ['fitness'],
  other: [],
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const dreamRequestSchema = z.object({
  title: lifeName(200),
  area: z.enum(DREAM_AREAS).optional(),
  /** The dream as you would tell it to a friend. */
  story: lifeNote(2000),
  /** Why it matters to you. */
  why: lifeNote(1000),
  /** Where you are today, what is not right. */
  today: lifeNote(1500),
  /** What scares you about it. */
  fears: lifeNote(1500),
  /** What you cannot put at risk: income, time, people. */
  mustKeep: lifeNote(1000),
  /** How you will know it is reached. */
  measure: lifeNote(300),
  /** When you would like to reach it; a wish, never a deadline that turns red. */
  targetDate: lifeOptionalDate,
  pace: z.enum(DREAM_PACES).optional(),
  status: z.enum(DREAM_STATUSES).optional(),
  /** The other areas this dream may read. */
  contextAreas: z.array(z.enum(DREAM_CONTEXT_AREAS)).max(6).optional(),
});
export type DreamRequest = z.input<typeof dreamRequestSchema>;

/** Something you repeat a few days a week, for a dream or for its own sake. */
export const habitRequestSchema = z.object({
  title: lifeName(120),
  dreamId: z.uuid().nullable().optional(),
  /** How many days a week you aim for (7 is every day). */
  perWeek: z.number().int().min(1).max(7).optional(),
  active: z.boolean().optional(),
});
export type HabitRequest = z.input<typeof habitRequestSchema>;

/** How far back a habit's checked days go: 13 weeks, for its calendar. */
export const HABIT_HISTORY_DAYS = 91;

export const habitCheckRequestSchema = z.object({
  date: lifeDate,
  done: z.boolean(),
});
export type HabitCheckRequest = z.infer<typeof habitCheckRequestSchema>;

/** The few lines you write at the end of a week, about every dream at once. */
export const weeklyReviewRequestSchema = z.object({
  weekStart: lifeDate,
  /** 1 (rough) to 5 (great). */
  mood: z.number().int().min(1).max(5).nullable().optional(),
  wins: lifeNote(2000),
  stuck: lifeNote(2000),
  next: lifeNote(2000),
});
export type WeeklyReviewRequest = z.input<typeof weeklyReviewRequestSchema>;

export const dreamStepRequestSchema = z.object({
  dreamId: z.uuid(),
  title: lifeName(200),
  kind: z.enum(DREAM_STEP_KINDS).optional(),
  why: lifeNote(600),
  minutes: z.number().int().min(0).max(6000).nullable().optional(),
  /** What it costs in euro; 0 for nothing. */
  costEuro: z.number().min(0).max(1_000_000).nullable().optional(),
  /** What it costs you, in words: time, money, energy. */
  cost: lifeNote(300),
  stretch: z.enum(DREAM_STRETCHES).optional(),
  /** How to undo it, or why there is nothing to undo. */
  undo: lifeNote(400),
  /** A smaller version, for when this one feels too much. */
  smaller: lifeNote(300),
  status: z.enum(DREAM_STEP_STATUSES).optional(),
  dueDate: lifeOptionalDate,
});
export type DreamStepRequest = z.input<typeof dreamStepRequestSchema>;

export const dreamAnswerRequestSchema = z.object({
  answer: lifeNote(1500),
});
export type DreamAnswerRequest = z.input<typeof dreamAnswerRequestSchema>;

export const dreamCheckInRequestSchema = z.object({
  dreamId: z.uuid(),
  /** The step it is about; none for how the dream feels in general. */
  stepId: z.uuid().nullable().optional(),
  /** What happened to the step: done, or you chose not to do it. */
  outcome: z.enum(['done', 'skipped']).nullable().optional(),
  feeling: z.number().int().min(1).max(5),
  note: lifeNote(1500),
  nextPace: z.enum(DREAM_NEXT_PACES).optional(),
});
export type DreamCheckInRequest = z.input<typeof dreamCheckInRequestSchema>;

export const dreamSuggestRequestSchema = z.object({
  /** Something to tell Ovi this time: "I only have weekends". */
  note: z.string().trim().max(1000).nullable().optional(),
});
export type DreamSuggestRequest = z.input<typeof dreamSuggestRequestSchema>;

// ---------------------------------------------------------------------------
// What the model writes (structured output)
// ---------------------------------------------------------------------------

export const dreamQuestionsOutputSchema = z.object({
  opening: z
    .string()
    .describe(
      'One or two warm sentences that say the dream back in your own words, so you feel heard',
    ),
  questions: z
    .array(
      z.object({
        question: z.string().describe('One open, kind question'),
        why: z
          .string()
          .describe('Why the answer helps plan the steps, in one sentence'),
      }),
    )
    .describe('Three to five questions, the most important first'),
});
export type DreamQuestionsOutput = z.infer<typeof dreamQuestionsOutputSchema>;

export const dreamStepsOutputSchema = z.object({
  reflection: z
    .string()
    .describe(
      'Two or three honest, kind sentences: where the dream stands and what the next steps are for',
    ),
  steps: z
    .array(
      z.object({
        title: z.string().describe('The step, verb first, concrete'),
        kind: z.enum(DREAM_STEP_KINDS),
        why: z.string().describe('What it teaches you or prepares'),
        minutes: z.number().describe('About how long it takes'),
        costEuro: z.number().describe('Money it costs; 0 for none'),
        cost: z
          .string()
          .describe(
            'What else it asks of you, in a few words (energy, a day off); empty when minutes and money say it all',
          ),
        stretch: z.enum(DREAM_STRETCHES),
        undo: z
          .string()
          .describe(
            'How to undo it, or why nothing needs undoing; every step must be reversible',
          ),
        smaller: z
          .string()
          .describe('A smaller version for a day it feels too much'),
      }),
    )
    .describe('Two to four small steps, the first one the easiest'),
  notYet: z
    .array(
      z.object({
        move: z.string().describe('A bigger move that is not for now'),
        when: z
          .string()
          .describe('What should be true first, from the data and answers'),
      }),
    )
    .describe('Up to three bigger moves to keep for later, with their sign'),
  care: z
    .string()
    .nullable()
    .describe(
      'A gentle note when the check-ins or answers sound heavy, else null',
    ),
});
export type DreamStepsOutput = z.infer<typeof dreamStepsOutputSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type DreamQuestionDto = LifeRecord<{
  dreamId: string;
  question: string;
  why: string | null;
  answer: string | null;
  source: 'claude' | 'offline';
}>;

export type DreamStepDto = LifeRecord<{
  dreamId: string;
  title: string;
  kind: DreamStepKind;
  why: string | null;
  minutes: number | null;
  costEuro: number | null;
  cost: string | null;
  stretch: DreamStretch;
  undo: string | null;
  smaller: string | null;
  status: DreamStepStatus;
  dueDate: string | null;
  doneOn: string | null;
  /** 'goals': a step done in Goals & habits before the merge. */
  source: 'claude' | 'offline' | 'you' | 'goals';
}> & {
  /** Done or skipped, with no check-in yet (never a step done back in Goals). */
  awaitingCheckIn: boolean;
};

export type DreamCheckInDto = LifeRecord<{
  dreamId: string;
  stepId: string | null;
  outcome: 'done' | 'skipped' | null;
  feeling: number;
  note: string | null;
  nextPace: DreamNextPace;
}> & { stepTitle: string | null };

/** The reflection and the bigger moves of the last suggestions, kept with the dream. */
export interface DreamGuidanceDto {
  reflection: string;
  notYet: DreamStepsOutput['notYet'];
  care: string | null;
  source: 'claude' | 'offline';
  model: string | null;
  createdAt: string;
}

export type DreamDto = LifeRecord<{
  title: string;
  area: DreamArea;
  story: string | null;
  why: string | null;
  today: string | null;
  fears: string | null;
  mustKeep: string | null;
  measure: string | null;
  targetDate: string | null;
  pace: DreamPace;
  status: DreamStatus;
  contextAreas: DreamContextArea[];
}> & {
  opening: string | null;
  questions: DreamQuestionDto[];
  /** Chosen first, then suggested, then done and skipped. */
  steps: DreamStepDto[];
  /** Newest first. */
  checkIns: DreamCheckInDto[];
  guidance: DreamGuidanceDto | null;
  /** The first chosen step. */
  nextStep: DreamStepDto | null;
  doneSteps: number;
  unansweredQuestions: number;
  /** How far the next steps may reach, from the pace and the latest check-ins. */
  reach: DreamReach;
  /** Days since a step was last done (or since the dream was written). */
  idleDays: number;
  /** Taking steps, with a chosen step and nothing done for DREAM_STUCK_DAYS days. */
  stuck: boolean;
  /** Days to the target date; null without one. */
  daysLeft: number | null;
};

/** A dream taking steps with nothing done for this many days is stuck. */
export const DREAM_STUCK_DAYS = 14;

export type HabitDto = LifeRecord<{
  title: string;
  dreamId: string | null;
  perWeek: number;
  active: boolean;
}> & {
  /** The days checked in the last HABIT_HISTORY_DAYS days (13 weeks). */
  checked: string[];
  thisWeek: number;
  /** Weeks in a row at target, this one included once it is reached. */
  streak: number;
};

export type WeeklyReviewDto = LifeRecord<{
  weekStart: string;
  mood: number | null;
  wins: string | null;
  stuck: string | null;
  next: string | null;
}>;

export interface DreamReach {
  /** The furthest stretch the next steps may have. */
  maxStretch: DreamStretch;
  /** How many steps to suggest at a time. */
  count: number;
  /** Why, in a sentence you read on the page. */
  reason: string;
  /** The check-ins sound heavy: slow down, and say support is there. */
  heavy: boolean;
}

export interface DreamContextFactDto {
  label: string;
  value: string;
}

/** What one area of the island says about you, for one dream. */
export interface DreamContextAreaDto {
  area: DreamContextArea;
  name: string;
  emblem: string;
  /** False when the area did not answer (it is not running, or has no data). */
  reachable: boolean;
  error: string | null;
  facts: DreamContextFactDto[];
}

export interface DreamSafetyNetDto {
  balance: number | null;
  /** What a usual month costs you: the average of the last three full months. */
  monthlySpending: number | null;
  /** Balance over a usual month. */
  runwayMonths: number | null;
  savingsRate: number | null;
}

export interface DreamContextDto {
  areas: DreamContextAreaDto[];
  safetyNet: DreamSafetyNetDto | null;
}

export interface DreamsOverviewDto {
  today: string;
  /** The Monday of this week. */
  weekStart: string;
  dreams: DreamDto[];
  habits: HabitDto[];
  /** Newest first, the last 12 weeks written. */
  reviews: WeeklyReviewDto[];
  /** Whether this week's review is written. */
  reviewedThisWeek: boolean;
  /** Whether each tool calls Claude now (a key and its Settings switch). */
  aiQuestions: boolean;
  aiSteps: boolean;
}

// ---------------------------------------------------------------------------
// The pace (shared by the service, its offline rules and the page)
// ---------------------------------------------------------------------------

const STRETCH_ORDER: Record<DreamStretch, number> = {
  tiny: 0,
  small: 1,
  brave: 2,
};
const PACE_REACH: Record<DreamPace, number> = {
  gentle: 0,
  steady: 1,
  bolder: 2,
};

export function stretchRank(stretch: DreamStretch): number {
  return STRETCH_ORDER[stretch];
}

/**
 * How far the next steps may reach. The pace you chose sets the start; the
 * latest check-in moves it: "smaller" or a step that felt too much brings it
 * down, "bigger" after a step that felt good lets it up by one, never past
 * "brave". Two uneasy check-ins in a row make the next round tiny and short,
 * and say so. Feelings are about the check-ins, newest first.
 */
export function dreamReach(
  pace: DreamPace,
  checkIns: readonly { feeling: number; nextPace: DreamNextPace }[],
): DreamReach {
  let level = PACE_REACH[pace];
  const [last, before] = checkIns;
  const heavy = !!last && last.feeling <= 2 && !!before && before.feeling <= 2;
  let reason = `Your pace is ${pace}.`;
  if (heavy) {
    level = 0;
    reason =
      'The last two steps felt heavy, so the next ones are tiny, and there are fewer of them. Resting is fine too.';
  } else if (last) {
    if (last.nextPace === 'smaller' || last.feeling === 1) {
      level = Math.max(0, level - 1);
      reason = 'You asked for smaller steps after the last one.';
      if (last.feeling === 1)
        reason =
          'The last step felt like too much, so the next ones are smaller.';
    } else if (last.nextPace === 'bigger' && last.feeling >= 3) {
      level = Math.min(2, level + 1);
      reason = 'The last step went well and you said you can go a bit further.';
    } else reason = `Your pace is ${pace}, and the last step felt about right.`;
  }
  const maxStretch = DREAM_STRETCHES[level]!;
  return {
    maxStretch,
    count: heavy || (last?.feeling ?? 3) <= 2 ? 2 : 3,
    reason,
    heavy,
  };
}
