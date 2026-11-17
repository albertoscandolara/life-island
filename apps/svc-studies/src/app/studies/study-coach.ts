import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { AiToolDescription, ServiceDb } from '@life-island/be-common';
import {
  AiAssistant,
  describeAiSteps,
  type AiAssistantStep,
} from '@life-island/be-nest';
import {
  studyPlanOutputSchema,
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

/** The coach's one request, as it is sent and as Settings shows it. */
const PLAN_STEP: AiAssistantStep = {
  stepId: 'plan',
  label: 'Plan the week',
  system: COACH_INSTRUCTIONS,
  userTemplate: `<dossier>\n{the paths you follow with each step's status, your courses, exams ahead, your weeks against the goal and the reminders, as text}\n</dossier>\n\n{My question: <your question>, or: ${DEFAULT_QUESTION}}`,
  outputFormat: 'studyPlanOutput',
  effort: 'low',
  maxTokens: 8000,
};

/**
 * Writes the study plan: with the Claude API when ANTHROPIC_API_KEY is set
 * and the tool is on in Settings, else with Life Island's own rules, so the
 * coach works with no key at all.
 */
@Injectable()
export class StudyCoach implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: StudiesConfig,
    @Inject(SERVICE_DB) svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: COACH_TOOL,
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.coachModel,
      svc,
    });
  }

  /** Whether the coach calls the model now: a key, its switches and the budget. */
  usesAi(): Promise<boolean> {
    return this.ai.active();
  }

  /** Tells Settings how the coach calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([PLAN_STEP]);
  }

  async plan(input: CoachInput, question: string | null): Promise<WrittenPlan> {
    if (!(await this.ai.active()))
      return {
        output: offlinePlan(input, question),
        source: 'offline',
        model: null,
      };
    const { output, model } = await this.ai.ask({
      step: PLAN_STEP,
      user: `<dossier>\n${coachDossier(input)}\n</dossier>\n\n${
        question ? `My question: ${question}` : DEFAULT_QUESTION
      }`,
      output: studyPlanOutputSchema,
    });
    return { output, source: 'claude', model };
  }
}

/** How the coach calls the model, as the info button in Settings shows it. */
export function describeStudiesTools(
  config: Pick<StudiesConfig, 'coachModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(COACH_TOOL, available, config.coachModel, [PLAN_STEP]),
  ];
}
