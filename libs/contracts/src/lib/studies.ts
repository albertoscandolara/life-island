import { z } from 'zod';
import {
  LEARNING_PATHS,
  STUDY_TOPICS,
  type StudyTopic,
} from './studies-paths.js';

/*
 * The Studies area (svc-studies, mfe-studies), run by Iggy: the training
 * platforms you use, one click away; learning paths for what you want to grow
 * in, with your progress step by step; the courses you take and the exams and
 * certifications you aim for, with what they cost; the time you study, week
 * by week, against a goal you set; and a study coach (AI tool
 * `studies.study-coach`) that plans your week from all of it.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const webUrl = z
  .string()
  .trim()
  .max(500)
  .refine((url) => /^https?:\/\/[^\s]+$/i.test(url), {
    message: 'Use a web address starting with https://',
  });
const money = z.number().min(0).max(100000);
const pathId = z
  .string()
  .refine((id) => LEARNING_PATHS.some((p) => p.id === id), 'Unknown path');

// ---------------------------------------------------------------------------
// Training platforms
// ---------------------------------------------------------------------------

/** How you pay a platform: nothing, a subscription, or course by course. */
export const PLATFORM_PLANS = ['free', 'subscription', 'per-course'] as const;
export type TrainingPlatformPlan = (typeof PLATFORM_PLANS)[number];
export const PLATFORM_PLAN_LABELS: Record<TrainingPlatformPlan, string> = {
  free: 'Free',
  subscription: 'Subscription',
  'per-course': 'Pay per course',
};

export const BILLING_PERIODS = ['month', 'year'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const TRAINING_PLATFORM_STATUSES = [
  'active',
  'paused',
  'closed',
] as const;
export type TrainingPlatformStatus =
  (typeof TRAINING_PLATFORM_STATUSES)[number];
export const TRAINING_PLATFORM_STATUS_LABELS: Record<
  TrainingPlatformStatus,
  string
> = {
  active: 'Using it',
  paused: 'Paused',
  closed: 'Closed',
};

export interface TrainingPlatformPreset {
  name: string;
  url: string;
  plan: TrainingPlatformPlan;
  topics: readonly StudyTopic[];
  /** One line on what it is good for. */
  note: string;
}

/** The main training platforms, offered when you add one, by topic. */
export const TRAINING_PLATFORM_PRESETS: readonly TrainingPlatformPreset[] = [
  {
    name: 'Anthropic Academy',
    url: 'https://anthropic.skilljar.com/',
    plan: 'free',
    topics: ['ai'],
    note: 'Free Claude courses: Claude Code, the API, MCP, AI Fluency.',
  },
  {
    name: 'Udemy',
    url: 'https://www.udemy.com/',
    plan: 'per-course',
    topics: ['ai', 'frameworks', 'infrastructure', 'leadership', '3d'],
    note: 'Every topic; buy courses on sale, check the reviews and the update date.',
  },
  {
    name: 'Coursera',
    url: 'https://www.coursera.org/',
    plan: 'subscription',
    topics: ['ai', 'infrastructure', 'leadership'],
    note: 'University and company programmes with certificates.',
  },
  {
    name: 'DeepLearning.AI',
    url: 'https://www.deeplearning.ai/',
    plan: 'free',
    topics: ['ai'],
    note: 'Short free courses on LLM apps, RAG and agents.',
  },
  {
    name: 'Hugging Face Learn',
    url: 'https://huggingface.co/learn',
    plan: 'free',
    topics: ['ai'],
    note: 'Free courses on models, agents and MCP.',
  },
  {
    name: 'Frontend Masters',
    url: 'https://frontendmasters.com/',
    plan: 'subscription',
    topics: ['frameworks', 'infrastructure'],
    note: 'Deep, expert-led courses on the front end and Node.',
  },
  {
    name: 'Pluralsight',
    url: 'https://www.pluralsight.com/',
    plan: 'subscription',
    topics: ['frameworks', 'infrastructure'],
    note: 'Skill paths and assessments for developers and cloud.',
  },
  {
    name: 'KodeKloud',
    url: 'https://kodekloud.com/',
    plan: 'subscription',
    topics: ['infrastructure'],
    note: 'Docker and Kubernetes with labs in the browser; CKA, CKAD, KCNA prep.',
  },
  {
    name: 'freeCodeCamp',
    url: 'https://www.freecodecamp.org/',
    plan: 'free',
    topics: ['frameworks', 'other'],
    note: 'Free certifications and long video courses.',
  },
  {
    name: 'LinkedIn Learning',
    url: 'https://www.linkedin.com/learning/',
    plan: 'subscription',
    topics: ['leadership', 'frameworks'],
    note: 'Short courses on management and soft skills.',
  },
  {
    name: "O'Reilly",
    url: 'https://www.oreilly.com/',
    plan: 'subscription',
    topics: ['leadership', 'infrastructure', 'frameworks'],
    note: 'The technical books library, including the leadership classics.',
  },
  {
    name: 'Three.js Journey',
    url: 'https://threejs-journey.com/',
    plan: 'per-course',
    topics: ['3d'],
    note: 'One course, from zero to advanced three.js.',
  },
  {
    name: 'Blender Studio',
    url: 'https://studio.blender.org/',
    plan: 'subscription',
    topics: ['3d'],
    note: 'Courses and production files from the Blender team.',
  },
  {
    name: 'egghead',
    url: 'https://egghead.io/',
    plan: 'subscription',
    topics: ['frameworks'],
    note: 'Short, focused lessons on React, TypeScript and tools.',
  },
];

export interface TrainingPlatformDto {
  id: string;
  name: string;
  url: string;
  /** The e-mail or username you signed up with. */
  account: string | null;
  plan: TrainingPlatformPlan;
  status: TrainingPlatformStatus;
  /** What a subscription costs per period, in euros. */
  price: number | null;
  billingPeriod: BillingPeriod | null;
  /** When the subscription renews (YYYY-MM-DD). */
  renewsOn: string | null;
  /** Its yearly cost while active: the subscription price over a year. */
  yearlyCost: number | null;
  topics: StudyTopic[];
  notes: string | null;
  /** When you last opened it from here. */
  lastOpenedAt: string | null;
  createdAt: string;
  /** Courses you track on it. */
  courses: number;
}

export const trainingPlatformRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: webUrl,
  account: z.string().trim().max(200).nullable().optional(),
  plan: z.enum(PLATFORM_PLANS).optional(),
  status: z.enum(TRAINING_PLATFORM_STATUSES).optional(),
  price: money.nullable().optional(),
  billingPeriod: z.enum(BILLING_PERIODS).nullable().optional(),
  renewsOn: isoDate.nullable().optional(),
  topics: z.array(z.enum(STUDY_TOPICS)).max(STUDY_TOPICS.length).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type TrainingPlatformRequest = z.input<
  typeof trainingPlatformRequestSchema
>;

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export const COURSE_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'dropped',
] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  dropped: 'Dropped',
};

export interface CourseDto {
  id: string;
  title: string;
  platformId: string | null;
  platformName: string | null;
  url: string | null;
  topic: StudyTopic;
  /** The path step this course covers, if any. */
  stepId: string | null;
  status: CourseStatus;
  /** 0 to 100. */
  progress: number;
  /** Length of the course, in hours. */
  hours: number | null;
  /** Hours you logged on it. */
  hoursLogged: number;
  cost: number | null;
  startedOn: string | null;
  completedOn: string | null;
  /** Where the certificate of completion is (a link). */
  certificateUrl: string | null;
  notes: string | null;
  createdAt: string;
}

export const courseRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  platformId: z.uuid().nullable().optional(),
  url: webUrl.nullable().optional(),
  topic: z.enum(STUDY_TOPICS).optional(),
  stepId: z.string().max(120).nullable().optional(),
  status: z.enum(COURSE_STATUSES).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  hours: z.number().min(0).max(1000).nullable().optional(),
  cost: money.nullable().optional(),
  startedOn: isoDate.nullable().optional(),
  completedOn: isoDate.nullable().optional(),
  certificateUrl: webUrl.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CourseRequest = z.input<typeof courseRequestSchema>;

// ---------------------------------------------------------------------------
// Exams and certifications
// ---------------------------------------------------------------------------

export const CERTIFICATION_STATUSES = [
  'planned',
  'booked',
  'passed',
  'failed',
] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];
export const CERTIFICATION_STATUS_LABELS: Record<CertificationStatus, string> =
  {
    planned: 'Planned',
    booked: 'Exam booked',
    passed: 'Passed',
    failed: 'Not passed',
  };

/** Certifications that fit the learning paths, offered when you add one. */
export const CERTIFICATION_PRESETS = [
  {
    name: 'KCNA, Kubernetes and Cloud Native Associate',
    provider: 'The Linux Foundation',
    topic: 'infrastructure',
    validYears: 2,
  },
  {
    name: 'CKAD, Certified Kubernetes Application Developer',
    provider: 'The Linux Foundation',
    topic: 'infrastructure',
    validYears: 2,
  },
  {
    name: 'Docker Certified Associate',
    provider: 'Docker',
    topic: 'infrastructure',
    validYears: 2,
  },
  {
    name: 'AWS Certified Cloud Practitioner',
    provider: 'Amazon Web Services',
    topic: 'infrastructure',
    validYears: 3,
  },
  {
    name: 'Terraform Associate',
    provider: 'HashiCorp',
    topic: 'infrastructure',
    validYears: 2,
  },
] as const satisfies readonly {
  name: string;
  provider: string;
  topic: StudyTopic;
  validYears: number;
}[];

export interface CertificationDto {
  id: string;
  name: string;
  provider: string | null;
  topic: StudyTopic;
  status: CertificationStatus;
  /** The exam date (YYYY-MM-DD). */
  examOn: string | null;
  cost: number | null;
  obtainedOn: string | null;
  expiresOn: string | null;
  credentialUrl: string | null;
  notes: string | null;
  createdAt: string;
}

export const certificationRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(120).nullable().optional(),
  topic: z.enum(STUDY_TOPICS).optional(),
  status: z.enum(CERTIFICATION_STATUSES).optional(),
  examOn: isoDate.nullable().optional(),
  cost: money.nullable().optional(),
  obtainedOn: isoDate.nullable().optional(),
  expiresOn: isoDate.nullable().optional(),
  credentialUrl: webUrl.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CertificationRequest = z.input<typeof certificationRequestSchema>;

// ---------------------------------------------------------------------------
// Study sessions
// ---------------------------------------------------------------------------

export interface StudySessionDto {
  id: string;
  date: string;
  minutes: number;
  topic: StudyTopic;
  pathId: string | null;
  stepId: string | null;
  courseId: string | null;
  note: string | null;
}

export const studySessionRequestSchema = z.object({
  date: isoDate,
  minutes: z
    .number()
    .int()
    .min(5)
    .max(16 * 60),
  topic: z.enum(STUDY_TOPICS).optional(),
  pathId: pathId.nullable().optional(),
  stepId: z.string().max(120).nullable().optional(),
  courseId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type StudySessionRequest = z.input<typeof studySessionRequestSchema>;

// ---------------------------------------------------------------------------
// Learning paths: your progress
// ---------------------------------------------------------------------------

export const PATH_STATUSES = ['following', 'paused'] as const;
export type PathStatus = (typeof PATH_STATUSES)[number];

export const STEP_STATUSES = ['todo', 'doing', 'done'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  todo: 'Not started',
  doing: 'Studying',
  done: 'Done',
};

export interface StepProgressDto {
  stepId: string;
  status: StepStatus;
  startedOn: string | null;
  doneOn: string | null;
  notes: string | null;
  /** Minutes logged on this step. */
  minutes: number;
}

export interface PathProgressDto {
  pathId: string;
  /** null: a path you have not started. */
  status: PathStatus | null;
  startedOn: string | null;
  /** The date you aim to finish by. */
  targetOn: string | null;
  steps: StepProgressDto[];
  doneSteps: number;
  totalSteps: number;
  /** Hours of the steps done, against the path's total. */
  hoursDone: number;
  hoursTotal: number;
  /** Minutes you logged on this path. */
  minutesLogged: number;
  /** The first step not done, in order. */
  nextStepId: string | null;
  /**
   * When you would finish at your pace (the last 8 weeks on this path, else
   * your weekly goal split over the paths you follow); null when done.
   */
  projectedOn: string | null;
  /** The target date is before the projection. */
  behind: boolean;
}

export const pathProgressRequestSchema = z.object({
  status: z.enum(PATH_STATUSES).nullable(),
  targetOn: isoDate.nullable().optional(),
});
export type PathProgressRequest = z.input<typeof pathProgressRequestSchema>;

export const stepProgressRequestSchema = z.object({
  status: z.enum(STEP_STATUSES),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type StepProgressRequest = z.input<typeof stepProgressRequestSchema>;

// ---------------------------------------------------------------------------
// Statistics and reminders
// ---------------------------------------------------------------------------

export interface StudyWeekDto {
  /** Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  minutes: number;
  byTopic: Partial<Record<StudyTopic, number>>;
  /** The weekly goal was reached. */
  goalMet: boolean;
}

export interface StudyStatsDto {
  weeklyGoalHours: number;
  /** Minutes this week, Monday to today. */
  weekMinutes: number;
  /** Weeks in a row the goal was met, this week included once it is met. */
  streakWeeks: number;
  /** The last 12 weeks, oldest first. */
  weeks: StudyWeekDto[];
  /** Average minutes per week over the last 8 full weeks. */
  averageWeekMinutes: number;
  /** Minutes per topic over the last 90 days. */
  topics: { topic: StudyTopic; minutes: number }[];
  totalHours: number;
  /** Days since your last session; null with none. */
  daysSinceLastSession: number | null;
  /** What you spent on studies this calendar year: courses, exams and subscriptions renewed. */
  spentThisYear: number;
  /** What your active subscriptions cost per year. */
  subscriptionsPerYear: number;
  coursesCompleted: number;
  coursesInProgress: number;
  certificationsPassed: number;
  stepsDone: number;
}

export type StudyReminderKind =
  'subscription' | 'exam' | 'certification' | 'idle' | 'target';

export interface StudyReminderDto {
  kind: StudyReminderKind;
  /** The platform, certification or path it is about. */
  refId: string | null;
  title: string;
  detail: string;
  date: string | null;
  /** Negative when past. */
  daysLeft: number | null;
  severity: 'danger' | 'warning' | 'info';
}

/** What needs you in Studies, for the island's badge (same shape as People). */
export interface StudiesAttentionDto {
  expired: number;
  expiring: number;
  toReview: number;
}

// ---------------------------------------------------------------------------
// Study coach (AI tool studies.study-coach)
// ---------------------------------------------------------------------------

export const studyPlanOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two or three sentences: where the studies stand this week'),
  focus: z
    .array(
      z.object({
        stepId: z
          .string()
          .describe('The id of a path step from the dossier, or empty'),
        title: z.string().describe('What to work on, verb first'),
        why: z.string().describe('Why this now, backed by the data'),
        hours: z.number().describe('Hours to give it this week'),
      }),
    )
    .describe('One to four things to focus on this week'),
  schedule: z
    .array(
      z.object({
        day: z.string().describe('A weekday, e.g. Monday'),
        minutes: z.number(),
        what: z.string(),
      }),
    )
    .describe('A realistic week, within the weekly goal'),
  tips: z.array(z.string()).describe('Up to three short tips'),
});
export type StudyPlanOutput = z.infer<typeof studyPlanOutputSchema>;

export interface StudyPlanDto {
  id: string;
  question: string | null;
  output: StudyPlanOutput;
  /** `claude`, or `offline` when Life Island's own rules wrote it. */
  source: 'claude' | 'offline';
  model: string | null;
  createdAt: string;
}

export const studyPlanRequestSchema = z.object({
  question: z.string().trim().max(1000).nullable().optional(),
  /** Hours you have this week; empty uses the weekly goal. */
  hours: z.number().min(0.5).max(60).nullable().optional(),
});
export type StudyPlanRequest = z.input<typeof studyPlanRequestSchema>;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface StudiesOverviewDto {
  platforms: TrainingPlatformDto[];
  courses: CourseDto[];
  certifications: CertificationDto[];
  /** Sessions of the last 90 days, newest first. */
  sessions: StudySessionDto[];
  paths: PathProgressDto[];
  stats: StudyStatsDto;
  reminders: StudyReminderDto[];
  plans: StudyPlanDto[];
  /** Whether the study coach calls Claude now (key and Settings switch). */
  aiCoach: boolean;
  /** The reminder windows from Settings, in days. */
  reminderDays: StudyReminderDays;
}

// ---------------------------------------------------------------------------
// Settings (APP_SETTINGS in settings.ts)
// ---------------------------------------------------------------------------

export const STUDY_WEEKLY_GOAL_SETTING = 'studies.weekly-goal-hours';
export const STUDY_IDLE_DAYS_SETTING = 'studies.idle-days';

export interface StudyReminderDays {
  subscription: number;
  exam: number;
  certification: number;
  idle: number;
}

export const STUDY_REMINDER_DEFAULTS: StudyReminderDays = {
  subscription: 14,
  exam: 30,
  certification: 60,
  idle: 7,
};

/** The settings key of a studies reminder window. */
export function studyReminderSettingKey(
  kind: Exclude<keyof StudyReminderDays, 'idle'>,
): string {
  return `studies.warn-days.${kind}`;
}
