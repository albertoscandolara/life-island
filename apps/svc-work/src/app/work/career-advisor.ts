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
        max_tokens: 4000,
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
        output_config: { format: zodOutputFormat(careerFeedbackOutputSchema) },
      });
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
      throw new ServiceUnavailableException(
        'The Claude API could not write the feedback right now. Try again in a moment.',
      );
    }
  }
}
