import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  BadRequestException,
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
  aiToolModel,
  describeAiTools,
  isAiToolEnabled,
  readSettings,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  applyOutlineChanges,
  learningPath,
  nextScanOn,
  scoutCadenceMonths,
  scoutOutputSchema,
  stagesToScan,
  STUDY_SCOUT_CADENCE_SETTING,
  STUDY_SCOUT_CADENCES,
  STUDY_SCOUT_NONE,
  STUDY_SCOUT_SUBJECT_SETTING,
  STUDY_SCOUT_TOOL,
  type AiStepUsage,
  type LearningPath,
  type OutlineChangeDto,
  type OutlineDecision,
  type ScoutOutput,
  type ScoutResourceDto,
  type ScoutScanDto,
  type ScoutScanReason,
  type StepPace,
  type StudyScoutCadence,
  type StudyScoutDto,
} from '@life-island/contracts';
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type StudiesConfig } from '../config.js';
import {
  outlineChanges,
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
import { explain } from './study-coach.js';

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
  private readonly client: Anthropic | null;
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: StudiesConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  private get db() {
    return this.svc.db;
  }

  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      SERVICE,
      describeScoutTool(this.config, this.client !== null),
    ).catch((error: unknown) =>
      this.logger.warn(
        `Could not describe the resource scout: ${String(error)}`,
      ),
    );
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
  async usesAi(): Promise<boolean> {
    return (
      this.client !== null &&
      (await isAiToolEnabled(this.svc.pool, this.svc.schema, STUDY_SCOUT_TOOL))
    );
  }

  /** The path under watch and how often, from the settings replica. */
  async settings(): Promise<{
    subject: string | null;
    cadence: StudyScoutCadence;
  }> {
    const values = await readSettings(this.svc.pool, this.svc.schema, [
      STUDY_SCOUT_SUBJECT_SETTING,
      STUDY_SCOUT_CADENCE_SETTING,
    ]).catch(() => new Map<string, unknown>());
    const subject = values.get(STUDY_SCOUT_SUBJECT_SETTING);
    const cadence = values.get(STUDY_SCOUT_CADENCE_SETTING);
    return {
      subject:
        typeof subject === 'string' &&
        subject !== STUDY_SCOUT_NONE &&
        learningPath(subject)
          ? subject
          : null,
      cadence: STUDY_SCOUT_CADENCES.includes(cadence as StudyScoutCadence)
        ? (cadence as StudyScoutCadence)
        : 'auto',
    };
  }

  /** The learning paths with the outline changes you accepted. */
  async catalogue(): Promise<LearningPath[]> {
    const accepted = await this.db
      .select()
      .from(outlineChanges)
      .where(eq(outlineChanges.status, 'accepted'))
      .orderBy(outlineChanges.decidedAt);
    return applyOutlineChanges(accepted.map(changeDto));
  }

  /** The scout's part of the overview. */
  async status(
    catalogue: readonly LearningPath[],
    today: string,
  ): Promise<StudyScoutDto> {
    const [settings, ai, resourceRows, proposalRows, paceRows, [last]] =
      await Promise.all([
        this.settings(),
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
    const path = settings.subject
      ? learningPath(settings.subject, catalogue)
      : undefined;
    const months = scoutCadenceMonths(settings.cadence, path?.topic ?? null);
    let next: string | null = null;
    if (path) {
      const done = await this.lastDone(path.id);
      next = done ? nextScanOn(done.startedAt.toISOString(), months) : today;
    }
    return {
      subject: path?.id ?? null,
      cadence: settings.cadence,
      cadenceMonths: months,
      ai,
      lastScan: last ? scanDto(last) : null,
      nextScanOn: next,
      resources: resourceRows.map(resourceDto),
      proposals: proposalRows.map(changeDto),
      paces: Object.fromEntries(
        paceRows.map((row) => [row.stepId, row.pace]),
      ) as Record<string, StepPace>,
    };
  }

  private async lastDone(pathId: string): Promise<ScoutScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(scoutScans)
      .where(and(eq(scoutScans.pathId, pathId), eq(scoutScans.status, 'done')))
      .orderBy(desc(scoutScans.startedAt))
      .limit(1);
    return row;
  }

  // ---- scheduling ----------------------------------------------------------

  /**
   * Starts a scan of the path under watch when one is due: none yet for it
   * (you just picked it), or its last one is older than the cadence.
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
    const { subject, cadence } = await this.settings();
    if (!subject || this.running || !(await this.usesAi())) return null;
    const path = learningPath(subject)!;
    const done = await this.lastDone(subject);
    if (done) {
      const due = nextScanOn(
        done.startedAt.toISOString(),
        scoutCadenceMonths(cadence, path.topic),
      );
      if (now.toISOString().slice(0, 10) < due) return null;
    }
    const [latest] = await this.db
      .select()
      .from(scoutScans)
      .where(eq(scoutScans.pathId, subject))
      .orderBy(desc(scoutScans.startedAt))
      .limit(1);
    if (
      latest?.status === 'error' &&
      now.getTime() - latest.startedAt.getTime() < RETRY_AFTER_MS
    )
      return null;
    return this.start(subject, done ? 'schedule' : 'subject');
  }

  /** Refresh now: scans the path under watch at once. */
  async refresh(): Promise<{ id: string }> {
    const { subject } = await this.settings();
    if (!subject)
      throw new BadRequestException(
        'Pick the path to keep current first (Settings → App settings → Studies).',
      );
    if (!this.client)
      throw new ServiceUnavailableException(
        'The resource scout searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-studies.',
      );
    if (!(await this.usesAi()))
      throw new ServiceUnavailableException(
        'The resource scout is turned off in Settings → AI tools. Turn it on there to scan.',
      );
    if (this.running) throw new ConflictException('A scan is already running.');
    return { id: await this.start(subject, 'manual') };
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
    const client = this.client!;
    const steps: AiStepUsage[] = [];
    let model = this.config.coachModel;
    try {
      const catalogue = await this.catalogue();
      const path = learningPath(pathId, catalogue)!;
      const scope = await this.scope(path);
      model =
        (await aiToolModel(this.svc.pool, this.svc.schema, STUDY_SCOUT_TOOL)) ??
        model;
      const request = scoutRequest(scope);

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: request },
      ];
      let research: Anthropic.Message | null = null;
      for (let turn = 0; turn < 4; turn++) {
        const started = Date.now();
        research = await client.messages.create({
          model,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          system: SCOUT_RESEARCH,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
          ],
          messages,
        });
        steps.push(stepUsage('research', research, Date.now() - started));
        if (research.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: research.content });
      }
      if (!research || research.stop_reason === 'pause_turn')
        throw new ScoutError('The web search took too long. Try again later.');
      if (research.stop_reason === 'refusal')
        throw new ScoutError('Claude declined to run this scan.');
      const notes = textOf(research);
      if (!notes.trim())
        throw new ScoutError('The web search found nothing to report.');

      const started = Date.now();
      const formatted = await client.messages.create({
        model,
        max_tokens: 16000,
        output_config: {
          effort: 'low',
          format: zodOutputFormat(scoutOutputSchema),
        },
        system: SCOUT_FORMAT,
        messages: [
          {
            role: 'user',
            content: `${request}\n\n<notes>\n${notes}\n</notes>`,
          },
        ],
      });
      steps.push(stepUsage('format', formatted, Date.now() - started));
      if (formatted.stop_reason === 'max_tokens')
        throw new ScoutError('The findings came out too long and were cut.');
      const output = scoutOutputSchema.parse(JSON.parse(textOf(formatted)));
      const result = await this.save(scanId, scope, output);
      await this.db
        .update(scoutScans)
        .set({
          status: 'done',
          ...result,
          model: formatted.model,
          finishedAt: new Date(),
        })
        .where(eq(scoutScans.id, scanId));
      await this.record(steps);
    } catch (error) {
      await this.record(steps, error);
      this.logger.error(`Resource scan failed: ${String(error)}`);
      await this.db
        .update(scoutScans)
        .set({
          status: 'error',
          error:
            error instanceof ScoutError
              ? error.message
              : explain(error, model).replace('write the plan', 'run the scan'),
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

  private async record(steps: AiStepUsage[], error?: unknown): Promise<void> {
    if (!steps.length && !error) return;
    await recordAiToolUse(this.svc.pool, this.svc.schema, {
      toolId: STUDY_SCOUT_TOOL,
      service: SERVICE,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(
        `Could not record a use of ${STUDY_SCOUT_TOOL}: ${String(failure)}`,
      ),
    );
  }
}

class ScoutError extends Error {}

function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
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

/** How the scout calls the model, as the info button in Settings shows it. */
export function describeScoutTool(
  config: Pick<StudiesConfig, 'coachModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    {
      toolId: STUDY_SCOUT_TOOL,
      available,
      steps: [
        {
          stepId: 'research',
          label: 'Search the web',
          model: config.coachModel,
          effort: 'medium',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: ['web_search (up to 12 searches)'],
          system: SCOUT_RESEARCH,
          userTemplate:
            'Today: {date}\nPath: {name} (topic: {topic})\n{summary}\n\n# Steps to scan\n{for the stage with your next step and the one after: each step with its detail, outcome, hand-picked and pinned resources}\n\n# Dismissed (never suggest)\n{the addresses you dismissed}\n\n# The other stages of the path (context only)\n{titles}',
          outputFormat: null,
          promptCaching: false,
        },
        {
          stepId: 'format',
          label: 'Structure the findings',
          model: config.coachModel,
          effort: 'low',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: [],
          system: SCOUT_FORMAT,
          userTemplate:
            '{the same request}\n\n<notes>\n{the research notes}\n</notes>',
          outputFormat: 'scoutOutput (structured output)',
          promptCaching: false,
        },
      ],
    },
  ];
}
