import { Logger } from '@nestjs/common';
import {
  AiSpendDenied,
  aiToolBlock,
  aiToolModel,
  HttpAiSpendGuard,
  recordAiToolUse,
  worstCaseUsd,
  type AiSpendGuard,
  type ServiceDb,
} from '@life-island/be-common';
import { useCostUsd, type AiStepUsage } from '@life-island/contracts';
import type {
  DocumentAnalyzer,
  ParseRunRecord,
  StepOutput,
} from './document-parser.js';

const SERVICE = 'svc-parse-worker';

/**
 * What one step reserves with the spending guard before it runs: a long
 * document (100,000 tokens in) and a full answer, priced on the step's model
 * (Sonnet's prices when the env model is used). The real cost is settled after.
 */
const STEP_WORST_CASE = { inputTokens: 100_000, maxTokens: 16_000 };

/** The AI tool behind each step of the worker (AI_TOOLS in libs/contracts settings.ts). */
export const STEP_TOOLS: Record<ParseRunRecord['step'], string> = {
  classify: 'documents.classify',
  discover: 'documents.discover',
  extract: 'documents.extract',
  correct: 'documents.extract',
  transaction: 'documents.transactions',
  reclassify: 'documents.reclassify',
};

/**
 * Why a step ran on the offline analyzer although the worker runs Claude,
 * added to the document's flags so the review panel can say what to change.
 */
export const OFFLINE_FLAGS = {
  ai_off: 'offline_ai_off',
  tool_off: 'offline_tool_off',
  budget_reached: 'offline_budget_reached',
  paused: 'offline_ai_paused',
} as const;

type OfflineReason = keyof typeof OFFLINE_FLAGS;

type Method = Exclude<keyof DocumentAnalyzer, 'name'>;

const METHOD_TOOLS: Record<Method, string> = {
  classify: 'documents.classify',
  discover: 'documents.discover',
  extract: 'documents.extract',
  readTransaction: 'documents.transactions',
  matchCategories: 'documents.reclassify',
};

/** The tokens of the model calls a step made, as Settings records them. */
export function usageOf(runs: readonly ParseRunRecord[]): AiStepUsage[] {
  return runs.map((run) => ({
    stepId: run.step,
    model: run.model,
    inputTokens: run.inputTokens ?? 0,
    outputTokens: run.outputTokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    latencyMs: run.latencyMs ?? null,
  }));
}

/**
 * The Claude parser behind the switches of Settings: before each step it asks
 * this worker's settings replica whether the step's AI tool is on; when it is
 * off, the step runs on Life Island's own rules (the offline analyzer)
 * instead, so documents keep flowing. Every step that reached the model is
 * recorded with its tokens, so Settings shows what each tool really costs.
 */
export class GatedAnalyzer implements DocumentAnalyzer {
  readonly name: string;
  private readonly logger = new Logger(GatedAnalyzer.name);

  constructor(
    private readonly ai: DocumentAnalyzer,
    private readonly offline: DocumentAnalyzer,
    private readonly svc: ServiceDb,
    /** The AI analyzer on the model you picked for a tool in Settings. */
    private readonly aiOn?: (toolId: string, model: string) => DocumentAnalyzer,
    /** Reserves each step's cost first (docs/security.md, "AI cost guards"). */
    private readonly guard: AiSpendGuard = HttpAiSpendGuard.fromEnv(),
  ) {
    this.name = ai.name;
  }

  classify: DocumentAnalyzer['classify'] = (...args) =>
    this.run('classify', (analyzer) => analyzer.classify(...args));
  discover: DocumentAnalyzer['discover'] = (...args) =>
    this.run('discover', (analyzer) => analyzer.discover(...args));
  extract: DocumentAnalyzer['extract'] = (...args) =>
    this.run('extract', (analyzer) => analyzer.extract(...args));
  readTransaction: DocumentAnalyzer['readTransaction'] = (...args) =>
    this.run('readTransaction', (analyzer) =>
      analyzer.readTransaction(...args),
    );
  matchCategories: DocumentAnalyzer['matchCategories'] = (...args) =>
    this.run('matchCategories', (analyzer) =>
      analyzer.matchCategories(...args),
    );

  private async run<T>(
    method: Method,
    call: (analyzer: DocumentAnalyzer) => Promise<StepOutput<T>>,
  ): Promise<StepOutput<T>> {
    const toolId = METHOD_TOOLS[method];
    const block = await aiToolBlock(this.svc.pool, this.svc.schema, toolId);
    if (block) return this.offlineRun(call, block);
    const model = this.aiOn
      ? await aiToolModel(this.svc.pool, this.svc.schema, toolId)
      : null;
    const ai = model && this.aiOn ? this.aiOn(toolId, model) : this.ai;
    let reservation: string;
    try {
      reservation = await this.guard.reserve({
        toolId,
        service: SERVICE,
        userId: null,
        maxUsd: worstCaseUsd(model ?? 'claude-sonnet-5-5', STEP_WORST_CASE),
      });
    } catch (error) {
      if (!(error instanceof AiSpendDenied)) throw error;
      // Like a tool switched off: the step runs on Life Island's own rules.
      this.logger.warn(`${toolId} runs offline: ${error.message}`);
      return this.offlineRun(call, 'paused');
    }
    let runs: readonly ParseRunRecord[] = [];
    try {
      const output = await call(ai);
      runs = output.runs;
      await this.record(toolId, output.runs);
      return output;
    } catch (error) {
      runs = (error as { runs?: ParseRunRecord[] } | null)?.runs ?? [];
      await this.record(toolId, runs, error);
      throw error;
    } finally {
      await this.guard
        .settle(reservation, useCostUsd(usageOf(runs)))
        .catch((failure: unknown) =>
          this.logger.warn(`Could not settle the AI spend: ${String(failure)}`),
        );
    }
  }

  /** The step on the offline analyzer, its result flagged with why. */
  private async offlineRun<T>(
    call: (analyzer: DocumentAnalyzer) => Promise<StepOutput<T>>,
    reason: OfflineReason,
  ): Promise<StepOutput<T>> {
    const output = await call(this.offline);
    const result = output.result as { flags?: unknown } | null;
    if (result && Array.isArray(result.flags)) {
      const flag = OFFLINE_FLAGS[reason];
      if (!result.flags.includes(flag)) result.flags.push(flag);
    }
    return output;
  }

  private async record(
    toolId: string,
    runs: readonly ParseRunRecord[],
    error?: unknown,
  ): Promise<void> {
    // Several tools can share one step's calls (extract and its correction).
    for (const id of new Set(runs.map((run) => STEP_TOOLS[run.step]))) {
      await recordAiToolUse(this.svc.pool, this.svc.schema, {
        toolId: id,
        service: SERVICE,
        outcome: error ? 'error' : 'ok',
        error: error ? String(error) : null,
        steps: usageOf(runs.filter((run) => STEP_TOOLS[run.step] === id)),
      }).catch((failure: unknown) =>
        this.logger.warn(`Could not record a use of ${id}: ${String(failure)}`),
      );
    }
  }
}
