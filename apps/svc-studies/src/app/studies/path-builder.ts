import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { AiToolDescription, ServiceDb } from '@life-island/be-common';
import {
  AiAssistant,
  describeAiSteps,
  type AiAssistantStep,
} from '@life-island/be-nest';
import {
  pathBuilderOutputSchema,
  STUDY_PATH_BUILDER_TOOL,
  type PathBuilderRequest,
  type PathOutlineRequest,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type StudiesConfig } from '../config.js';
import {
  BUILDER_FORMAT,
  BUILDER_RESEARCH,
  builderOutline,
  builderRequest,
} from './builder.js';

const SERVICE = 'svc-studies';

const RESEARCH_STEP: AiAssistantStep = {
  stepId: 'research',
  label: 'Search the web',
  system: BUILDER_RESEARCH,
  userTemplate:
    'Today: {date}\nTopic: {your topic}\nWhere I start: {New to it, I know the basics, or I use it every day}\nWhere I want to get: {your goal, if you gave one}\nTime I can give it: {hours a week, if you gave them}',
  outputFormat: null,
  effort: 'medium',
  maxTokens: 16000,
  tools: ['web_search (up to 10 searches)'],
};

const FORMAT_STEP: AiAssistantStep = {
  stepId: 'format',
  label: 'Lay out the path',
  system: BUILDER_FORMAT,
  userTemplate: '{the same request}\n\n<notes>\n{the research notes}\n</notes>',
  outputFormat: 'pathBuilderOutput',
  effort: 'low',
  maxTokens: 16000,
};

/**
 * The path builder (AI tool studies.path-builder): drafts a path in four
 * levels for a topic you name, with the Claude API and web search. The draft
 * is not saved: it opens in the path editor for you to change and add.
 */
@Injectable()
export class PathBuilder implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: StudiesConfig,
    @Inject(SERVICE_DB) svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: STUDY_PATH_BUILDER_TOOL,
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.coachModel,
      svc,
    });
  }

  /** Whether the builder can draft now: a key, its switches and the budget. */
  usesAi(): Promise<boolean> {
    return this.ai.active();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([RESEARCH_STEP, FORMAT_STEP]);
  }

  async draft(
    request: PathBuilderRequest,
    today: string,
  ): Promise<{ outline: PathOutlineRequest; model: string }> {
    if (!(await this.ai.active()))
      throw new ServiceUnavailableException(
        this.ai.configured
          ? 'The path builder is turned off in Settings → AI tools. Turn it on there, or start from a curated path or your own.'
          : 'The path builder searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-studies.',
      );
    const user = builderRequest(request, today);
    let notes = '';
    const { output, model } = await this.ai.research({
      research: { step: RESEARCH_STEP, user, maxSearches: 10 },
      format: {
        step: FORMAT_STEP,
        user: (found) => {
          notes = found;
          return `${user}\n\n<notes>\n${found}\n</notes>`;
        },
        output: pathBuilderOutputSchema,
      },
    });
    return { outline: builderOutline(output, notes), model };
  }
}

/** How the builder calls the model, as the info button in Settings shows it. */
export function describePathBuilder(
  config: Pick<StudiesConfig, 'coachModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(STUDY_PATH_BUILDER_TOOL, available, config.coachModel, [
      RESEARCH_STEP,
      FORMAT_STEP,
    ]),
  ];
}
