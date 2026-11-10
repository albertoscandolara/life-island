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
  isAiToolEnabled,
  recordAiToolUse,
  stepUsage,
  type AiToolDescription,
  type ServiceDb,
} from '@life-island/be-common';
import {
  ID_DOCUMENT_TYPE_LABELS,
  renewalGuideOutputSchema,
  type AiStepUsage,
  type IdDocumentType,
  type RenewalGuideOutput,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type PeopleConfig } from '../config.js';

/** The AI tool of People (AI_TOOLS in libs/contracts settings.ts). */
export const RENEWAL_GUIDE_TOOL = 'people.renewal-guide';
const SERVICE = 'svc-people';

/** What the guide is about: only the document type, the town and the age band are sent. */
export interface RenewalRequest {
  type: IdDocumentType;
  town: string;
  /** Whether the holder is a minor: the rules differ. */
  minor: boolean;
  expiryDate: string | null;
}

export interface WrittenGuide {
  output: RenewalGuideOutput;
  model: string;
}

/**
 * Writes the renewal guide of one document in one town: Claude searches the
 * web, then turns its notes into the structured guide (structured output
 * cannot carry the search's citations, so that is a second, tool-free call).
 * With no key, or with the tool off in Settings, the page shows Life Island's
 * own checklist instead.
 */
@Injectable()
export class RenewalAdvisor implements OnApplicationBootstrap {
  private readonly logger = new Logger(RenewalAdvisor.name);
  private readonly client: Anthropic | null;

  constructor(
    @Inject(CONFIG) private readonly config: PeopleConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 })
      : null;
  }

  /** Whether the guide calls the model now: a key, and its switch in Settings. */
  async usesAi(): Promise<boolean> {
    return (
      this.client !== null &&
      (await isAiToolEnabled(
        this.svc.pool,
        this.svc.schema,
        RENEWAL_GUIDE_TOOL,
      ))
    );
  }

  /** Tells Settings how the guide calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      SERVICE,
      describePeopleTools(this.config, this.client !== null),
    ).catch((error: unknown) =>
      this.logger.warn(`Could not describe the AI tools: ${String(error)}`),
    );
  }

  private async record(steps: AiStepUsage[], error?: unknown): Promise<void> {
    await recordAiToolUse(this.svc.pool, this.svc.schema, {
      toolId: RENEWAL_GUIDE_TOOL,
      service: SERVICE,
      outcome: error ? 'error' : 'ok',
      error: error ? String(error) : null,
      steps,
    }).catch((failure: unknown) =>
      this.logger.warn(
        `Could not record a use of ${RENEWAL_GUIDE_TOOL}: ${String(failure)}`,
      ),
    );
  }

  async write(request: RenewalRequest): Promise<WrittenGuide> {
    if (!this.client)
      throw new ServiceUnavailableException(
        'The renewal guide searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-people.',
      );
    if (!(await this.usesAi()))
      throw new ServiceUnavailableException(
        'The renewal guide is turned off in Settings → AI tools. Turn it on there to run it.',
      );
    const client = this.client;
    const steps: AiStepUsage[] = [];
    const question = renewalQuestion(request);
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: question },
      ];
      let research: Anthropic.Message | null = null;
      for (let turn = 0; turn < 4; turn++) {
        const started = Date.now();
        research = await client.messages.create({
          model: this.config.guideModel,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          system: GUIDE_RESEARCH,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
          ],
          messages,
        });
        steps.push(stepUsage('research', research, Date.now() - started));
        if (research.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: research.content });
      }
      if (!research || research.stop_reason === 'pause_turn')
        throw new GuideError(
          'The web search took too long. Try again in a moment.',
        );
      if (research.stop_reason === 'refusal')
        throw new GuideError('Claude declined to write this guide.');
      const notes = textOf(research);
      if (!notes.trim())
        throw new GuideError(
          'The web search found nothing to report. Try a nearby larger town.',
        );

      const formatStarted = Date.now();
      const formatted = await client.messages.create({
        model: this.config.guideModel,
        max_tokens: 8000,
        output_config: {
          effort: 'low',
          format: zodOutputFormat(renewalGuideOutputSchema),
        },
        system: GUIDE_FORMAT,
        messages: [
          {
            role: 'user',
            content: `${question}\n\n<notes>\n${notes}\n</notes>`,
          },
        ],
      });
      steps.push(stepUsage('format', formatted, Date.now() - formatStarted));
      if (formatted.stop_reason === 'refusal')
        throw new GuideError('Claude declined to write this guide.');
      if (formatted.stop_reason === 'max_tokens')
        throw new GuideError(
          'The guide came out too long and was cut. Try again.',
        );
      const output = renewalGuideOutputSchema.parse(
        JSON.parse(textOf(formatted)),
      );
      await this.record(steps);
      return { output, model: formatted.model };
    } catch (error) {
      await this.record(steps, error);
      this.logger.error(`Renewal guide failed: ${String(error)}`);
      throw new ServiceUnavailableException(explain(error, this.config));
    }
  }
}

/** The question sent: the document, the town, adult or minor, and when it expires. */
export function renewalQuestion(request: RenewalRequest): string {
  return [
    `Document: ${ID_DOCUMENT_TYPE_LABELS[request.type]} (Italy)`,
    `Town: ${request.town}`,
    `Holder: ${request.minor ? 'a minor (under 18)' : 'an adult'}`,
    request.expiryDate ? `Current one expires on: ${request.expiryDate}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

/**
 * How the People tool calls the model, as the info button in Settings shows
 * it: the same prompts, model and limits the calls above send.
 */
export function describePeopleTools(
  config: Pick<PeopleConfig, 'guideModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    {
      toolId: RENEWAL_GUIDE_TOOL,
      available,
      steps: [
        {
          stepId: 'research',
          label: 'Search the web',
          model: config.guideModel,
          effort: 'medium',
          maxTokens: 16000,
          thinking: 'adaptive (default)',
          tools: ['web_search (up to 6 searches)'],
          system: GUIDE_RESEARCH,
          userTemplate:
            'Document: {identity card, passport, driving licence or health card} (Italy)\nTown: {town}\nHolder: {an adult, or a minor (under 18)}\nCurrent one expires on: {date}',
          outputFormat: null,
          promptCaching: false,
        },
        {
          stepId: 'format',
          label: 'Structure the guide',
          model: config.guideModel,
          effort: 'low',
          maxTokens: 8000,
          thinking: 'adaptive (default)',
          tools: [],
          system: GUIDE_FORMAT,
          userTemplate:
            '{the question above}\n\n<notes>\n{the notes of the web search}\n</notes>',
          outputFormat: 'renewalGuideOutput (structured output)',
          promptCaching: false,
        },
      ],
    },
  ];
}

const GUIDE_RESEARCH = `You help someone in Italy renew one ID document in their town. Search the web for the current, official procedure: the office that handles it for that town (Comune, Questura or police station, Polis post office, medico certificatore, ASL or Agenzia delle Entrate), its address, how to book and the booking page, what to bring, every fee with its amount in euros, how early one can start, and how long the new document takes to arrive. Prefer official sources (the Comune's site, poliziadistato.it, interno.gov.it, ilportaledellautomobilista.it, agenziaentrate.gov.it) over blogs. When the holder is a minor, include what changes (parents' consent, validity). For each source write its name and exact URL. Never invent an address, a fee or a link: say when you could not find one.`;

const GUIDE_FORMAT = `Turn these research notes into the requested JSON. Write in English, short and practical: a two-sentence summary, the office (null address or booking URL when the notes do not give one), the steps in order, the list of what to bring, each fee with its amount in euros (null when unknown), the timing, and every source with its URL exactly as in the notes.`;

class GuideError extends Error {}

/** What went wrong, in words you can act on. */
export function explain(
  error: unknown,
  config: Pick<PeopleConfig, 'guideModel'>,
): string {
  if (error instanceof GuideError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return 'The Claude API refused the key: check ANTHROPIC_API_KEY in .env and restart svc-people.';
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'The Claude API key has no access to this model or to web search. Check the key in the Claude Console.';
  if (error instanceof Anthropic.NotFoundError)
    return `The Claude API does not know the model "${config.guideModel}": check PEOPLE_GUIDE_MODEL in .env.`;
  if (error instanceof Anthropic.RateLimitError)
    return 'The Claude API rate limit was reached. Try again in a minute.';
  if (error instanceof Anthropic.BadRequestError)
    return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return 'svc-people could not reach the Claude API: check the network or proxy.';
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
    return 'The Claude API is busy or down right now. Try again in a moment.';
  if (error instanceof SyntaxError)
    return 'The Claude API answered, but not in the expected format. Try again.';
  return 'The Claude API could not write the guide right now. Try again in a moment.';
}
