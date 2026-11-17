import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  aiToolModel,
  describeAiTools,
  isAiToolEnabled,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import type { AiEffort, AiStepUsage } from '@life-island/contracts';
import type { z } from 'zod';

/*
 * The service side of one AI tool, in one object (docs/guides/ai-tools.md):
 * whether it may call the model now (an API key, its switch and the master
 * switch in Settings, the monthly budget), how it describes its request to
 * Settings, one structured call recorded with its tokens, and errors in words
 * you can act on. A service builds one per tool and keeps its own offline
 * fallback for when `active()` is false.
 */

export interface AiAssistantOptions {
  /** `<module>.<tool>`, as registered in AI_TOOLS. */
  toolId: string;
  /** The service that runs it, e.g. `svc-money`. */
  service: string;
  /** The service's ANTHROPIC_API_KEY; null keeps the tool offline. */
  apiKey: string | null;
  /** The model from the service's env, used until one is picked in Settings. */
  defaultModel: string;
  svc: ServiceDb;
}

/** One request of the tool, as Settings' info button shows it. */
export interface AiAssistantStep {
  stepId: string;
  label: string;
  system: string;
  /** The user message with `{placeholders}` for what changes per use. */
  userTemplate: string;
  /** The structured output's name; null for a step that answers in text (a web search). */
  outputFormat: string | null;
  effort: AiEffort;
  maxTokens: number;
  /** Server tools the step uses, as Settings lists them, e.g. `web_search (up to 8 searches)`. */
  tools?: string[];
}

/** One part of a user message: text, a PDF document or an image. */
export type AiContentBlock = Anthropic.ContentBlockParam;

/** The user message of one use: text, or text with documents and images (a PDF quote, a photo). */
export type AiUserContent = string | AiContentBlock[];

export interface AiAskRequest<T extends z.ZodType> {
  step: AiAssistantStep;
  /** The user message of this use. */
  user: AiUserContent;
  output: T;
}

/**
 * A web search first, then its notes turned into structured output (a
 * structured answer cannot carry the search's citations, so it is a second,
 * tool-free call). Recorded as one use with both steps.
 */
export interface AiResearchRequest<T extends z.ZodType> {
  research: {
    step: AiAssistantStep;
    user: string;
    /** The most searches the model may run. */
    maxSearches: number;
  };
  format: {
    step: AiAssistantStep;
    /** The user message of the second call, from the search's notes. */
    user: (notes: string) => string;
    output: T;
  };
}

export interface AiAnswer<T> {
  output: T;
  model: string;
}

export class AiAssistant {
  private readonly logger: Logger;
  private readonly client: Anthropic | null;

  constructor(private readonly options: AiAssistantOptions) {
    this.logger = new Logger(options.toolId);
    this.client = options.apiKey
      ? new Anthropic({ apiKey: options.apiKey, maxRetries: 2 })
      : null;
  }

  /** Whether the service has an API key at all. */
  get configured(): boolean {
    return this.client !== null;
  }

  /** Whether the tool calls the model now: a key, its switches and the budget. */
  async active(): Promise<boolean> {
    if (!this.client) return false;
    return isAiToolEnabled(
      this.options.svc.pool,
      this.options.svc.schema,
      this.options.toolId,
    ).catch(() => false);
  }

  /** Tells Settings how the tool calls the model; call it at startup. */
  async describe(steps: AiAssistantStep[]): Promise<void> {
    await describeAiTools(
      this.options.svc.pool,
      this.options.svc.schema,
      this.options.service,
      [
        describeAiSteps(
          this.options.toolId,
          this.configured,
          this.options.defaultModel,
          steps,
        ),
      ],
    ).catch((error: unknown) =>
      this.logger.warn(`Could not describe the AI tool: ${String(error)}`),
    );
  }

  /**
   * One structured call, recorded in Settings with its tokens (a failure too).
   * Throws a 503 whose message says what to do; call `active()` first.
   */
  async ask<T extends z.ZodType>(
    request: AiAskRequest<T>,
  ): Promise<AiAnswer<z.output<T>>> {
    return this.use(async (client, model, steps) => {
      const message = await this.structured(client, model, steps, request);
      return {
        output: parseOutput(message, request.output),
        model: message.model,
      };
    });
  }

  /**
   * Searches the web, then structures what it found: two calls recorded as
   * one use. Throws a 503 whose message says what to do; call `active()` first.
   */
  async research<T extends z.ZodType>(
    request: AiResearchRequest<T>,
  ): Promise<AiAnswer<z.output<T>>> {
    return this.use(async (client, model, steps) => {
      const { step, user, maxSearches } = request.research;
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: user },
      ];
      let found: Anthropic.Message | null = null;
      // A long search pauses its turn; send it back to let it go on.
      for (let turn = 0; turn < 4; turn++) {
        const started = Date.now();
        found = await client.messages.create({
          model,
          max_tokens: step.maxTokens,
          output_config: { effort: step.effort },
          system: step.system,
          tools: [
            {
              type: 'web_search_20260209',
              name: 'web_search',
              max_uses: maxSearches,
            },
          ],
          messages,
        });
        steps.push(stepUsage(step.stepId, found, Date.now() - started));
        if (found.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: found.content });
      }
      if (!found || found.stop_reason === 'pause_turn')
        throw new AiAnswerError(
          'The web search took too long. Try again in a moment.',
        );
      if (found.stop_reason === 'refusal')
        throw new AiAnswerError(
          'Claude declined to answer this. Try rephrasing your request.',
        );
      const notes = textOf(found);
      if (!notes.trim())
        throw new AiAnswerError(
          'The web search found nothing to report. Try a broader request.',
        );
      const message = await this.structured(client, model, steps, {
        step: request.format.step,
        user: request.format.user(notes),
        output: request.format.output,
      });
      return {
        output: parseOutput(message, request.format.output),
        model: message.model,
      };
    });
  }

  /** Runs the calls of one use with the tool's model, and records it. */
  private async use<R>(
    run: (client: Anthropic, model: string, steps: AiStepUsage[]) => Promise<R>,
  ): Promise<R> {
    if (!this.client)
      throw new ServiceUnavailableException(
        `${this.options.service} has no Claude API key: set ANTHROPIC_API_KEY in .env and restart it.`,
      );
    const model =
      (await aiToolModel(
        this.options.svc.pool,
        this.options.svc.schema,
        this.options.toolId,
      ).catch(() => null)) ?? this.options.defaultModel;
    const steps: AiStepUsage[] = [];
    try {
      const result = await run(this.client, model, steps);
      await this.record(steps);
      return result;
    } catch (error) {
      await this.record(steps, error);
      this.logger.error(`${this.options.toolId} failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        explainAiError(error, model, this.options.service),
      );
    }
  }

  /** One call with structured output; a refusal or a cut answer throws in words. */
  private async structured<T extends z.ZodType>(
    client: Anthropic,
    model: string,
    steps: AiStepUsage[],
    request: AiAskRequest<T>,
  ): Promise<Anthropic.Message> {
    const started = Date.now();
    const message = await client.messages.create({
      model,
      max_tokens: request.step.maxTokens,
      output_config: {
        effort: request.step.effort,
        format: zodOutputFormat(request.output),
      },
      system: [
        {
          type: 'text',
          text: request.step.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: request.user }],
    });
    steps.push(stepUsage(request.step.stepId, message, Date.now() - started));
    if (message.stop_reason === 'refusal')
      throw new AiAnswerError(
        'Claude declined to answer this. Try rephrasing your request.',
      );
    if (message.stop_reason === 'max_tokens')
      throw new AiAnswerError(
        'The answer came out too long and was cut. Try again with a narrower request.',
      );
    return message;
  }

  private async record(steps: AiStepUsage[], error?: unknown): Promise<void> {
    await recordAiToolUse(this.options.svc.pool, this.options.svc.schema, {
      toolId: this.options.toolId,
      service: this.options.service,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(`Could not record a use: ${String(failure)}`),
    );
  }
}

/** What Settings' info button shows for one tool: the same prompts, model and limits the calls send. */
export function describeAiSteps(
  toolId: string,
  available: boolean,
  model: string,
  steps: AiAssistantStep[],
): AiToolDescription {
  return {
    toolId,
    available,
    steps: steps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      model,
      effort: step.effort,
      maxTokens: step.maxTokens,
      thinking: 'adaptive (default)',
      tools: step.tools ?? [],
      system: step.system,
      userTemplate: step.userTemplate,
      outputFormat: step.outputFormat
        ? `${step.outputFormat} (structured output)`
        : null,
      promptCaching: !step.tools?.length,
    })),
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

function parseOutput<T extends z.ZodType>(
  message: Anthropic.Message,
  output: T,
): z.output<T> {
  return output.parse(JSON.parse(textOf(message))) as z.output<T>;
}

/** An answer that came back but cannot be used, with its reason in words. */
export class AiAnswerError extends Error {}

/** What went wrong with a Claude API call, in words you can act on. */
export function explainAiError(
  error: unknown,
  model: string,
  service: string,
): string {
  if (error instanceof AiAnswerError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return `The Claude API refused the key: check ANTHROPIC_API_KEY in .env and restart ${service}.`;
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'The Claude API key has no access to this model. Check the key in the Claude Console.';
  if (error instanceof Anthropic.NotFoundError)
    return `The Claude API does not know the model "${model}": pick another in Settings → AI tools.`;
  if (error instanceof Anthropic.RateLimitError)
    return 'The Claude API rate limit was reached. Try again in a minute.';
  if (error instanceof Anthropic.BadRequestError)
    return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return `${service} could not reach the Claude API: check the network or proxy.`;
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
    return 'The Claude API is busy or down right now. Try again in a moment.';
  if (error instanceof SyntaxError || isZodError(error))
    return 'The Claude API answered, but not in the expected format. Try again.';
  return 'The Claude API could not answer right now. Try again in a moment.';
}

function isZodError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'ZodError';
}
