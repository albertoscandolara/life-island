import {
  learningPath,
  pathStep,
  type StudiesOverviewDto,
} from '@life-island/contracts';

/*
 * Up next, without the template: the next step of every path you follow
 * and every course in progress, each with the one resource to open first.
 */

export interface UpNextResource {
  label: string;
  url: string | null;
  /** Docs, Video… or null for a hand-picked one. */
  kind: string | null;
  free: boolean;
  /** pinned: you kept it. fresh: the scout's, not pinned yet. picked: the path's own. */
  source: 'pinned' | 'fresh' | 'picked';
}

export interface UpNextItem {
  key: string;
  emblem: string;
  /** "Agentic engineering · Coding agents every day · step 5 of 26". */
  context: string;
  title: string;
  /** What you can do once it is done, or the course's platform. */
  outcome: string;
  notes: string | null;
  studying: boolean;
  minutes: number;
  pathId: string | null;
  stepId: string | null;
  courseId: string | null;
  resource: UpNextResource | null;
  /** "done by 24 ott 2027", "behind your target". */
  behind: boolean;
  projectedOn: string | null;
}

export function upNext(data: StudiesOverviewDto): UpNextItem[] {
  const items: UpNextItem[] = [];
  for (const progress of data.paths) {
    if (progress.status !== 'following' || !progress.nextStepId) continue;
    const path = learningPath(progress.pathId, data.catalogue);
    const step = pathStep(progress.nextStepId, data.catalogue);
    if (!path || !step) continue;
    const stage = path.stages.find((s) =>
      s.steps.some((x) => x.id === step.id),
    );
    const index =
      path.stages.flatMap((s) => s.steps).findIndex((x) => x.id === step.id) +
      1;
    const mine = progress.steps.find((s) => s.stepId === step.id);
    const scouted = data.scout.resources.filter(
      (r) => r.stepId === step.id && !r.outdated,
    );
    const pinned = scouted.find((r) => r.status === 'pinned');
    const fresh = scouted.find((r) => r.status === 'suggested');
    const picked = step.resources[0];
    const resource: UpNextResource | null = pinned
      ? {
          label: pinned.title,
          url: pinned.url,
          kind: pinned.kind,
          free: pinned.free,
          source: 'pinned',
        }
      : picked
        ? {
            label: picked.label,
            url: picked.url,
            kind: null,
            free: picked.free,
            source: 'picked',
          }
        : fresh
          ? {
              label: fresh.title,
              url: fresh.url,
              kind: fresh.kind,
              free: fresh.free,
              source: 'fresh',
            }
          : null;
    items.push({
      key: `step:${step.id}`,
      emblem: path.emblem,
      context: [
        path.name,
        stage?.title,
        `step ${index} of ${progress.totalSteps}`,
      ]
        .filter(Boolean)
        .join(' · '),
      title: step.title,
      outcome: step.outcome,
      notes: mine?.notes ?? null,
      studying: mine?.status === 'doing',
      minutes: mine?.minutes ?? 0,
      pathId: path.id,
      stepId: step.id,
      courseId: null,
      resource,
      behind: progress.behind,
      projectedOn: progress.projectedOn,
    });
  }
  // What you are already studying first: finish before you start.
  items.sort((a, b) => Number(b.studying) - Number(a.studying));
  for (const course of data.courses) {
    if (course.status !== 'in_progress') continue;
    items.push({
      key: `course:${course.id}`,
      emblem: '🎓',
      context: ['Course', course.platformName, `${course.progress}% done`]
        .filter(Boolean)
        .join(' · '),
      title: course.title,
      outcome: course.hours
        ? `About ${course.hours} h, ${course.hoursLogged} h logged.`
        : `${course.hoursLogged} h logged.`,
      notes: course.notes,
      studying: true,
      minutes: Math.round(course.hoursLogged * 60),
      pathId: null,
      stepId: course.stepId,
      courseId: course.id,
      resource: course.url
        ? {
            label: course.platformName ?? 'Open the course',
            url: course.url,
            kind: 'course',
            free: !course.cost,
            source: 'picked',
          }
        : null,
      behind: false,
      projectedOn: null,
    });
  }
  return items;
}
