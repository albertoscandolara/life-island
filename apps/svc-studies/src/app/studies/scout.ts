import {
  pathSteps,
  scoutStepId,
  STEP_KIND_LABELS,
  STUDY_TOPIC_LABELS,
  type LearningPath,
  type OutlineChangeKind,
  type ScoutOutput,
  type ScoutResourceKind,
  type ScoutResourceStatus,
  type StepKind,
  type StepPace,
} from '@life-island/contracts';

/*
 * The resource scout (AI tool studies.resource-scout), without the I/O: what
 * it tells Claude, and how a scan's result becomes rows. resource-scout.ts
 * calls the model and writes them.
 */

export const SCOUT_RESEARCH = `You are the resource scout of a personal study app. One person, a software developer who studies on their own after work, follows the learning path below. Your job is to keep its resources current: in fast-moving fields, a video from two years ago or a tutorial for an old major version teaches things that are no longer true.

For every step listed under "Steps to scan", search the web and pick the 2 to 4 best resources to study that step today:
- Prefer official documentation, guides and release notes, the maintainers' or authors' own material, well-known courses, and talks by the people who build the tool. Avoid content farms, SEO listicles and paywalled news.
- Decide if the step is fast-moving (tools, frameworks, cloud services, AI models and APIs: what is true changes within a year or two) or evergreen (foundations, principles, leadership, maths, drawing: the best source can be old).
- For a fast-moving step, prefer material published or updated in the last 12 months that covers the current major version; name the version when it matters. For an evergreen step, a classic is fine when it is still the best.
- Use only addresses you saw in your search results. Never build or guess a URL.
- Never suggest an address listed under "Dismissed", and do not repeat the hand-picked or pinned resources.
- Mix kinds when you can (docs, a course or video, a hands-on repo), and say whether each one is free.

For every resource listed as "Pinned", check that it is still current. It is outdated only when it teaches an API, a version or a practice that has been replaced, or when the page is gone; say why in one line.

Outline: if, and only if, the field has clearly moved, propose at most two changes to the path: a step a beginner on this path now needs (in one of the scanned stages), or a scanned step whose subject is obsolete. Usually propose none.

Write your findings as notes, step by step (with the step id): for each resource its title, URL, kind, publication or update date when shown, free or paid, and in one line why it is the right one now. Then the pinned checks, then any outline change with its reason.`;

export const SCOUT_FORMAT = `Turn the resource scout's notes into the structured result. Use only what the notes say.
- steps: one entry per step id listed in the request, with its pace (fast or evergreen) and its resources. Copy each URL exactly. publishedOn is YYYY-MM or YYYY-MM-DD when the notes give a date, else null. kind is one of docs, article, video, course, book, repo, other. why is one short sentence.
- pinned: one entry per pinned URL listed in the request: outdated true or false, with the reason when outdated, else null.
- outline: only the changes the notes propose. stageId is one of the stage ids listed. For add-step give title, detail (two or three sentences), outcome (what you can do after it), stepKind (learn, build or practice), hours (a beginner's estimate) and stepId null. For retire-step give the stepId of the step to retire and null for the rest. reason is one sentence.`;

/** A resource already on file, as a scan sees it. */
export interface KnownResource {
  id: string;
  stepId: string;
  url: string;
  title: string;
  status: ScoutResourceStatus;
}

/** A change already proposed for the path, in any state. */
export interface KnownChange {
  kind: OutlineChangeKind;
  stepId: string;
  title: string | null;
}

export interface ScanScope {
  path: LearningPath;
  /** The stages to scan (stagesToScan). */
  stages: LearningPath['stages'][number][];
  /** What is on file for the path's steps. */
  known: KnownResource[];
  today: string;
}

/** The request for the research step: the path, the steps to scan and what is on file. */
export function scoutRequest(scope: ScanScope): string {
  const { path, stages, known } = scope;
  const scanned = new Set(stages.map((s) => s.id));
  const lines = [
    `Today: ${scope.today}`,
    `Path: ${path.name} (topic: ${STUDY_TOPIC_LABELS[path.topic]})`,
    path.summary,
    '',
    '# Steps to scan',
  ];
  for (const stage of stages) {
    lines.push(
      '',
      `## Stage "${stage.title}" (stage id: ${stage.id})`,
      `Goal: ${stage.goal}`,
    );
    for (const step of stage.steps) {
      lines.push(
        '',
        `### Step ${step.id}: ${step.title} (${STEP_KIND_LABELS[step.kind]}, about ${step.hours} h)`,
        step.detail,
        `Outcome: ${step.outcome}`,
      );
      const picked = step.resources.filter((r) => r.url);
      if (picked.length)
        lines.push(
          `Hand-picked: ${picked.map((r) => `${r.label} <${r.url}>`).join('; ')}`,
        );
      const pinned = known.filter(
        (r) => r.stepId === step.id && r.status === 'pinned',
      );
      if (pinned.length)
        lines.push(
          `Pinned: ${pinned.map((r) => `${r.title} <${r.url}>`).join('; ')}`,
        );
    }
  }
  const stepIds = new Set(
    stages.flatMap((s) => s.steps.map((step) => step.id)),
  );
  const dismissed = known.filter(
    (r) => r.status === 'dismissed' && stepIds.has(r.stepId),
  );
  if (dismissed.length)
    lines.push(
      '',
      '# Dismissed (never suggest)',
      ...dismissed.map((r) => r.url),
    );
  const others = path.stages.filter((s) => !scanned.has(s.id));
  if (others.length)
    lines.push(
      '',
      '# The other stages of the path (context only, do not scan)',
      ...others.map(
        (s) => `- ${s.title}: ${s.steps.map((step) => step.title).join(', ')}`,
      ),
    );
  return lines.join('\n');
}

export interface NewResource {
  pathId: string;
  stepId: string;
  url: string;
  title: string;
  kind: ScoutResourceKind;
  publishedOn: string | null;
  free: boolean;
  why: string;
}

export interface NewChange {
  pathId: string;
  kind: OutlineChangeKind;
  stageId: string;
  stepId: string;
  title: string | null;
  detail: string | null;
  outcome: string | null;
  stepKind: StepKind | null;
  hours: number | null;
  reason: string;
}

export interface ScanPlan {
  /** The steps scanned: their old suggestions go, these come. */
  stepIds: string[];
  suggestions: NewResource[];
  /** Pinned resources checked: the reason when outdated, else null. */
  checks: { id: string; outdated: string | null }[];
  paces: { stepId: string; pace: StepPace }[];
  changes: NewChange[];
}

const MAX_PER_STEP = 4;
const MAX_CHANGES = 2;

const clip = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** The address to compare by: no fragment, no trailing slash, lower-case host. */
export function sameUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

const isWebUrl = (url: string) => {
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
};

const datePattern = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * How a scan's result changes what is on file: new suggestions for the
 * scanned steps (never one you dismissed, pinned, or that is hand-picked),
 * the checks of your pinned resources, each step's pace, and outline changes
 * not proposed before. Anything the model returned outside the scope is
 * dropped.
 */
export function planScan(
  scope: ScanScope,
  output: ScoutOutput,
  changesOnFile: readonly KnownChange[],
): ScanPlan {
  const { path, stages, known } = scope;
  const steps = stages.flatMap((stage) => [...stage.steps]);
  const stepIds = steps.map((s) => s.id);
  const inScope = new Set(stepIds);

  const suggestions: NewResource[] = [];
  const paces: ScanPlan['paces'] = [];
  for (const entry of output.steps) {
    if (!inScope.has(entry.stepId)) continue;
    if (!paces.some((p) => p.stepId === entry.stepId))
      paces.push({ stepId: entry.stepId, pace: entry.pace });
    const step = steps.find((s) => s.id === entry.stepId)!;
    const taken = new Set([
      ...known
        .filter((r) => r.stepId === entry.stepId && r.status !== 'suggested')
        .map((r) => sameUrl(r.url)),
      ...step.resources.flatMap((r) => (r.url ? [sameUrl(r.url)] : [])),
    ]);
    let count = 0;
    for (const r of entry.resources) {
      if (count >= MAX_PER_STEP) break;
      if (!isWebUrl(r.url) || r.url.length > 500 || !r.title.trim()) continue;
      const key = sameUrl(r.url);
      if (taken.has(key)) continue;
      taken.add(key);
      suggestions.push({
        pathId: path.id,
        stepId: entry.stepId,
        url: r.url.trim(),
        title: clip(r.title, 200),
        kind: r.kind,
        publishedOn:
          r.publishedOn && datePattern.test(r.publishedOn.trim())
            ? r.publishedOn.trim()
            : null,
        free: r.free,
        why: clip(r.why, 300),
      });
      count++;
    }
  }

  const checks: ScanPlan['checks'] = [];
  for (const pinned of known.filter(
    (r) => r.status === 'pinned' && inScope.has(r.stepId),
  )) {
    const verdict = output.pinned.find(
      (p) => sameUrl(p.url) === sameUrl(pinned.url),
    );
    if (!verdict) continue;
    checks.push({
      id: pinned.id,
      outdated: verdict.outdated
        ? clip(verdict.reason || 'The scout found it outdated.', 300)
        : null,
    });
  }

  const stageIds = new Set(stages.map((s) => s.id));
  const allIds = new Set(pathSteps(path).map((s) => s.id));
  const titleKey = (t: string | null) =>
    (t ?? '').toLowerCase().replace(/\W+/g, ' ').trim();
  const changes: NewChange[] = [];
  for (const c of output.outline) {
    if (changes.length >= MAX_CHANGES) break;
    if (!stageIds.has(c.stageId) || !c.reason.trim()) continue;
    if (c.kind === 'retire-step') {
      if (!c.stepId || !inScope.has(c.stepId)) continue;
      if (
        changesOnFile.some(
          (k) => k.kind === 'retire-step' && k.stepId === c.stepId,
        ) ||
        changes.some((k) => k.kind === 'retire-step' && k.stepId === c.stepId)
      )
        continue;
      changes.push({
        pathId: path.id,
        kind: 'retire-step',
        stageId: c.stageId,
        stepId: c.stepId,
        title: null,
        detail: null,
        outcome: null,
        stepKind: null,
        hours: null,
        reason: clip(c.reason, 400),
      });
      continue;
    }
    if (!c.title?.trim()) continue;
    const title = clip(c.title, 120);
    if (
      [...changesOnFile, ...changes].some(
        (k) => k.kind === 'add-step' && titleKey(k.title) === titleKey(title),
      ) ||
      steps.some((s) => titleKey(s.title) === titleKey(title))
    )
      continue;
    const id = scoutStepId(
      path.id,
      c.stageId,
      title,
      new Set([
        ...allIds,
        ...changesOnFile.map((k) => k.stepId),
        ...changes.map((k) => k.stepId),
      ]),
    );
    changes.push({
      pathId: path.id,
      kind: 'add-step',
      stageId: c.stageId,
      stepId: id,
      title,
      detail: c.detail ? clip(c.detail, 1000) : null,
      outcome: c.outcome ? clip(c.outcome, 300) : null,
      stepKind: c.stepKind ?? 'learn',
      hours:
        c.hours !== null && Number.isFinite(c.hours)
          ? Math.min(40, Math.max(1, Math.round(c.hours)))
          : 2,
      reason: clip(c.reason, 400),
    });
  }

  return { stepIds, suggestions, checks, paces, changes };
}
