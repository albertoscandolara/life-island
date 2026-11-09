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
  type CareerFeedbackOutput,
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
}

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
