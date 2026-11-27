import type {
  LearningPath,
  PathOutlineRequest,
  PathResource,
  StepKind,
  StudyTopic,
} from '@life-island/contracts';

/*
 * The path editor's draft: a path's card, stages and steps as plain fields
 * you can type into, and back. Resources are one per line,
 * "Label https://address", with "(paid)" for one that is not free.
 */

export interface StepDraft {
  /** Kept for a step that exists, so your progress on it stays. */
  id: string | null;
  title: string;
  kind: StepKind;
  hours: number;
  outcome: string;
  detail: string;
  resources: string;
}

export interface StageDraft {
  id: string | null;
  title: string;
  goal: string;
  steps: StepDraft[];
}

export interface PathDraft {
  name: string;
  emblem: string;
  topic: StudyTopic;
  summary: string;
  why: string;
  capstone: string;
  /** One per line. */
  certifications: string;
  stages: StageDraft[];
}

export function blankStep(): StepDraft {
  return {
    id: null,
    title: '',
    kind: 'learn',
    hours: 2,
    outcome: '',
    detail: '',
    resources: '',
  };
}

export function blankStage(): StageDraft {
  return { id: null, title: '', goal: '', steps: [blankStep()] };
}

export function blankDraft(): PathDraft {
  return {
    name: '',
    emblem: '📘',
    topic: 'other',
    summary: '',
    why: '',
    capstone: '',
    certifications: '',
    stages: [blankStage()],
  };
}

export function resourceLines(resources: readonly PathResource[]): string {
  return resources
    .map((r) =>
      [r.label, r.free ? null : '(paid)', r.url].filter(Boolean).join(' '),
    )
    .join('\n');
}

export function parseResources(text: string): PathResource[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const url = line.match(/https:\/\/\S+/)?.[0] ?? null;
      let label = url ? line.replace(url, ' ') : line;
      const paid = /\(paid\)/i.test(label);
      label = label
        .replace(/\(paid\)/gi, ' ')
        .replace(/[\s—–:|-]+$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
      return { label: label || url || 'Resource', url, free: !paid };
    });
}

export function pathDraft(path: LearningPath): PathDraft {
  return {
    name: path.name,
    emblem: path.emblem,
    topic: path.topic,
    summary: path.summary,
    why: path.why,
    capstone: path.capstone,
    certifications: path.certifications.join('\n'),
    stages: path.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      goal: stage.goal,
      steps: stage.steps.map((step) => ({
        id: step.id,
        title: step.title,
        kind: step.kind,
        hours: step.hours,
        outcome: step.outcome,
        detail: step.detail,
        resources: resourceLines(step.resources),
      })),
    })),
  };
}

/** The draft as svc-studies takes it; empty stages and steps are left out. */
export function draftOutline(draft: PathDraft): PathOutlineRequest {
  return {
    name: draft.name.trim(),
    emblem: draft.emblem.trim() || '📘',
    topic: draft.topic,
    summary: draft.summary.trim(),
    why: draft.why.trim(),
    capstone: draft.capstone.trim(),
    certifications: draft.certifications
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean),
    stages: draft.stages
      .map((stage) => ({
        id: stage.id,
        title: stage.title.trim(),
        goal: stage.goal.trim(),
        steps: stage.steps
          .filter((step) => step.title.trim())
          .map((step) => ({
            id: step.id,
            title: step.title.trim(),
            kind: step.kind,
            hours: Math.min(200, Math.max(0.5, Number(step.hours) || 1)),
            outcome: step.outcome.trim(),
            detail: step.detail.trim(),
            resources: parseResources(step.resources),
          })),
      }))
      .filter((stage) => stage.title && stage.steps.length),
  };
}

/** What stops the draft from being saved, in plain words; null when it can be. */
export function draftProblem(draft: PathDraft): string | null {
  if (!draft.name.trim()) return 'Give the path a name.';
  const outline = draftOutline(draft);
  if (!outline.stages.length)
    return 'Add at least one stage with a title and a step.';
  if (
    draft.stages.some(
      (s) => !s.title.trim() && s.steps.some((step) => step.title.trim()),
    )
  )
    return 'Every stage with steps needs a title.';
  return null;
}

/** Moves item `index` of a list by `by` places, if it can. */
export function moved<T>(list: readonly T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(to, 0, item);
  return copy;
}
