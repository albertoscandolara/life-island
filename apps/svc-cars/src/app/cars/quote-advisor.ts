import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { AiToolDescription, ServiceDb } from '@life-island/be-common';
import {
  AiAssistant,
  aiFileBlock,
  describeAiSteps,
  type AiAssistantStep,
  type AiContentBlock,
} from '@life-island/be-nest';
import {
  QUOTE_CONTENT_TYPES,
  QUOTE_MAX_BYTES,
  QUOTE_MAX_FILES,
  quoteComparisonOutputSchema,
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
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: CarsConfig,
    @Inject(SERVICE_DB) svc: ServiceDb,
  ) {
    // The model you pick in Settings, else CARS_AI_MODEL.
    this.ai = new AiAssistant({
      toolId: QUOTES_TOOL,
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  /** Whether the comparison calls the model now: a key, its switches and the budget. */
  usesAi(): Promise<boolean> {
    return this.ai.active();
  }

  /** Tells Settings how the tool calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([COMPARE_STEP]);
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
    if (!this.ai.configured)
      throw new ServiceUnavailableException(
        'The quote comparison reads your quotes with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-cars.',
      );
    if (!(await this.ai.active()))
      throw new ServiceUnavailableException(
        'The insurance quote comparison is turned off in Settings → AI tools. Turn it on there to run it.',
      );
    const content: AiContentBlock[] = [
      { type: 'text', text: `<car>\n${dossier}\n</car>` },
    ];
    const policyBlocks = policy.flatMap((file) => {
      const block = aiFileBlock(file);
      return block ? [block] : [];
    });
    if (policyBlocks.length)
      content.push(
        { type: 'text', text: 'The current policy, as on file:' },
        ...policyBlocks,
      );
    quotes.forEach((file, index) => {
      const block = aiFileBlock(file);
      if (block)
        content.push(
          { type: 'text', text: `Quote ${index + 1}: ${file.name}` },
          block,
        );
    });
    content.push({ type: 'text', text: COMPARE_REQUEST });
    return this.ai.ask({
      step: COMPARE_STEP,
      user: content,
      output: quoteComparisonOutputSchema,
    });
  }
}

export const COMPARE_INSTRUCTIONS = `You compare Italian motor insurance offers (RCA auto with its extra covers) for one car and its owner. You get the car, its insurance history as Life Island has it, the current policy's documents when on file, and one or more quotes (PDF or photos).

Read every quote in full. For each offer, the current policy first, give the yearly premium with taxes, the bonus-malus (CU) class it assumes, who may drive (guida libera, esperta, esclusiva), the RCA limit (massimale), the main excess (franchigia, scoperto) and its pros and cons for this car. Then list every cover that appears in at least one offer (theft and fire, natural events, vandalism, glass, roadside assistance, driver injury, legal protection, collision or kasko, bonus protection, rinuncia alla rivalsa...) with its status in each offer: included, optional (offered at extra cost), missing, or unknown when the document does not say.

Compare like with like: say when a cheaper offer is cheaper because it covers less, has a higher excess, limits who may drive, needs a black box, or assumes a better CU class than the car has. Point out conditions that could cost money (exclusions, tacit renewal, payment in instalments with fees). Never invent a figure or a cover: when a document does not say, use null or unknown. Write in plain English for a non-expert; keep Italian insurance terms in brackets the first time.`;

const COMPARE_REQUEST =
  'Compare these quotes with my current policy and tell me which one to choose.';

const COMPARE_STEP: AiAssistantStep = {
  stepId: 'compare',
  label: 'Compare the quotes',
  system: COMPARE_INSTRUCTIONS,
  userTemplate: `<car>\n{the car: make, model, plate, power, fuel, first registration, holder; its insurance history: insurer, period, premium, CU class and covers of each policy; your note}\n</car>\nThe current policy, as on file: {its policy documents, PDF or image, when on file}\nQuote 1: {file name} {the quote, PDF or image}\n…\n${COMPARE_REQUEST}`,
  outputFormat: 'quoteComparisonOutput',
  effort: 'medium',
  maxTokens: 16000,
};

/**
 * How the tool calls the model, as the info button in Settings shows it: the
 * same prompt, model and limits the call above sends.
 */
export function describeCarsTools(
  config: Pick<CarsConfig, 'aiModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(QUOTES_TOOL, available, config.aiModel, [COMPARE_STEP]),
  ];
}
