import { z } from 'zod';
import { PATH_LEVELS, STUDY_TOPICS } from './studies-paths.js';

/*
 * The path builder of Studies (AI tool `studies.path-builder`): you name a
 * topic, where you start and where you want to get; it searches the web and
 * drafts a path in four levels (Foundations, Working, Professional, Expert),
 * each stage with steps, resources it actually saw and a checkpoint that
 * proves the level. The draft opens in the path editor: nothing is saved
 * until you add it.
 */

export const STUDY_PATH_BUILDER_TOOL = 'studies.path-builder';

/** Where you start on the topic. */
export const PATH_STARTS = ['new', 'some', 'daily'] as const;
export type PathStart = (typeof PATH_STARTS)[number];

export const PATH_START_LABELS: Record<PathStart, string> = {
  new: 'New to it',
  some: 'I know the basics',
  daily: 'I use it every day',
};

export const pathBuilderRequestSchema = z.object({
  /** "Angular", "Team leadership", "Rust for web services". */
  subject: z.string().trim().min(2).max(120),
  /** Where you want to get: "lead a team of five", "ship an AI feature". */
  goal: z.string().trim().max(300).nullable().optional(),
  start: z.enum(PATH_STARTS).default('some'),
  /** Hours a week you can give it, to size the steps. */
  hoursPerWeek: z.number().min(1).max(40).nullable().optional(),
});
export type PathBuilderRequest = z.input<typeof pathBuilderRequestSchema>;

/** What the model returns (structured output of the format step). */
export const pathBuilderOutputSchema = z.object({
  name: z.string(),
  emblem: z.string(),
  topic: z.enum(STUDY_TOPICS),
  summary: z.string(),
  why: z.string(),
  capstone: z.string(),
  certifications: z.array(z.string()),
  stages: z.array(
    z.object({
      title: z.string(),
      goal: z.string(),
      level: z.enum(PATH_LEVELS),
      checkpoint: z.string(),
      steps: z.array(
        z.object({
          title: z.string(),
          kind: z.enum(['learn', 'build', 'practice']),
          hours: z.number(),
          detail: z.string(),
          outcome: z.string(),
          resources: z.array(
            z.object({
              label: z.string(),
              url: z.string().nullable(),
              free: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type PathBuilderOutput = z.infer<typeof pathBuilderOutputSchema>;
