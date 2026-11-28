import {
  Inject,
  Injectable,
  Logger,
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
  RECALL_QUESTIONS_PER_STEP,
  recallQuizOutputSchema,
  STUDY_RECALL_TOOL,
  STUDY_TEACH_BACK_TOOL,
  teachBackOutputSchema,
  type TeachBackDto,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type StudiesConfig } from '../config.js';
import {
  offlineCard,
  RECALL_INSTRUCTIONS,
  TEACH_BACK_INSTRUCTIONS,
} from './recall.js';

const SERVICE = 'svc-studies';

const QUESTIONS_STEP: AiAssistantStep = {
  stepId: 'questions',
  label: 'Write the questions',
  system: RECALL_INSTRUCTIONS,
  userTemplate:
    '<step>\n{path, stage, step, what it covers and what you can do after it}\n</step>\n\n<notes>\n{your notes on the step, if any}\n</notes>',
  outputFormat: 'recallQuizOutput',
  effort: 'low',
  maxTokens: 2000,
};

const REVIEW_STEP: AiAssistantStep = {
  stepId: 'review',
  label: 'Review the explanation',
  system: TEACH_BACK_INSTRUCTIONS,
  userTemplate:
    '<step>\n{path, stage, step, what it covers and what you can do after it}\n</step>\n\n<explanation>\n{your explanation}\n</explanation>',
  outputFormat: 'teachBackOutput',
  effort: 'low',
  maxTokens: 3000,
};

export interface RecallQuestion {
  question: string;
  answer: string;
}

/**
 * The recall quiz (studies.recall-quiz) and teach-back (studies.teach-back):
 * questions for a finished step, and a review of a step you explained.
 */
@Injectable()
export class RecallCoach implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecallCoach.name);
  private readonly quiz: AiAssistant;
  private readonly teach: AiAssistant;

  constructor(
    @Inject(CONFIG) config: StudiesConfig,
    @Inject(SERVICE_DB) svc: ServiceDb,
  ) {
    const common = {
      service: SERVICE,
      apiKey: config.anthropicApiKey,
      defaultModel: config.coachModel,
      svc,
    };
    this.quiz = new AiAssistant({ toolId: STUDY_RECALL_TOOL, ...common });
    this.teach = new AiAssistant({ toolId: STUDY_TEACH_BACK_TOOL, ...common });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.quiz.describe([QUESTIONS_STEP]);
    await this.teach.describe([REVIEW_STEP]);
  }

  quizUsesAi(): Promise<boolean> {
    return this.quiz.active();
  }

  teachBackUsesAi(): Promise<boolean> {
    return this.teach.active();
  }

  /**
   * Questions for a finished step: the model's when the quiz is on, else
   * one from the step's own outcome. A failed call falls back too, so
   * finishing a step never fails on it.
   */
  async questions(
    material: string,
    notes: string | null,
    fallback: Parameters<typeof offlineCard>[0],
  ): Promise<{ questions: RecallQuestion[]; ai: boolean }> {
    const offline = { questions: [offlineCard(fallback)], ai: false };
    if (!(await this.quiz.active())) return offline;
    try {
      const { output } = await this.quiz.ask({
        step: QUESTIONS_STEP,
        user: `<step>\n${material}\n</step>\n\n<notes>\n${notes?.trim() || 'None.'}\n</notes>`,
        output: recallQuizOutputSchema,
      });
      const questions = output.questions
        .filter((q) => q.question.trim() && q.answer.trim())
        .slice(0, RECALL_QUESTIONS_PER_STEP)
        .map((q) => ({
          question: q.question.trim().slice(0, 500),
          answer: q.answer.trim().slice(0, 1200),
        }));
      return questions.length ? { questions, ai: true } : offline;
    } catch (error) {
      this.logger.warn(`Recall quiz failed, kept one question: ${error}`);
      return offline;
    }
  }

  /** Reviews a step you explained; a 503 that says what to do when off. */
  async teachBack(
    material: string,
    explanation: string,
  ): Promise<TeachBackDto> {
    if (!(await this.teach.active()))
      throw new ServiceUnavailableException(
        this.teach.configured
          ? 'Teach-back is turned off in Settings → AI tools. Turn it on there, or check your explanation against the step’s outcome.'
          : 'Teach-back reviews your explanation with the Claude API: set ANTHROPIC_API_KEY in .env and restart svc-studies.',
      );
    const { output, model } = await this.teach.ask({
      step: REVIEW_STEP,
      user: `<step>\n${material}\n</step>\n\n<explanation>\n${explanation}\n</explanation>`,
      output: teachBackOutputSchema,
    });
    return {
      verdict: output.verdict,
      strengths: output.strengths.slice(0, 3),
      gaps: output.gaps.slice(0, 4),
      next: output.next,
      model,
    };
  }
}

/** How the two tools call the model, as Settings' info button shows them. */
export function describeRecallTools(
  config: Pick<StudiesConfig, 'coachModel'>,
  quiz: boolean,
  teach: boolean,
): AiToolDescription[] {
  return [
    describeAiSteps(STUDY_RECALL_TOOL, quiz, config.coachModel, [
      QUESTIONS_STEP,
    ]),
    describeAiSteps(STUDY_TEACH_BACK_TOOL, teach, config.coachModel, [
      REVIEW_STEP,
    ]),
  ];
}
