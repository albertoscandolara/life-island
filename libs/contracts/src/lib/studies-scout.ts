import { z } from 'zod';
import {
  LEARNING_PATHS,
  type LearningPath,
  type PathStep,
  type StepKind,
  type StudyTopic,
} from './studies-paths.js';

/*
 * The resource scout of Studies (AI tool `studies.resource-scout`): it keeps
 * the resources of one learning path current. You pick the path in Settings
 * (one at a time, because every scan searches the web and costs money); the
 * scout scans the stage you are on and the next one when you pick it, then
 * every few months. Each scan:
 *
 * - suggests fresh resources for each step, which you pin or dismiss;
 * - checks the resources you pinned and flags the outdated ones;
 * - marks each step fast-moving or evergreen, so only fast-moving steps
 *   insist on recent sources;
 * - may propose a change to the path's outline (a step to add, one to
 *   retire), which changes nothing until you accept it.
 *
 * With the tool off, the hand-picked resources of LEARNING_PATHS stay, and so
 * does everything you pinned.
 */

export const STUDY_SCOUT_TOOL = 'studies.resource-scout';

/** The path the scout watches: one at a time, or `none`. */
export const STUDY_SCOUT_SUBJECT_SETTING = 'studies.scout-subject';
export const STUDY_SCOUT_NONE = 'none';
/** How often the scout scans: `auto`, or a number of months. */
export const STUDY_SCOUT_CADENCE_SETTING = 'studies.scout-cadence';
export const STUDY_SCOUT_CADENCES = ['auto', '1', '2', '3', '6', '12'] as const;
export type StudyScoutCadence = (typeof STUDY_SCOUT_CADENCES)[number];

/** Topics that change fast enough to scan every two months; the rest every six. */
export const FAST_MOVING_TOPICS: readonly StudyTopic[] = [
  'ai',
  'frameworks',
  'infrastructure',
];

/** Months between two scans of a path. */
export function scoutCadenceMonths(
  cadence: string,
  topic: StudyTopic | null,
): number {
  const months = Number(cadence);
  if (Number.isInteger(months) && months > 0) return months;
  return topic && FAST_MOVING_TOPICS.includes(topic) ? 2 : 6;
}

/** The date a scan is due: `months` after the last one (YYYY-MM-DD). */
export function nextScanOn(lastScanOn: string, months: number): string {
  const [y, m, d] = lastScanOn.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// What the scout keeps
// ---------------------------------------------------------------------------

export const STEP_PACES = ['fast', 'evergreen'] as const;
export type StepPace = (typeof STEP_PACES)[number];
export const STEP_PACE_LABELS: Record<StepPace, string> = {
  fast: 'Fast-moving',
  evergreen: 'Evergreen',
};

export const SCOUT_RESOURCE_KINDS = [
  'docs',
  'article',
  'video',
  'course',
  'book',
  'repo',
  'other',
] as const;
export type ScoutResourceKind = (typeof SCOUT_RESOURCE_KINDS)[number];
export const SCOUT_RESOURCE_KIND_LABELS: Record<ScoutResourceKind, string> = {
  docs: 'Docs',
  article: 'Article',
  video: 'Video',
  course: 'Course',
  book: 'Book',
  repo: 'Repository',
  other: 'Link',
};

/** suggested: new from a scan. pinned: you keep it. dismissed: never again. */
export const SCOUT_RESOURCE_STATUSES = [
  'suggested',
  'pinned',
  'dismissed',
] as const;
export type ScoutResourceStatus = (typeof SCOUT_RESOURCE_STATUSES)[number];

export interface ScoutResourceDto {
  id: string;
  pathId: string;
  stepId: string;
  title: string;
  url: string;
  kind: ScoutResourceKind;
  /** YYYY-MM or YYYY-MM-DD, when the source says. */
  publishedOn: string | null;
  free: boolean;
  /** Why the scout picked it, in one line. */
  why: string;
  status: Exclude<ScoutResourceStatus, 'dismissed'>;
  /** Set on a pinned resource the last scan found outdated: why. */
  outdated: string | null;
  foundAt: string;
}

export const OUTLINE_CHANGE_KINDS = ['add-step', 'retire-step'] as const;
export type OutlineChangeKind = (typeof OUTLINE_CHANGE_KINDS)[number];
export const OUTLINE_DECISIONS = ['accepted', 'declined'] as const;
export type OutlineDecision = (typeof OUTLINE_DECISIONS)[number];

/** A change to a path's outline the scout proposes; nothing changes until you accept. */
export interface OutlineChangeDto {
  id: string;
  pathId: string;
  kind: OutlineChangeKind;
  stageId: string;
  /** The step to retire, or the id the new step gets. */
  stepId: string;
  /** The new step (add-step); null for a retirement. */
  title: string | null;
  detail: string | null;
  outcome: string | null;
  stepKind: StepKind | null;
  hours: number | null;
  reason: string;
  status: 'proposed' | OutlineDecision;
  createdAt: string;
}

export type ScoutScanReason = 'subject' | 'schedule' | 'manual';
export type ScoutScanStatus = 'running' | 'done' | 'error';

export interface ScoutScanDto {
  id: string;
  pathId: string;
  reason: ScoutScanReason;
  status: ScoutScanStatus;
  /** The steps it scanned. */
  stepIds: string[];
  found: number;
  flagged: number;
  proposed: number;
  error: string | null;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The scout's part of the Studies overview. */
export interface StudyScoutDto {
  /** The path under watch, or null. */
  subject: string | null;
  cadence: StudyScoutCadence;
  /** Months between scans of the subject. */
  cadenceMonths: number;
  /** Whether a scan can call Claude now (key and Settings switches). */
  ai: boolean;
  /** The latest scan of any path. */
  lastScan: ScoutScanDto | null;
  /** When the subject is next scanned (YYYY-MM-DD); null with no subject. */
  nextScanOn: string | null;
  /** Every resource found and not dismissed, of every path. */
  resources: ScoutResourceDto[];
  /** Proposed outline changes, waiting for you. */
  proposals: OutlineChangeDto[];
  /** Fast-moving or evergreen, per step the scout has scanned. */
  paces: Record<string, StepPace>;
}

export const scoutResourceRequestSchema = z.object({
  status: z.enum(['pinned', 'dismissed']),
});
export type ScoutResourceRequest = z.input<typeof scoutResourceRequestSchema>;

export const outlineDecisionRequestSchema = z.object({
  decision: z.enum(OUTLINE_DECISIONS),
});
export type OutlineDecisionRequest = z.input<
  typeof outlineDecisionRequestSchema
>;

// ---------------------------------------------------------------------------
// What the model returns (structured output of the format step)
// ---------------------------------------------------------------------------

export const scoutOutputSchema = z.object({
  steps: z.array(
    z.object({
      stepId: z.string(),
      pace: z.enum(STEP_PACES),
      resources: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          kind: z.enum(SCOUT_RESOURCE_KINDS),
          publishedOn: z.string().nullable(),
          free: z.boolean(),
          why: z.string(),
        }),
      ),
    }),
  ),
  pinned: z.array(
    z.object({
      url: z.string(),
      outdated: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  outline: z.array(
    z.object({
      kind: z.enum(OUTLINE_CHANGE_KINDS),
      stageId: z.string(),
      stepId: z.string().nullable(),
      title: z.string().nullable(),
      detail: z.string().nullable(),
      outcome: z.string().nullable(),
      stepKind: z.enum(['learn', 'build', 'practice']).nullable(),
      hours: z.number().nullable(),
      reason: z.string(),
    }),
  ),
});
export type ScoutOutput = z.infer<typeof scoutOutputSchema>;

// ---------------------------------------------------------------------------
// The paths with the outline changes you accepted
// ---------------------------------------------------------------------------

/** An accepted outline change, as the catalogue applies it. */
export type AcceptedOutlineChange = Pick<
  OutlineChangeDto,
  | 'pathId'
  | 'kind'
  | 'stageId'
  | 'stepId'
  | 'title'
  | 'detail'
  | 'outcome'
  | 'stepKind'
  | 'hours'
>;

/**
 * The learning paths as you study them: LEARNING_PATHS, with the steps you
 * accepted added at the end of their stage and the ones you retired left
 * out. Your progress stays keyed by step id, so a retired step's progress
 * is kept, only no longer counted.
 */
export function applyOutlineChanges(
  changes: readonly AcceptedOutlineChange[],
  base: readonly LearningPath[] = LEARNING_PATHS,
): LearningPath[] {
  if (!changes.length) return [...base];
  return base.map((path) => {
    const mine = changes.filter((c) => c.pathId === path.id);
    if (!mine.length) return path;
    const retired = new Set(
      mine.filter((c) => c.kind === 'retire-step').map((c) => c.stepId),
    );
    return {
      ...path,
      stages: path.stages.map((stage) => {
        const added: PathStep[] = mine
          .filter((c) => c.kind === 'add-step' && c.stageId === stage.id)
          .map((c) => ({
            id: c.stepId,
            title: c.title ?? 'New step',
            kind: c.stepKind ?? 'learn',
            hours: c.hours ?? 2,
            detail: c.detail ?? '',
            outcome: c.outcome ?? '',
            resources: [],
          }));
        return {
          ...stage,
          steps: [...stage.steps, ...added].filter((s) => !retired.has(s.id)),
        };
      }),
    };
  });
}

/**
 * The stages a scan covers: the one with your next step and the one after
 * (the first two of a path you have not started). Resources for a stage
 * months away would be stale by the time you reach it.
 */
export function stagesToScan(
  path: LearningPath,
  done: ReadonlySet<string>,
): LearningPath['stages'][number][] {
  const current = path.stages.findIndex((stage) =>
    stage.steps.some((step) => !done.has(step.id)),
  );
  if (current < 0) return path.stages.slice(-1);
  return path.stages.slice(current, current + 2);
}

/** The id a step added by the scout gets: `<path>.<stage>.scout-<slug>`. */
export function scoutStepId(
  pathId: string,
  stageId: string,
  title: string,
  taken: ReadonlySet<string>,
): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'step';
  const base = `${pathId}.${stageId}.scout-${slug}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
