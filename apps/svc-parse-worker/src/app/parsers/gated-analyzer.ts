import { Logger } from '@nestjs/common';
import {
  AiSpendDenied,
  aiToolBlock,
  aiToolModel,
  type AiToolBlock,
  HttpAiSpendGuard,
  recordAiToolUse,
  worstCaseUsd,
  type AiSpendGuard,
  type ServiceDb,
} from '@life-island/be-common';
import { useCostUsd, type AiStepUsage } from '@life-island/contracts';
import {
  AiUnavailableError,
  type DocumentAnalyzer,
  type ParseRunRecord,
  type StepOutput,
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

/** How long the queue waits before it checks again whether AI is back. */
const RETRY_MINUTES = { switched_off: 10, budget_reached: 60, paused: 5 };

/** What the review inbox's banner says while documents wait for the AI. */
const BLOCKED_MESSAGES: Record<AiToolBlock, string> = {
  ai_off:
    'Documents wait for the AI: AI is switched off in Settings, AI tools. Turn it on and they are read on the next check.',
  tool_off:
    'Documents wait for the AI: a Documents tool is switched off in Settings, AI tools. Turn it on and they are read on the next check.',
  budget_reached:
    "Documents wait for the AI: this month's AI budget is used up. Raise it in Settings, AI tools, or they are read next month.",
};

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
 * this worker's settings replica whether the step's AI tool is on, then
 * reserves its cost with the spending guard. Documents are only ever read by
 * the AI: when it may not be called, the step throws `AiUnavailableError` and
 * the queue pauses until it can (never the offline parser). Every step that reached the model is
 * recorded with its tokens, so Settings shows what each tool really costs.
 */
export class GatedAnalyzer implements DocumentAnalyzer {
  readonly name: string;
  private readonly logger = new Logger(GatedAnalyzer.name);

  constructor(
    private readonly ai: DocumentAnalyzer,
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
    if (block)
      throw unavailable(
        BLOCKED_MESSAGES[block],
        block === 'budget_reached'
          ? RETRY_MINUTES.budget_reached
          : RETRY_MINUTES.switched_off,
      );
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
      this.logger.warn(`${toolId} waits for the AI: ${error.message}`);
      throw unavailable(
        `Documents wait for the AI: ${error.message}`,
        RETRY_MINUTES.paused,
      );
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

function unavailable(message: string, minutes: number): AiUnavailableError {
  return new AiUnavailableError(
    message,
    { message },
    new Date(Date.now() + minutes * 60_000),
  );
}
