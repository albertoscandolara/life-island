import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  describeAiTools,
  isAiToolEnabled,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  QUOTE_CONTENT_TYPES,
  QUOTE_MAX_BYTES,
  QUOTE_MAX_FILES,
  quoteComparisonOutputSchema,
  type AiStepUsage,
  type QuoteComparisonOutput,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type CarsConfig } from '../config.js';

/** The AI tool of Cars (AI_TOOLS in libs/contracts settings.ts). */
export const QUOTES_TOOL = 'cars.insurance-quotes';
const SERVICE = 'svc-cars';

/** A file to compare: a quote you uploaded, or the current policy on file. */
export interface QuoteFile {
  name: string;
  contentType: string;
  data: Buffer;
}

export interface WrittenComparison {
  output: QuoteComparisonOutput;
  model: string;
}

type ContentBlock = Anthropic.ContentBlockParam;

/** A PDF or an image as the model reads it; null for any other kind of file. */
export function fileBlock(file: QuoteFile): ContentBlock | null {
  const type = file.contentType.split(';')[0].trim().toLowerCase();
  const data = file.data.toString('base64');
  if (type === 'application/pdf')
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
      title: file.name,
    };
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')
    return {
      type: 'image',
      source: { type: 'base64', media_type: type, data },
    };
  return null;
}

/** Checks the uploaded quotes before anything is sent. */
export function checkQuoteFiles(files: readonly QuoteFile[]): void {
  if (!files.length)
    throw new BadRequestException('Upload at least one quote (PDF or photo)');
  if (files.length > QUOTE_MAX_FILES)
    throw new BadRequestException(
      `Compare at most ${QUOTE_MAX_FILES} quotes at a time`,
    );
  for (const file of files) {
    const type = file.contentType.split(';')[0].trim().toLowerCase();
    if (!(QUOTE_CONTENT_TYPES as readonly string[]).includes(type))
      throw new BadRequestException(
        `${file.name}: upload a PDF, JPEG, PNG or WebP file`,
      );
    if (file.data.length > QUOTE_MAX_BYTES)
      throw new BadRequestException(
        `${file.name}: a quote can be at most ${QUOTE_MAX_BYTES / 1024 / 1024} MB`,
      );
  }
}

/**
 * Compares insurance quotes with the car's current policy with the Claude
 * API, when ANTHROPIC_API_KEY is set (the key the parse worker uses) and the
 * tool is on in Settings → AI tools. There is no offline version: the quotes
 * are files only a model can read.
 */
@Injectable()
export class QuoteAdvisor implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuoteAdvisor.name);
  private readonly client: Anthropic | null;

  constructor(
    @Inject(CONFIG) private readonly config: CarsConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  /** Whether the comparison calls the model now: a key, and its switch in Settings. */
  async usesAi(): Promise<boolean> {
    return (
      this.client !== null &&
      (await isAiToolEnabled(this.svc.pool, this.svc.schema, QUOTES_TOOL))
    );
  }

  /** Tells Settings how the tool calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      SERVICE,
      describeCarsTools(this.config, this.client !== null),
    ).catch((error: unknown) =>
      this.logger.warn(`Could not describe the AI tools: ${String(error)}`),
    );
  }

  private async record(steps: AiStepUsage[], error?: unknown): Promise<void> {
    await recordAiToolUse(this.svc.pool, this.svc.schema, {
      toolId: QUOTES_TOOL,
      service: SERVICE,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(
        `Could not record a use of ${QUOTES_TOOL}: ${String(failure)}`,
      ),
    );
  }

  /**
   * `dossier` is the car and its insurance history as text; `policy` the
   * documents of the current policy on file (may be empty).
   */
  async compare(
    dossier: string,
    policy: readonly QuoteFile[],
    quotes: readonly QuoteFile[],
  ): Promise<WrittenComparison> {
    checkQuoteFiles(quotes);
    if (!this.client)
      throw new ServiceUnavailableException(
        'The quote comparison reads your quotes with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-cars.',
      );
    if (!(await this.usesAi()))
      throw new ServiceUnavailableException(
        'The insurance quote comparison is turned off in Settings → AI tools. Turn it on there to run it.',
      );
    const content: ContentBlock[] = [
      { type: 'text', text: `<car>\n${dossier}\n</car>` },
    ];
    const policyBlocks = policy.flatMap((file) => {
      const block = fileBlock(file);
      return block ? [block] : [];
    });
    if (policyBlocks.length)
      content.push(
        { type: 'text', text: 'The current policy, as on file:' },
        ...policyBlocks,
      );
    quotes.forEach((file, index) => {
      const block = fileBlock(file);
      if (block)
        content.push(
          { type: 'text', text: `Quote ${index + 1}: ${file.name}` },
          block,
        );
    });
    content.push({ type: 'text', text: COMPARE_REQUEST });

    const steps: AiStepUsage[] = [];
    try {
      const started = Date.now();
      const message = await this.client.messages.create({
        model: this.config.aiModel,
        max_tokens: 16000,
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(quoteComparisonOutputSchema),
        },
        system: [
          {
            type: 'text',
            text: COMPARE_INSTRUCTIONS,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content }],
      });
      steps.push(stepUsage('compare', message, Date.now() - started));
      if (message.stop_reason === 'refusal')
        throw new ComparisonError('Claude declined to compare these quotes.');
      if (message.stop_reason === 'max_tokens')
        throw new ComparisonError(
          'The comparison came out too long and was cut. Try with fewer quotes.',
        );
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      const output = quoteComparisonOutputSchema.parse(JSON.parse(text));
      await this.record(steps);
      return { output, model: message.model };
    } catch (error) {
      await this.record(steps, error);
      this.logger.error(`Quote comparison failed: ${String(error)}`);
      throw new ServiceUnavailableException(explain(error, this.config));
    }
  }
}

export const COMPARE_INSTRUCTIONS = `You compare Italian motor insurance offers (RCA auto with its extra covers) for one car and its owner. You get the car, its insurance history as Life Island has it, the current policy's documents when on file, and one or more quotes (PDF or photos).

Read every quote in full. For each offer, the current policy first, give the yearly premium with taxes, the bonus-malus (CU) class it assumes, who may drive (guida libera, esperta, esclusiva), the RCA limit (massimale), the main excess (franchigia, scoperto) and its pros and cons for this car. Then list every cover that appears in at least one offer (theft and fire, natural events, vandalism, glass, roadside assistance, driver injury, legal protection, collision or kasko, bonus protection, rinuncia alla rivalsa...) with its status in each offer: included, optional (offered at extra cost), missing, or unknown when the document does not say.

Compare like with like: say when a cheaper offer is cheaper because it covers less, has a higher excess, limits who may drive, needs a black box, or assumes a better CU class than the car has. Point out conditions that could cost money (exclusions, tacit renewal, payment in instalments with fees). Never invent a figure or a cover: when a document does not say, use null or unknown. Write in plain English for a non-expert; keep Italian insurance terms in brackets the first time.`;

const COMPARE_REQUEST =
  'Compare these quotes with my current policy and tell me which one to choose.';

/**
 * How the tool calls the model, as the info button in Settings shows it: the
 * same prompt, model and limits the call above sends.
 */
export function describeCarsTools(
  config: Pick<CarsConfig, 'aiModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    {
      toolId: QUOTES_TOOL,
      available,
      steps: [
        {
          stepId: 'compare',
          label: 'Compare the quotes',
          model: config.aiModel,
          effort: 'medium',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: [],
          system: COMPARE_INSTRUCTIONS,
          userTemplate: `<car>\n{the car: make, model, plate, power, fuel, first registration, holder; its insurance history: insurer, period, premium, CU class and covers of each policy; your note}\n</car>\nThe current policy, as on file: {its policy documents, PDF or image, when on file}\nQuote 1: {file name} {the quote, PDF or image}\n…\n${COMPARE_REQUEST}`,
          outputFormat: 'quoteComparisonOutput (structured output)',
          promptCaching: true,
        },
      ],
    },
  ];
}

class ComparisonError extends Error {}

/** What went wrong, in words you can act on: the key, the model, credit, or a busy API. */
export function explain(
  error: unknown,
  config: Pick<CarsConfig, 'aiModel'>,
): string {
  if (error instanceof ComparisonError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return 'The Claude API refused the key: check ANTHROPIC_API_KEY in .env and restart svc-cars.';
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'The Claude API key has no access to this model or feature. Check the key in the Claude Console.';
  if (error instanceof Anthropic.NotFoundError)
    return `The Claude API does not know the model "${config.aiModel}": check CARS_AI_MODEL in .env.`;
  if (error instanceof Anthropic.RateLimitError)
    return 'The Claude API rate limit was reached. Try again in a minute.';
  if (error instanceof Anthropic.BadRequestError)
    return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return 'svc-cars could not reach the Claude API: check the network or proxy.';
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
    return 'The Claude API is busy or down right now. Try again in a moment.';
  if (error instanceof SyntaxError)
    return 'The Claude API answered, but not in the expected format. Try again.';
  return 'The Claude API could not compare the quotes right now. Try again in a moment.';
}
