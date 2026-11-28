import {
  applyOutlineChanges,
  freeId,
  LEARNING_PATHS,
  pathHours,
  pathSlug,
  pathSteps,
  type AcceptedOutlineChange,
  type LearningPath,
  type PathOutlineRequest,
  type PathStage,
  type PathStep,
  type PathTemplateDto,
  pathOutlineRequestSchema,
} from '@life-island/contracts';

/*
 * Your learning paths: the curated templates you added and the paths you
 * wrote or changed, with the outline changes you accepted from the scout.
 */

export interface StoredPath {
  id: string;
  topic: LearningPath['topic'];
  emblem: string;
  name: string;
  summary: string;
  why: string;
  capstone: string;
  certifications: string[];
  stages: PathStage[];
  updatedAt: Date;
}

export interface DecidedChange extends AcceptedOutlineChange {
  decidedAt: Date | null;
}

/**
 * The catalogue: every path you added (`yours`: the ids you follow, paused
 * or have progress on), templates first in their order, then your own by
 * when you wrote them. An accepted change counts only on top of the outline
 * it was accepted for: once you save the path again, it is part of it.
 */
export function yourCatalogue(input: {
  stored: readonly StoredPath[];
  yours: ReadonlySet<string>;
  changes: readonly DecidedChange[];
  templates?: readonly LearningPath[];
}): LearningPath[] {
  const templates = input.templates ?? LEARNING_PATHS;
  const stored = new Map(input.stored.map((p) => [p.id, p]));
  const base: LearningPath[] = [
    ...templates
      .filter((t) => stored.has(t.id) || input.yours.has(t.id))
      .map((t) => {
        const own = stored.get(t.id);
        return own ? { ...storedPath(own), level: t.level } : t;
      }),
    ...input.stored
      .filter((p) => !templates.some((t) => t.id === p.id))
      .map(storedPath),
  ];
  const changes = input.changes.filter((c) => {
    const own = stored.get(c.pathId);
    return !own || !c.decidedAt || c.decidedAt > own.updatedAt;
  });
  return applyOutlineChanges(changes, base);
}

function storedPath(row: StoredPath): LearningPath {
  return {
    id: row.id,
    topic: row.topic,
    emblem: row.emblem,
    name: row.name,
    summary: row.summary,
    why: row.why,
    capstone: row.capstone,
    certifications: row.certifications,
    stages: row.stages,
  };
}

/** The curated paths you have not added, for Add a topic. */
export function pathTemplates(
  catalogue: readonly LearningPath[],
  templates: readonly LearningPath[] = LEARNING_PATHS,
): PathTemplateDto[] {
  return templates
    .filter((t) => !catalogue.some((p) => p.id === t.id))
    .map((t) => ({
      id: t.id,
      topic: t.topic,
      emblem: t.emblem,
      name: t.name,
      summary: t.summary,
      stages: t.stages.length,
      steps: pathSteps(t).length,
      hours: pathHours(t),
    }));
}

/**
 * An outline you wrote, as a path with ids. A stage or step keeps the id it
 * came with when it belongs to this path (so your progress on it stays); a
 * new one gets a slug of its title, made unique within the path.
 */
export function outlinePath(
  id: string,
  outline: PathOutlineRequest,
): Omit<StoredPath, 'updatedAt'> {
  const parsed = pathOutlineRequestSchema.parse(outline);
  const stageIds = new Set<string>();
  const stepIds = new Set<string>();
  const stages: PathStage[] = parsed.stages.map((stage) => {
    const stageId = freeId(
      stage.id && /^[a-z0-9][a-z0-9-]{0,59}$/.test(stage.id)
        ? stage.id
        : pathSlug(stage.title, 'stage'),
      stageIds,
    );
    stageIds.add(stageId);
    const steps: PathStep[] = stage.steps.map((step) => {
      const own = step.id?.startsWith(`${id}.`) ? step.id : null;
      const stepId =
        own && !stepIds.has(own)
          ? own
          : freeId(`${id}.${stageId}.${pathSlug(step.title, 'step')}`, stepIds);
      stepIds.add(stepId);
      return {
        id: stepId,
        title: step.title,
        kind: step.kind,
        hours: step.hours,
        detail: step.detail,
        outcome: step.outcome,
        resources: step.resources,
      };
    });
    return {
      id: stageId,
      title: stage.title,
      goal: stage.goal,
      ...(stage.level ? { level: stage.level } : {}),
      ...(stage.checkpoint ? { checkpoint: stage.checkpoint } : {}),
      steps,
    };
  });
  return {
    id,
    topic: parsed.topic,
    emblem: parsed.emblem,
    name: parsed.name,
    summary: parsed.summary,
    why: parsed.why,
    capstone: parsed.capstone,
    certifications: parsed.certifications,
    stages,
  };
}
