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
 * with Life Island's own rules, so the area works with no key at all. The
 * market check searches the web, so it needs the API.
 */
@Injectable()
export class CareerAdvisor implements OnApplicationBootstrap {
  private readonly feedbackAi: AiAssistant;
  private readonly marketAi: AiAssistant;

  constructor(
    @Inject(CONFIG) config: WorkConfig,
    @Inject(SERVICE_DB) svc: ServiceDb,
  ) {
    const common = {
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.feedbackModel,
      svc,
    };
    this.feedbackAi = new AiAssistant({ ...common, toolId: FEEDBACK_TOOL });
    this.marketAi = new AiAssistant({ ...common, toolId: MARKET_CHECK_TOOL });
  }

  /** Whether a tool calls the model now: a key, its switches and the budget. */
  usesAi(toolId: string = FEEDBACK_TOOL): Promise<boolean> {
    return (
      toolId === MARKET_CHECK_TOOL ? this.marketAi : this.feedbackAi
    ).active();
  }

  /** Tells Settings how each Work tool calls the model, for its info button. */
  async onApplicationBootstrap(): Promise<void> {
    await this.feedbackAi.describe([FEEDBACK_STEP]);
    await this.marketAi.describe([RESEARCH_STEP, FORMAT_STEP]);
  }

  async write(
    input: CareerDossierInput,
    question: string | null,
  ): Promise<WrittenFeedback> {
    if (!(await this.feedbackAi.active()))
      return {
        output: offlineFeedback(input, question),
        source: 'offline',
        model: null,
      };
    const { output, model } = await this.feedbackAi.ask({
      step: FEEDBACK_STEP,
      user: `<dossier>\n${careerDossier(input)}\n</dossier>\n\n${
        question ? `My question: ${question}` : DEFAULT_QUESTION
      }`,
      output: careerFeedbackOutputSchema,
    });
    return { output, source: 'claude', model };
  }

  /**
   * Public salary ranges for your role: Claude searches the web and writes
   * notes, then turns them into the structured check (structured output
   * cannot carry the search's citations, so it is a second, tool-free call).
   */
  async marketCheck(profile: MarketProfile): Promise<WrittenMarketCheck> {
    if (!this.marketAi.configured)
      throw new ServiceUnavailableException(
        'The market check searches the web with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-work.',
      );
    if (!(await this.marketAi.active()))
      throw new ServiceUnavailableException(
        'The market check is turned off in Settings → AI tools. Turn it on there to run it.',
      );
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
    return this.marketAi.research({
      research: { step: RESEARCH_STEP, user: person, maxSearches: 8 },
      format: {
        step: FORMAT_STEP,
        user: (notes) => `${person}\n\n<notes>\n${notes}\n</notes>`,
        output: marketCheckOutputSchema,
      },
    });
  }
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

/** How the Work tools call the model, as the info button in Settings shows it. */
export function describeWorkTools(
  config: Pick<WorkConfig, 'feedbackModel'>,
  available: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(FEEDBACK_TOOL, available, config.feedbackModel, [
      FEEDBACK_STEP,
    ]),
    describeAiSteps(MARKET_CHECK_TOOL, available, config.feedbackModel, [
      RESEARCH_STEP,
      FORMAT_STEP,
    ]),
  ];
}

const MARKET_RESEARCH = `You research Italian salary ranges for one person. Search the web for recent public figures (salary surveys, job boards, recruiter reports, collective agreement tables) for the role, area and seniority given, in gross yearly pay (RAL) in euros. For each source write: its name, the exact URL, what the figures cover (role, seniority, area, year) and the low, median and high RAL it gives. Copy figures as published; convert monthly figures to yearly over the months the source says (13 or 14 when it does not). Never invent a figure: leave out a source whose page you could not read. Then say in two or three sentences where the person's RAL stands against these ranges, and give two to four concrete next steps.`;

const MARKET_FORMAT = `Turn these research notes into the requested JSON. Keep every source with its URL and figures exactly as in the notes; use null for a figure the notes do not give. Set position to below, within or above when the person's RAL can be set against the ranges, else unknown.`;

// Thinking is on by default and counts against max_tokens: 4000 left the
// feedback cut mid-JSON once the dossier grew.
const FEEDBACK_STEP: AiAssistantStep = {
  stepId: 'feedback',
  label: 'Write the feedback',
  system: FEEDBACK_INSTRUCTIONS,
  userTemplate: `<dossier>\n{your approved workplaces, payslips, evaluations, contracts, goals and pay statistics, as text}\n</dossier>\n\n{My question: <your question>, or: ${DEFAULT_QUESTION}}`,
  outputFormat: 'careerFeedbackOutput',
  effort: 'medium',
  maxTokens: 16000,
};

const RESEARCH_STEP: AiAssistantStep = {
  stepId: 'research',
  label: 'Search the web',
  system: MARKET_RESEARCH,
  userTemplate:
    'Role: {role}\nArea: {area}\nLevel: {level}\nCollective agreement: {CCNL}\nSector: {sector}\nYears of experience: {years}\nCurrent RAL: {RAL} euros',
  outputFormat: null,
  effort: 'medium',
  maxTokens: 16000,
  tools: ['web_search (up to 8 searches)'],
};

const FORMAT_STEP: AiAssistantStep = {
  stepId: 'format',
  label: 'Structure the findings',
  system: MARKET_FORMAT,
  userTemplate:
    '{the profile above}\n\n<notes>\n{the notes of the web search}\n</notes>',
  outputFormat: 'marketCheckOutput',
  effort: 'low',
  maxTokens: 8000,
};
