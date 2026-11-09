import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  careerFeedbackOutputSchema,
  marketCheckOutputSchema,
  type CareerFeedbackOutput,
  type MarketCheckOutput,
} from '@life-island/contracts';
import { CONFIG, type WorkConfig } from '../config.js';
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

/**
 * Writes the career feedback: with the Claude API when ANTHROPIC_API_KEY is
 * set (the key the parse worker uses), else with Life Island's own rules, so
 * the area works with no key at all.
 */
@Injectable()
export class CareerAdvisor {
  private readonly logger = new Logger(CareerAdvisor.name);
  private readonly client: Anthropic | null;

  constructor(@Inject(CONFIG) private readonly config: WorkConfig) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  get usesAi(): boolean {
    return this.client !== null;
  }

  async write(
    input: CareerDossierInput,
    question: string | null,
  ): Promise<WrittenFeedback> {
    if (!this.client)
      return {
        output: offlineFeedback(input, question),
        source: 'offline',
        model: null,
      };
    const dossier = careerDossier(input);
    try {
      const message = await this.client.messages.create({
        model: this.config.feedbackModel,
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
              question
                ? `My question: ${question}`
                : 'Give me a feedback on my career so far and what to do next.'
            }`,
          },
        ],
      });
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
      return {
        output: careerFeedbackOutputSchema.parse(JSON.parse(text)),
        source: 'claude',
        model: message.model,
      };
    } catch (error) {
      this.logger.error(`Career feedback failed: ${String(error)}`);
      throw new ServiceUnavailableException(explain(error, this.config));
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
    const client = this.client;
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
        research = await client.messages.create({
          model: this.config.feedbackModel,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          system: MARKET_RESEARCH,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
          ],
          messages,
        });
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

      const formatted = await client.messages.create({
        model: this.config.feedbackModel,
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
      if (formatted.stop_reason === 'refusal')
        throw new FeedbackError('Claude declined to run this market check.');
      if (formatted.stop_reason === 'max_tokens')
        throw new FeedbackError(
          'The market check came out too long and was cut. Try again.',
        );
      return {
        output: marketCheckOutputSchema.parse(JSON.parse(textOf(formatted))),
        model: formatted.model,
      };
    } catch (error) {
      this.logger.error(`Market check failed: ${String(error)}`);
      throw new ServiceUnavailableException(explain(error, this.config));
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
