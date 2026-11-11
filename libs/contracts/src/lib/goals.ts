import { z } from 'zod';
import {
  lifeDate,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Goals & habits (Rex, svc-goals, mfe-goals): what you want to change, broken
 * into small steps with dates; the habits that get you there, checked off day
 * by day; a weekly review; and a coach that looks at where you are stuck and
 * names one small next step.
 */

export const GOAL_AREAS = [
  'health',
  'career',
  'money',
  'learning',
  'relationships',
  'home',
  'mind',
  'fun',
  'other',
] as const;
export type GoalArea = (typeof GOAL_AREAS)[number];
export const GOAL_AREA_LABELS: Record<GoalArea, string> = {
  health: 'Health and body',
  career: 'Career',
  money: 'Money',
  learning: 'Learning',
  relationships: 'People and relationships',
  home: 'Home',
  mind: 'Mind and calm',
  fun: 'Fun and hobbies',
  other: 'Other',
};

export const LIFE_GOAL_STATUSES = [
  'active',
  'paused',
  'done',
  'dropped',
] as const;
export type LifeGoalStatus = (typeof LIFE_GOAL_STATUSES)[number];
export const LIFE_GOAL_STATUS_LABELS: Record<LifeGoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Reached',
  dropped: 'Let go',
};

export const goalRequestSchema = z.object({
  title: lifeName(160),
  area: z.enum(GOAL_AREAS).optional(),
  /** Why it matters to you: read again when motivation dips. */
  why: lifeNote(1000),
  /** How you will know it is reached. */
  measure: lifeNote(300),
  targetDate: lifeOptionalDate,
  status: z.enum(LIFE_GOAL_STATUSES).optional(),
});
export type GoalRequest = z.input<typeof goalRequestSchema>;

export const goalStepRequestSchema = z.object({
  goalId: z.uuid(),
  title: lifeName(200),
  dueDate: lifeOptionalDate,
  done: z.boolean().optional(),
});
export type GoalStepRequest = z.input<typeof goalStepRequestSchema>;

export const HABIT_CADENCES = ['daily', 'weekly'] as const;
export type HabitCadence = (typeof HABIT_CADENCES)[number];

export const habitRequestSchema = z.object({
  title: lifeName(120),
  goalId: z.uuid().nullable().optional(),
  /** How many days a week you aim for (7 is every day). */
  perWeek: z.number().int().min(1).max(7).optional(),
  active: z.boolean().optional(),
});
export type HabitRequest = z.input<typeof habitRequestSchema>;

export const habitCheckRequestSchema = z.object({
  date: lifeDate,
  done: z.boolean(),
});
export type HabitCheckRequest = z.infer<typeof habitCheckRequestSchema>;

export const weeklyReviewRequestSchema = z.object({
  weekStart: lifeDate,
  /** 1 (rough) to 5 (great). */
  mood: z.number().int().min(1).max(5).nullable().optional(),
  wins: lifeNote(2000),
  stuck: lifeNote(2000),
  next: lifeNote(2000),
});
export type WeeklyReviewRequest = z.input<typeof weeklyReviewRequestSchema>;

export type GoalStepDto = LifeRecord<{
  goalId: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  doneOn: string | null;
}>;

export type LifeGoalDto = LifeRecord<{
  title: string;
  area: GoalArea;
  why: string | null;
  measure: string | null;
  targetDate: string | null;
  status: LifeGoalStatus;
}> & {
  steps: GoalStepDto[];
  /** Done steps over all steps, 0–100; null with no steps. */
  progress: number | null;
  nextStep: GoalStepDto | null;
  overdueSteps: number;
  /** Days since a step was last done (or since the goal was set). */
  idleDays: number;
  /** Active, with no step done for 14 days or no next step at all. */
  stuck: boolean;
  daysLeft: number | null;
};

export type HabitDto = LifeRecord<{
  title: string;
  goalId: string | null;
  perWeek: number;
  active: boolean;
}> & {
  /** The days checked in the last 28 days. */
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

export const goalsCoachOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two or three sentences: where the goals stand, honestly'),
  unstuck: z
    .array(
      z.object({
        goal: z.string().describe('The goal title, as written'),
        whyStuck: z
          .string()
          .describe('The likely reason it is not moving, from the data'),
        nextStep: z
          .string()
          .describe('One step small enough to do in under 30 minutes'),
      }),
    )
    .describe('Up to three stuck goals, the most important first'),
  focus: z
    .array(
      z.object({
        title: z.string().describe('What to do this week, verb first'),
        why: z.string(),
      }),
    )
    .describe('Up to three things to focus on this week'),
  encouragement: z
    .string()
    .describe('One or two warm, specific sentences about real progress'),
});
export type GoalsCoachOutput = z.infer<typeof goalsCoachOutputSchema>;
export type GoalsCoachDto = LifeAiAnswerDto<GoalsCoachOutput>;

export interface GoalsOverviewDto {
  today: string;
  weekStart: string;
  goals: LifeGoalDto[];
  habits: HabitDto[];
  reviews: WeeklyReviewDto[];
  /** Whether this week's review is written. */
  reviewedThisWeek: boolean;
  advice: GoalsCoachDto[];
  aiCoach: boolean;
}
