import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  describeAiTools,
  aiToolModel,
  isAiToolEnabled,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  type AiStepUsage,
  careerFeedbackOutputSchema,
  marketCheckOutputSchema,
  type CareerFeedbackOutput,
  type MarketCheckOutput,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type WorkConfig } from '../config.js';
import {
  careerDossier,
  FEEDBACK_INSTRUCTIONS,
  offlineFeedback,
  type CareerDossierInput,
} from './career-feedback.js';

export interface WrittenFeedback {
  output: CareerFeedbackOutput;
  source: 'claude' | 'offline';
  model: string | null;
}

/** The AI tools of Work (AI_TOOLS in libs/contracts settings.ts). */
export const FEEDBACK_TOOL = 'work.career-feedback';
export const MARKET_CHECK_TOOL = 'work.market-check';
const SERVICE = 'svc-work';

/**
 * Writes the career feedback: with the Claude API when ANTHROPIC_API_KEY is
 * set (the key the parse worker uses) and the tool is on in Settings, else
 * with Life Island's own rules, so the area works with no key at all.
 */
@Injectable()
export class CareerAdvisor implements OnApplicationBootstrap {
  private readonly logger = new Logger(CareerAdvisor.name);
  private readonly client: Anthropic | null;

  constructor(
    @Inject(CONFIG) private readonly config: WorkConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  /** Whether a tool calls the model now: a key, and its switch in Settings. */
  async usesAi(toolId: string = FEEDBACK_TOOL): Promise<boolean> {
    return (
      this.client !== null &&
      (await isAiToolEnabled(this.svc.pool, this.svc.schema, toolId))
    );
  }

  /** The model you picked for a tool in Settings, else WORK_FEEDBACK_MODEL. */
  private async modelFor(toolId: string): Promise<string> {
    return (
      (await aiToolModel(this.svc.pool, this.svc.schema, toolId)) ??
      this.config.feedbackModel
    );
  }

  /** Tells Settings how each Work tool calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      SERVICE,
      describeWorkTools(this.config, this.client !== null),
    ).catch((error: unknown) =>
      this.logger.warn(`Could not describe the AI tools: ${String(error)}`),
    );
  }

  private async record(
    toolId: string,
    steps: AiStepUsage[],
    error?: unknown,
  ): Promise<void> {
    await recordAiToolUse(this.svc.pool, this.svc.schema, {
      toolId,
      service: SERVICE,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(
        `Could not record a use of ${toolId}: ${String(failure)}`,
      ),
    );
  }

  async write(
    input: CareerDossierInput,
    question: string | null,
  ): Promise<WrittenFeedback> {
    if (!this.client || !(await this.usesAi(FEEDBACK_TOOL)))
      return {
        output: offlineFeedback(input, question),
        source: 'offline',
        model: null,
      };
    const dossier = careerDossier(input);
    const model = await this.modelFor(FEEDBACK_TOOL);
    const steps: AiStepUsage[] = [];
    try {
      const started = Date.now();
      const message = await this.client.messages.create({
        model,
        // Thinking is on by default and counts against max_tokens: 4000 left
        // the answer cut mid-JSON once the dossier grew.
        max_tokens: 16000,
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(careerFeedbackOutputSchema),
        },
        system: [
          {
            type: 'text',
            text: FEEDBACK_INSTRUCTIONS,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `<dossier>\n${dossier}\n</dossier>\n\n${
              question ? `My question: ${question}` : DEFAULT_QUESTION
            }`,
          },
        ],
      });
      steps.push(stepUsage('feedback', message, Date.now() - started));
      if (message.stop_reason === 'refusal')
        throw new FeedbackError(
          'Claude declined to write this feedback. Try rephrasing your question.',
        );
      if (message.stop_reason === 'max_tokens')
        throw new FeedbackError(
          'The feedback came out too long and was cut. Try again, or ask a narrower question.',
        );
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      const output = careerFeedbackOutputSchema.parse(JSON.parse(text));
      await this.record(FEEDBACK_TOOL, steps);
      return { output, source: 'claude', model: message.model };
    } catch (error) {
      await this.record(FEEDBACK_TOOL, steps, error);
      this.logger.error(`Career feedback failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        explain(error, { feedbackModel: model }),
      );
    }
  }

  /**
   * Public salary ranges for your role: Claude searches the web and writes
   * notes, then turns them into the structured check (structured output
   * cannot carry the search's citations, so it is a second, tool-free call).
   */
  async marketCheck(profile: MarketProfile): Promise<WrittenMarketCheck> {
    if (!this.client)
      throw new ServiceUnavailableException(
        'The market check searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-work.',
      );
    if (!(await this.usesAi(MARKET_CHECK_TOOL)))
      throw new ServiceUnavailableException(
        'The market check is turned off in Settings → AI tools. Turn it on there to run it.',
      );
    const client = this.client;
    const model = await this.modelFor(MARKET_CHECK_TOOL);
    const steps: AiStepUsage[] = [];
    const person = [
      `Role: ${profile.role}`,
      `Area: ${profile.region}`,
      profile.level ? `Level: ${profile.level}` : null,
      profile.contract ? `Collective agreement: ${profile.contract}` : null,
      profile.sector ? `Sector: ${profile.sector}` : null,
      profile.yearsOfExperience !== null
        ? `Years of experience: ${profile.yearsOfExperience}`
        : null,
      profile.ral !== null ? `Current RAL: ${profile.ral} euros` : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: person },
      ];
      let research: Anthropic.Message | null = null;
      for (let turn = 0; turn < 4; turn++) {
        const started = Date.now();
        research = await client.messages.create({
          model,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          system: MARKET_RESEARCH,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
          ],
          messages,
        });
        steps.push(stepUsage('research', research, Date.now() - started));
        if (research.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: research.content });
      }
      if (!research || research.stop_reason === 'pause_turn')
        throw new FeedbackError(
          'The web search took too long. Try again in a moment.',
        );
      if (research.stop_reason === 'refusal')
        throw new FeedbackError('Claude declined to run this market check.');
      const notes = textOf(research);
      if (!notes.trim())
        throw new FeedbackError(
          'The web search found nothing to report. Try a broader role or area.',
        );

      const formatStarted = Date.now();
      const formatted = await client.messages.create({
        model,
        max_tokens: 8000,
        output_config: {
          effort: 'low',
          format: zodOutputFormat(marketCheckOutputSchema),
        },
        system: MARKET_FORMAT,
        messages: [
          {
            role: 'user',
            content: `${person}\n\n<notes>\n${notes}\n</notes>`,
          },
        ],
      });
      steps.push(stepUsage('format', formatted, Date.now() - formatStarted));
      if (formatted.stop_reason === 'refusal')
        throw new FeedbackError('Claude declined to run this market check.');
      if (formatted.stop_reason === 'max_tokens')
        throw new FeedbackError(
          'The market check came out too long and was cut. Try again.',
        );
      const output = marketCheckOutputSchema.parse(
        JSON.parse(textOf(formatted)),
      );
      await this.record(MARKET_CHECK_TOOL, steps);
      return { output, model: formatted.model };
    } catch (error) {
      await this.record(MARKET_CHECK_TOOL, steps, error);
      this.logger.error(`Market check failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        explain(error, { feedbackModel: model }),
      );
    }
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

/** Who you are on the market: what the market check searches for. */
export interface MarketProfile {
  role: string;
  region: string;
  level: string | null;
  contract: string | null;
  sector: string | null;
  yearsOfExperience: number | null;
  ral: number | null;
}

export interface WrittenMarketCheck {
  output: MarketCheckOutput;
  model: string;
}

const DEFAULT_QUESTION =
  'Give me a feedback on my career so far and what to do next.';

/**
 * How the Work tools call the model, as the info button in Settings shows it:
 * the same prompts, models and limits the calls above send.
 */
export function describeWorkTools(
  config: Pick<WorkConfig, 'feedbackModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    {
      toolId: FEEDBACK_TOOL,
      available,
      steps: [
        {
          stepId: 'feedback',
          label: 'Write the feedback',
          model: config.feedbackModel,
          effort: 'medium',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: [],
          system: FEEDBACK_INSTRUCTIONS,
          userTemplate: `<dossier>\n{your approved workplaces, payslips, evaluations, contracts, goals and pay statistics, as text}\n</dossier>\n\n{My question: <your question>, or: ${DEFAULT_QUESTION}}`,
          outputFormat: 'careerFeedbackOutput (structured output)',
          promptCaching: true,
        },
      ],
    },
    {
      toolId: MARKET_CHECK_TOOL,
      available,
      steps: [
        {
          stepId: 'research',
          label: 'Search the web',
          model: config.feedbackModel,
          effort: 'medium',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: ['web_search (up to 8 searches)'],
          system: MARKET_RESEARCH,
          userTemplate:
            'Role: {role}\nArea: {area}\nLevel: {level}\nCollective agreement: {CCNL}\nSector: {sector}\nYears of experience: {years}\nCurrent RAL: {RAL} euros',
          outputFormat: null,
          promptCaching: false,
        },
        {
          stepId: 'format',
          label: 'Structure the findings',
          model: config.feedbackModel,
          effort: 'low',
          maxTokens: 8000,
          thinking: 'adaptive (default)',
          tools: [],
          system: MARKET_FORMAT,
          userTemplate:
            '{the profile above}\n\n<notes>\n{the notes of the web search}\n</notes>',
          outputFormat: 'marketCheckOutput (structured output)',
          promptCaching: false,
        },
      ],
    },
  ];
}

const MARKET_RESEARCH = `You research Italian salary ranges for one person. Search the web for recent public figures (salary surveys, job boards, recruiter reports, collective agreement tables) for the role, area and seniority given, in gross yearly pay (RAL) in euros. For each source write: its name, the exact URL, what the figures cover (role, seniority, area, year) and the low, median and high RAL it gives. Copy figures as published; convert monthly figures to yearly over the months the source says (13 or 14 when it does not). Never invent a figure: leave out a source whose page you could not read. Then say in two or three sentences where the person's RAL stands against these ranges, and give two to four concrete next steps.`;

const MARKET_FORMAT = `Turn these research notes into the requested JSON. Keep every source with its URL and figures exactly as in the notes; use null for a figure the notes do not give. Set position to below, within or above when the person's RAL can be set against the ranges, else unknown.`;

class FeedbackError extends Error {}

/** What went wrong, in words you can act on: the key, the model, credit, or a busy API. */
export function explain(
  error: unknown,
  config: Pick<WorkConfig, 'feedbackModel'>,
): string {
  if (error instanceof FeedbackError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return 'The Claude API refused the key: check ANTHROPIC_API_KEY in .env and restart svc-work.';
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'The Claude API key has no access to this model or feature. Check the key in the Claude Console.';
  if (error instanceof Anthropic.NotFoundError)
    return `The Claude API does not know the model "${config.feedbackModel}": check WORK_FEEDBACK_MODEL in .env.`;
  if (error instanceof Anthropic.RateLimitError)
    return 'The Claude API rate limit was reached. Try again in a minute.';
  if (error instanceof Anthropic.BadRequestError)
    return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return 'svc-work could not reach the Claude API: check the network or proxy.';
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
    return 'The Claude API is busy or down right now. Try again in a moment.';
  if (error instanceof SyntaxError)
    return 'The Claude API answered, but not in the expected format. Try again.';
  return 'The Claude API could not write the feedback right now. Try again in a moment.';
}
