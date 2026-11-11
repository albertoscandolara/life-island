import { z } from 'zod';
import {
  lifeDate,
  lifeName,
  lifeNote,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Fitness (Galli, svc-fitness, mfe-fitness): the workouts you do against a
 * weekly target of active minutes, body measurements (weight, sleep, resting
 * heart rate) with their trend, the events you train for, and an AI coach
 * that writes your training week.
 */

export const WORKOUT_KINDS = [
  'walk',
  'run',
  'cycle',
  'swim',
  'gym',
  'yoga',
  'hike',
  'sport',
  'other',
] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];
export const WORKOUT_KIND_LABELS: Record<WorkoutKind, string> = {
  walk: 'Walk',
  run: 'Run',
  cycle: 'Bike',
  swim: 'Swim',
  gym: 'Gym and strength',
  yoga: 'Yoga and mobility',
  hike: 'Hike',
  sport: 'Team or racket sport',
  other: 'Other',
};

export const INTENSITIES = ['easy', 'moderate', 'hard'] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const INTENSITY_LABELS: Record<Intensity, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
};

export const workoutRequestSchema = z.object({
  date: lifeDate,
  kind: z.enum(WORKOUT_KINDS).optional(),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  distanceKm: z.number().min(0).max(1000).nullable().optional(),
  intensity: z.enum(INTENSITIES).optional(),
  notes: lifeNote(500),
});
export type WorkoutRequest = z.input<typeof workoutRequestSchema>;

export const measurementRequestSchema = z.object({
  date: lifeDate,
  weightKg: z.number().min(1).max(400).nullable().optional(),
  waistCm: z.number().min(10).max(300).nullable().optional(),
  restingHr: z.number().int().min(20).max(220).nullable().optional(),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  steps: z.number().int().min(0).max(200_000).nullable().optional(),
});
export type MeasurementRequest = z.input<typeof measurementRequestSchema>;

export const fitnessEventRequestSchema = z.object({
  name: lifeName(160),
  date: lifeDate,
  /** "10 km under 55 min", "finish". */
  target: lifeNote(200),
  done: z.boolean().optional(),
  result: lifeNote(200),
  notes: lifeNote(500),
});
export type FitnessEventRequest = z.input<typeof fitnessEventRequestSchema>;

export type WorkoutDto = LifeRecord<{
  date: string;
  kind: WorkoutKind;
  minutes: number;
  distanceKm: number | null;
  intensity: Intensity;
  notes: string | null;
}> & {
  /** Active minutes as the WHO counts them: moderate once, vigorous twice; easy ones count half here. */
  activeMinutes: number;
};

export type MeasurementDto = LifeRecord<{
  date: string;
  weightKg: number | null;
  waistCm: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  steps: number | null;
}>;

export type FitnessEventDto = LifeRecord<{
  name: string;
  date: string;
  target: string | null;
  done: boolean;
  result: string | null;
  notes: string | null;
}> & { daysToGo: number };

export interface FitnessWeekDto {
  weekStart: string;
  activeMinutes: number;
  workouts: number;
  byKind: Partial<Record<WorkoutKind, number>>;
}

export const trainingPlanOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two sentences: where your fitness stands this week'),
  days: z
    .array(
      z.object({
        day: z.string().describe('A weekday, e.g. Monday'),
        session: z.string().describe('What to do, or Rest'),
        minutes: z.number(),
        intensity: z.enum(INTENSITIES),
      }),
    )
    .describe('Seven days, Monday to Sunday'),
  tips: z.array(z.string()).describe('Up to three short, safe tips'),
});
export type TrainingPlanOutput = z.infer<typeof trainingPlanOutputSchema>;
export type TrainingPlanDto = LifeAiAnswerDto<TrainingPlanOutput>;

export interface FitnessOverviewDto {
  today: string;
  weekStart: string;
  goalMinutes: number;
  workouts: WorkoutDto[];
  measurements: MeasurementDto[];
  events: FitnessEventDto[];
  /** The last 12 weeks, oldest first. */
  weeks: FitnessWeekDto[];
  stats: {
    thisWeek: number;
    /** Weeks in a row at the goal, counting the last full week back. */
    streak: number;
    averageLast4: number;
    latestWeight: number | null;
    weightChange30: number | null;
    averageSleep7: number | null;
  };
  plans: TrainingPlanDto[];
  aiCoach: boolean;
}

export function activeMinutes(minutes: number, intensity: Intensity): number {
  if (intensity === 'hard') return minutes * 2;
  if (intensity === 'moderate') return minutes;
  return Math.round(minutes / 2);
}

/** Settings → Fitness: the weekly target of active minutes (150 for the WHO). */
export const FITNESS_WEEKLY_MINUTES_SETTING = 'fitness.weekly-minutes';
export const FITNESS_WEEKLY_MINUTES_DEFAULT = 150;
