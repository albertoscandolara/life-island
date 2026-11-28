import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  readSettings,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  AiAssistant,
  describeAiSteps,
  type AiAssistantStep,
} from '@life-island/be-nest';
import {
  learningPath,
  scoutOutputSchema,
  stagesToScan,
  STUDY_SCOUT_CADENCE_SETTING,
  STUDY_SCOUT_CADENCES,
  STUDY_SCOUT_BUDGET_DEFAULT,
  STUDY_SCOUT_BUDGET_SETTING,
  STUDY_SCOUT_TOOL,
  type LearningPath,
  type OutlineChangeDto,
  type OutlineDecision,
  type ScoutOutput,
  type ScoutResourceDto,
  type ScoutScanDto,
  type ScoutScanReason,
  type ScoutWatchDto,
  type StepPace,
  type StudyScoutCadence,
  type StudyScoutDto,
} from '@life-island/contracts';
import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type StudiesConfig } from '../config.js';
import { yourCatalogue } from './paths.js';
import { monthStart, nextToScan, scoutWatches } from './scout-watch.js';
import {
  learningPaths,
  outlineChanges,
  pathProgress,
  scoutResources,
  scoutScans,
  scoutSteps,
  stepProgress,
  type OutlineChangeRow,
  type ScoutResourceRow,
  type ScoutScanRow,
} from '../db/schema.js';
import {
  planScan,
  SCOUT_FORMAT,
  SCOUT_RESEARCH,
  scoutRequest,
  type ScanScope,
} from './scout.js';

const SERVICE = 'svc-studies';
/** How often the scheduler looks whether a scan is due. */
const TICK_MS = 5 * 60_000;
/** A scan still "running" after this long was cut off (a restart). */
const STALE_MS = 30 * 60_000;
/** After a failed scan, the scheduler waits this long before trying again. */
const RETRY_AFTER_MS = 12 * 3600_000;

/**
 * The resource scout (AI tool studies.resource-scout): keeps the resources
 * of the one path you picked in Settings current. It scans the stage you
 * are on and the next one, when you pick the path and then every few months
 * (or when you press Refresh now), with the Claude API and web search.
 */
@Injectable()
export class ResourceScout implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ResourceScout.name);
  private readonly ai: AiAssistant;
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: StudiesConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: STUDY_SCOUT_TOOL,
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.coachModel,
      svc,
    });
  }

  private get db() {
    return this.svc.db;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([RESEARCH_STEP, FORMAT_STEP]);
    if (!this.config.scoutSchedule) return;
    const tick = () =>
      void this.tick().catch((error: unknown) =>
        this.logger.warn(`Resource scout check failed: ${String(error)}`),
      );
    this.first = setTimeout(tick, 30_000);
    this.timer = setInterval(tick, TICK_MS);
    this.first.unref();
    this.timer.unref();
  }

  /** Looks whether a scan is due in a few seconds (a setting just changed). */
  soon(): void {
    if (!this.config.scoutSchedule) return;
    setTimeout(
      () =>
        void this.tick().catch((error: unknown) =>
          this.logger.warn(`Resource scout check failed: ${String(error)}`),
        ),
      3000,
    ).unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** Whether a scan can call Claude now: a key, and the switches in Settings. */
  usesAi(): Promise<boolean> {
    return this.ai.active();
  }

  /** How often, and the most scans a month, from the settings replica. */
  async settings(): Promise<{
    cadence: StudyScoutCadence;
    monthlyScans: number;
  }> {
    const values = await readSettings(this.svc.pool, this.svc.schema, [
      STUDY_SCOUT_CADENCE_SETTING,
      STUDY_SCOUT_BUDGET_SETTING,
    ]).catch(() => new Map<string, unknown>());
    const cadence = values.get(STUDY_SCOUT_CADENCE_SETTING);
    const budget = Number(values.get(STUDY_SCOUT_BUDGET_SETTING));
    return {
      cadence: STUDY_SCOUT_CADENCES.includes(cadence as StudyScoutCadence)
        ? (cadence as StudyScoutCadence)
        : 'auto',
      monthlyScans:
        Number.isInteger(budget) && budget >= 1 && budget <= 50
          ? budget
          : STUDY_SCOUT_BUDGET_DEFAULT,
    };
  }

  /** Every path you follow with when it is next scanned, and the month's scans. */
  async watches(
    catalogue: readonly LearningPath[],
    today: string,
    now = new Date(),
  ): Promise<{
    watched: ScoutWatchDto[];
    cadence: StudyScoutCadence;
    monthlyScans: number;
    scansThisMonth: number;
  }> {
    const [settings, rows, scans, [month]] = await Promise.all([
      this.settings(),
      this.db.select().from(pathProgress),
      this.db
        .selectDistinctOn([scoutScans.pathId, scoutScans.status])
        .from(scoutScans)
        .orderBy(
          scoutScans.pathId,
          scoutScans.status,
          desc(scoutScans.startedAt),
        ),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(scoutScans)
        .where(
          and(
            gte(scoutScans.startedAt, monthStart(now)),
            ne(scoutScans.status, 'error'),
          ),
        ),
    ]);
    const lastDone = new Map<string, string>();
    const latest = new Map<string, ScoutScanDto>();
    for (const row of scans) {
      if (row.status === 'done')
        lastDone.set(row.pathId, row.startedAt.toISOString());
      const known = latest.get(row.pathId);
      if (!known || known.startedAt < row.startedAt.toISOString())
        latest.set(row.pathId, scanDto(row));
    }
    return {
      watched: scoutWatches({
        catalogue,
        rows,
        lastDone,
        latest,
        cadence: settings.cadence,
        today,
      }),
      cadence: settings.cadence,
      monthlyScans: settings.monthlyScans,
      scansThisMonth: month?.n ?? 0,
    };
  }

  /**
   * Your learning paths (the templates you added and the paths you wrote or
   * changed) with the outline changes you accepted.
   */
  async catalogue(): Promise<LearningPath[]> {
    const [stored, followed, started, accepted] = await Promise.all([
      this.db.select().from(learningPaths).orderBy(learningPaths.createdAt),
      this.db.select({ id: pathProgress.pathId }).from(pathProgress),
      this.db.selectDistinct({ id: stepProgress.pathId }).from(stepProgress),
      this.db
        .select()
        .from(outlineChanges)
        .where(eq(outlineChanges.status, 'accepted'))
        .orderBy(outlineChanges.decidedAt),
    ]);
    return yourCatalogue({
      stored,
      yours: new Set([...followed, ...started].map((r) => r.id)),
      changes: accepted.map((row) => ({
        ...changeDto(row),
        decidedAt: row.decidedAt,
      })),
    });
  }

  /** The scout's part of the overview. */
  async status(
    catalogue: readonly LearningPath[],
    today: string,
  ): Promise<StudyScoutDto> {
    const [watch, ai, resourceRows, proposalRows, paceRows, [last]] =
      await Promise.all([
        this.watches(catalogue, today),
        this.usesAi(),
        this.db
          .select()
          .from(scoutResources)
          .where(ne(scoutResources.status, 'dismissed'))
          .orderBy(desc(scoutResources.foundAt)),
        this.db
          .select()
          .from(outlineChanges)
          .where(eq(outlineChanges.status, 'proposed'))
          .orderBy(outlineChanges.createdAt),
        this.db.select().from(scoutSteps),
        this.db
          .select()
          .from(scoutScans)
          .orderBy(desc(scoutScans.startedAt))
          .limit(1),
      ]);
    const yours = new Set(catalogue.map((p) => p.id));
    return {
      ...watch,
      ai,
      lastScan: last ? scanDto(last) : null,
      // What the scout found for a path you removed waits until you add it again.
      resources: resourceRows
        .filter((r) => yours.has(r.pathId))
        .map(resourceDto),
      proposals: proposalRows.filter((c) => yours.has(c.pathId)).map(changeDto),
      paces: Object.fromEntries(
        paceRows.map((row) => [row.stepId, row.pace]),
      ) as Record<string, StepPace>,
    };
  }

  // ---- scheduling ----------------------------------------------------------

  /**
   * Starts a scan when one is due: the watched path you follow whose scan is
   * due longest ago (a path never scanned is due at once), while the month
   * has scans left. One at a time; the next tick starts the next.
   */
  async tick(now = new Date()): Promise<string | null> {
    await this.db
      .update(scoutScans)
      .set({
        status: 'error',
        error: 'The scan was cut off (svc-studies restarted).',
        finishedAt: now,
      })
      .where(
        and(
          eq(scoutScans.status, 'running'),
          lt(scoutScans.startedAt, new Date(now.getTime() - STALE_MS)),
        ),
      );
    if (this.running || !(await this.usesAi())) return null;
    const watch = await this.watches(
      await this.catalogue(),
      now.toISOString().slice(0, 10),
      now,
    );
    const pathId = nextToScan({
      ...watch,
      watches: watch.watched,
      now,
      retryMs: RETRY_AFTER_MS,
    });
    if (!pathId) return null;
    const scanned = watch.watched.find((w) => w.pathId === pathId)?.lastScan;
    return this.start(pathId, scanned ? 'schedule' : 'subject');
  }

  /** Refresh now: scans one path you follow at once, within the month's scans. */
  async refresh(pathId: string, now = new Date()): Promise<{ id: string }> {
    const catalogue = await this.catalogue();
    if (!learningPath(pathId, catalogue))
      throw new NotFoundException('Path not found');
    if (!this.ai.configured)
      throw new ServiceUnavailableException(
        'The resource scout searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-studies.',
      );
    if (!(await this.usesAi()))
      throw new ServiceUnavailableException(
        'The resource scout is turned off in Settings → AI tools. Turn it on there to scan.',
      );
    if (this.running) throw new ConflictException('A scan is already running.');
    const watch = await this.watches(
      catalogue,
      now.toISOString().slice(0, 10),
      now,
    );
    if (watch.scansThisMonth >= watch.monthlyScans)
      throw new ConflictException(
        `This month's ${watch.monthlyScans} scans are used. Raise the number in Settings → App settings → Studies, or wait for next month.`,
      );
    return { id: await this.start(pathId, 'manual') };
  }

  /** Records the scan as running and runs it in the background. */
  private async start(
    pathId: string,
    reason: ScoutScanReason,
  ): Promise<string> {
    this.running = true;
    try {
      const [row] = await this.db
        .insert(scoutScans)
        .values({ pathId, reason, status: 'running' })
        .returning({ id: scoutScans.id });
      void this.scan(row.id, pathId).finally(() => {
        this.running = false;
      });
      return row.id;
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  // ---- the scan ------------------------------------------------------------

  private async scan(scanId: string, pathId: string): Promise<void> {
    try {
      const catalogue = await this.catalogue();
      // The path exists: the scan was started for it.
      const path = learningPath(pathId, catalogue) as LearningPath;
      const scope = await this.scope(path);
      const request = scoutRequest(scope);
      const { output, model } = await this.ai.research({
        research: { step: RESEARCH_STEP, user: request, maxSearches: 12 },
        format: {
          step: FORMAT_STEP,
          user: (notes) => `${request}\n\n<notes>\n${notes}\n</notes>`,
          output: scoutOutputSchema,
        },
      });
      const result = await this.save(scanId, scope, output);
      await this.db
        .update(scoutScans)
        .set({ status: 'done', ...result, model, finishedAt: new Date() })
        .where(eq(scoutScans.id, scanId));
    } catch (error) {
      this.logger.error(`Resource scan failed: ${String(error)}`);
      await this.db
        .update(scoutScans)
        .set({
          status: 'error',
          error:
            error instanceof ServiceUnavailableException
              ? error.message
              : 'The scan could not finish. Try again later.',
          finishedAt: new Date(),
        })
        .where(eq(scoutScans.id, scanId))
        .catch(() => undefined);
    }
  }

  /** The stages to scan and what is on file for the path. */
  async scope(
    path: LearningPath,
    today = new Date().toISOString().slice(0, 10),
  ): Promise<ScanScope> {
    const [doneRows, known] = await Promise.all([
      this.db
        .select({ stepId: stepProgress.stepId })
        .from(stepProgress)
        .where(
          and(
            eq(stepProgress.pathId, path.id),
            eq(stepProgress.status, 'done'),
          ),
        ),
      this.db
        .select()
        .from(scoutResources)
        .where(eq(scoutResources.pathId, path.id)),
    ]);
    const done = new Set(doneRows.map((r) => r.stepId));
    return { path, stages: stagesToScan(path, done), known, today };
  }

  /** Writes what a scan found; returns its counts. */
  async save(
    scanId: string,
    scope: ScanScope,
    output: ScoutOutput,
  ): Promise<{
    stepIds: string[];
    found: number;
    flagged: number;
    proposed: number;
  }> {
    const onFile = await this.db
      .select({
        kind: outlineChanges.kind,
        stepId: outlineChanges.stepId,
        title: outlineChanges.title,
      })
      .from(outlineChanges)
      .where(eq(outlineChanges.pathId, scope.path.id));
    const plan = planScan(scope, output, onFile);
    const alive = await Promise.all(
      plan.suggestions.map((r) => this.linkAlive(r.url)),
    );
    const suggestions = plan.suggestions.filter((_, i) => alive[i]);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      if (plan.stepIds.length)
        await tx
          .delete(scoutResources)
          .where(
            and(
              eq(scoutResources.status, 'suggested'),
              inArray(scoutResources.stepId, plan.stepIds),
            ),
          );
      if (suggestions.length)
        await tx
          .insert(scoutResources)
          .values(
            suggestions.map((r) => ({
              ...r,
              status: 'suggested' as const,
              scanId,
            })),
          )
          .onConflictDoNothing();
      for (const check of plan.checks)
        await tx
          .update(scoutResources)
          .set({ outdated: check.outdated })
          .where(eq(scoutResources.id, check.id));
      for (const pace of plan.paces)
        await tx
          .insert(scoutSteps)
          .values({ ...pace, pathId: scope.path.id, scannedAt: now })
          .onConflictDoUpdate({
            target: scoutSteps.stepId,
            set: { pace: pace.pace, scannedAt: now },
          });
      if (plan.changes.length)
        await tx
          .insert(outlineChanges)
          .values(plan.changes.map((c) => ({ ...c, scanId })));
    });
    return {
      stepIds: plan.stepIds,
      found: suggestions.length,
      flagged: plan.checks.filter((c) => c.outdated).length,
      proposed: plan.changes.length,
    };
  }

  /**
   * False only for a page that is surely gone (404, 410, or no such host);
   * a site that refuses robots, or a slow one, keeps the benefit of the doubt.
   */
  async linkAlive(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'LifeIsland-ResourceScout/1.0' },
      });
      void response.body?.cancel().catch(() => undefined);
      return response.status !== 404 && response.status !== 410;
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      return code !== 'ENOTFOUND';
    }
  }

  // ---- your decisions ------------------------------------------------------

  /** Pin a resource (also: keep a flagged one), or dismiss it for good. */
  async decideResource(
    id: string,
    status: 'pinned' | 'dismissed',
  ): Promise<void> {
    const updated = await this.db
      .update(scoutResources)
      .set({ status, outdated: null, decidedAt: new Date() })
      .where(eq(scoutResources.id, id))
      .returning({ id: scoutResources.id });
    if (!updated.length) throw new NotFoundException('Resource not found');
  }

  /** Accept or decline an outline change; an accepted step joins its stage. */
  async decideChange(id: string, decision: OutlineDecision): Promise<void> {
    const [row] = await this.db
      .select()
      .from(outlineChanges)
      .where(eq(outlineChanges.id, id));
    if (!row) throw new NotFoundException('Outline change not found');
    if (row.status !== 'proposed')
      throw new ConflictException('This change was already decided.');
    await this.db
      .update(outlineChanges)
      .set({ status: decision, decidedAt: new Date() })
      .where(eq(outlineChanges.id, id));
  }
}

export function resourceDto(row: ScoutResourceRow): ScoutResourceDto {
  return {
    id: row.id,
    pathId: row.pathId,
    stepId: row.stepId,
    title: row.title,
    url: row.url,
    kind: row.kind,
    publishedOn: row.publishedOn,
    free: row.free,
    why: row.why,
    status: row.status === 'pinned' ? 'pinned' : 'suggested',
    outdated: row.status === 'pinned' ? row.outdated : null,
    foundAt: row.foundAt.toISOString(),
  };
}

export function changeDto(row: OutlineChangeRow): OutlineChangeDto {
  return {
    id: row.id,
    pathId: row.pathId,
    kind: row.kind,
    stageId: row.stageId,
    stepId: row.stepId,
    title: row.title,
    detail: row.detail,
    outcome: row.outcome,
    stepKind: row.stepKind,
    hours: row.hours,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function scanDto(row: ScoutScanRow): ScoutScanDto {
  return {
    id: row.id,
    pathId: row.pathId,
    reason: row.reason,
    status: row.status,
    stepIds: row.stepIds,
    found: row.found,
    flagged: row.flagged,
    proposed: row.proposed,
    error: row.error,
    model: row.model,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** The scout's two requests: a web search, then its notes structured. */
const RESEARCH_STEP: AiAssistantStep = {
  stepId: 'research',
  label: 'Search the web',
  system: SCOUT_RESEARCH,
  userTemplate:
    'Today: {date}\nPath: {name} (topic: {topic})\n{summary}\n\n# Steps to scan\n{for the stage with your next step and the one after: each step with its detail, outcome, hand-picked and pinned resources}\n\n# Dismissed (never suggest)\n{the addresses you dismissed}\n\n# The other stages of the path (context only)\n{titles}',
  outputFormat: null,
  effort: 'medium',
  maxTokens: 16000,
  tools: ['web_search (up to 12 searches)'],
};

const FORMAT_STEP: AiAssistantStep = {
  stepId: 'format',
  label: 'Structure the findings',
  system: SCOUT_FORMAT,
  userTemplate: '{the same request}\n\n<notes>\n{the research notes}\n</notes>',
  outputFormat: 'scoutOutput',
  effort: 'low',
  maxTokens: 16000,
};

/** How the scout calls the model, as the info button in Settings shows it. */
export function describeScoutTool(
  config: Pick<StudiesConfig, 'coachModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(STUDY_SCOUT_TOOL, available, config.coachModel, [
      RESEARCH_STEP,
      FORMAT_STEP,
    ]),
  ];
}
