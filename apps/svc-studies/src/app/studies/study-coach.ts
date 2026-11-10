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
  aiToolModel,
  describeAiTools,
  isAiToolEnabled,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  studyPlanOutputSchema,
  type AiStepUsage,
  type StudyPlanOutput,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type StudiesConfig } from '../config.js';
import {
  COACH_INSTRUCTIONS,
  coachDossier,
  offlinePlan,
  type CoachInput,
} from './coach.js';

/** The AI tool of Studies (AI_TOOLS in libs/contracts settings.ts). */
export const COACH_TOOL = 'studies.study-coach';
const SERVICE = 'svc-studies';

export interface WrittenPlan {
  output: StudyPlanOutput;
  source: 'claude' | 'offline';
  model: string | null;
}

const DEFAULT_QUESTION = 'Plan my study week.';

/**
 * Writes the study plan: with the Claude API when ANTHROPIC_API_KEY is set
 * and the tool is on in Settings, else with Life Island's own rules, so the
 * coach works with no key at all.
 */
@Injectable()
export class StudyCoach implements OnApplicationBootstrap {
  private readonly logger = new Logger(StudyCoach.name);
  private readonly client: Anthropic | null;

  constructor(
    @Inject(CONFIG) private readonly config: StudiesConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  /** Whether the coach calls the model now: a key, and its switch in Settings. */
  async usesAi(): Promise<boolean> {
    return (
      this.client !== null &&
      (await isAiToolEnabled(this.svc.pool, this.svc.schema, COACH_TOOL))
    );
  }

  /** Tells Settings how the coach calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      SERVICE,
      describeStudiesTools(this.config, this.client !== null),
    ).catch((error: unknown) =>
      this.logger.warn(`Could not describe the AI tools: ${String(error)}`),
    );
  }

  async plan(input: CoachInput, question: string | null): Promise<WrittenPlan> {
    if (!this.client || !(await this.usesAi()))
      return {
        output: offlinePlan(input, question),
        source: 'offline',
        model: null,
      };
    const model =
      (await aiToolModel(this.svc.pool, this.svc.schema, COACH_TOOL)) ??
      this.config.coachModel;
    const steps: AiStepUsage[] = [];
    try {
      const started = Date.now();
      const message = await this.client.messages.create({
        model,
        max_tokens: 8000,
        output_config: {
          effort: 'low',
          format: zodOutputFormat(studyPlanOutputSchema),
        },
        system: [
          {
            type: 'text',
            text: COACH_INSTRUCTIONS,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `<dossier>\n${coachDossier(input)}\n</dossier>\n\n${
              question ? `My question: ${question}` : DEFAULT_QUESTION
            }`,
          },
        ],
      });
      steps.push(stepUsage('plan', message, Date.now() - started));
      if (message.stop_reason === 'refusal')
        throw new CoachError(
          'Claude declined to write this plan. Try rephrasing your question.',
        );
      if (message.stop_reason === 'max_tokens')
        throw new CoachError(
          'The plan came out too long and was cut. Try again, or ask a narrower question.',
        );
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      const output = studyPlanOutputSchema.parse(JSON.parse(text));
      await this.record(steps);
      return { output, source: 'claude', model: message.model };
    } catch (error) {
      await this.record(steps, error);
      this.logger.error(`Study plan failed: ${String(error)}`);
      throw new ServiceUnavailableException(explain(error, model));
    }
  }

  private async record(steps: AiStepUsage[], error?: unknown): Promise<void> {
    await recordAiToolUse(this.svc.pool, this.svc.schema, {
      toolId: COACH_TOOL,
      service: SERVICE,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(
        `Could not record a use of ${COACH_TOOL}: ${String(failure)}`,
      ),
    );
  }
}

/** How the coach calls the model, as the info button in Settings shows it. */
export function describeStudiesTools(
  config: Pick<StudiesConfig, 'coachModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    {
      toolId: COACH_TOOL,
      available,
      steps: [
        {
          stepId: 'plan',
          label: 'Plan the week',
          model: config.coachModel,
          effort: 'low',
          maxTokens: 8000,
          thinking: 'adaptive (default)',
          tools: [],
          system: COACH_INSTRUCTIONS,
          userTemplate: `<dossier>\n{the paths you follow with each step's status, your courses, exams ahead, your weeks against the goal and the reminders, as text}\n</dossier>\n\n{My question: <your question>, or: ${DEFAULT_QUESTION}}`,
          outputFormat: 'studyPlanOutput (structured output)',
          promptCaching: true,
        },
      ],
    },
  ];
}

class CoachError extends Error {}

/** What went wrong, in words you can act on. */
export function explain(error: unknown, model: string): string {
  if (error instanceof CoachError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return 'The Claude API refused the key: check ANTHROPIC_API_KEY in .env and restart svc-studies.';
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'The Claude API key has no access to this model. Check the key in the Claude Console.';
  if (error instanceof Anthropic.NotFoundError)
    return `The Claude API does not know the model "${model}": pick another in Settings → AI tools.`;
  if (error instanceof Anthropic.RateLimitError)
    return 'The Claude API rate limit was reached. Try again in a minute.';
  if (error instanceof Anthropic.APIConnectionError)
    return 'svc-studies could not reach the Claude API: check the network or proxy.';
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
    return 'The Claude API is busy or down right now. Try again in a moment.';
  if (error instanceof SyntaxError)
    return 'The Claude API answered, but not in the expected format. Try again.';
  return 'The Claude API could not write the plan right now. Try again in a moment.';
}
