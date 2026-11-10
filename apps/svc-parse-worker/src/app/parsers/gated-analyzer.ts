import { Logger } from '@nestjs/common';
import {
  isAiToolEnabled,
  recordAiToolUse,
  type ServiceDb,
} from '@life-island/be-common';
import type { AiStepUsage } from '@life-island/contracts';
import type {
  DocumentAnalyzer,
  ParseRunRecord,
  StepOutput,
} from './document-parser.js';

const SERVICE = 'svc-parse-worker';

/** The AI tool behind each step of the worker (AI_TOOLS in libs/contracts settings.ts). */
export const STEP_TOOLS: Record<ParseRunRecord['step'], string> = {
  classify: 'documents.classify',
  discover: 'documents.discover',
  extract: 'documents.extract',
  correct: 'documents.extract',
  transaction: 'documents.transactions',
  reclassify: 'documents.reclassify',
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
    if (!(await isAiToolEnabled(this.svc.pool, this.svc.schema, toolId)))
      return call(this.offline);
    try {
      const output = await call(this.ai);
      await this.record(toolId, output.runs);
      return output;
    } catch (error) {
      const runs = (error as { runs?: ParseRunRecord[] } | null)?.runs ?? [];
      await this.record(toolId, runs, error);
      throw error;
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
