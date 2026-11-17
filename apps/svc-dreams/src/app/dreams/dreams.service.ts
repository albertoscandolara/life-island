import {
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant, requireRow } from '@life-island/be-nest';
import {
  deadlineWindow,
  dreamQuestionsOutputSchema,
  dreamStepsOutputSchema,
  inDeadlineWindow,
  isoToday,
  type DeadlineDto,
  type DeadlinesQuery,
  type DreamAnswerRequest,
  type DreamCheckInDto,
  type DreamCheckInRequest,
  type DreamContextDto,
  type DreamDto,
  type DreamQuestionDto,
  type DreamsOverviewDto,
  type DreamStepDto,
  type DreamStepStatus,
  type DreamSuggestRequest,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  dreamCheckIns,
  dreamGuidance,
  dreamQuestions,
  dreams,
  dreamSteps,
  type DreamCheckInRow,
  type DreamGuidanceRow,
  type DreamQuestionRow,
  type DreamRow,
  type DreamStepRow,
} from '../db/schema.js';
import { readDreamContext } from './context.js';
import {
  clampSteps,
  offlineQuestions,
  offlineSteps,
  QUESTIONS_INSTRUCTIONS,
  questionsDossier,
  reachOf,
  STEPS_INSTRUCTIONS,
  stepsDossier,
} from './guide.js';

/** The AI tools of Dreams (AI_TOOLS in libs/contracts settings.ts). */
export const QUESTIONS_TOOL = 'dreams.questions';
export const STEPS_TOOL = 'dreams.steps';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const QUESTIONS_STEP = {
  stepId: 'questions',
  label: 'Ask first',
  system: QUESTIONS_INSTRUCTIONS,
  userTemplate:
    '<dream>{the dream, its area, in your words, why, where you are today, what scares you, what you cannot put at risk}</dream>',
  outputFormat: 'dreamQuestionsOutput',
  effort: 'low' as const,
  maxTokens: 4000,
};

const STEPS_STEP = {
  stepId: 'steps',
  label: 'Suggest small steps',
  system: STEPS_INSTRUCTIONS,
  userTemplate:
    'Today is {date}.\n<dream>{the dream, its fields and pace}</dream>\n<answers>{your answers}</answers>\n<steps>{steps chosen, done, skipped or set aside}</steps>\n<check-ins>{the last 6: how each felt, the pace asked next, your note}</check-ins>\n<their life>{only the areas you ticked: a few facts each, no names}</their life>\nSuggest {n} steps. Furthest stretch allowed now: {stretch}. {why}\n{They add: <your note>}',
  outputFormat: 'dreamStepsOutput',
  effort: 'medium' as const,
  maxTokens: 8000,
};

const STEP_ORDER: Record<DreamStepStatus, number> = {
  chosen: 0,
  suggested: 1,
  done: 2,
  skipped: 3,
  dismissed: 4,
};

const iso = (d: Date) => d.toISOString();

interface DreamState {
  dream: DreamRow;
  dto: DreamDto;
}

@Injectable()
export class DreamsService implements OnApplicationBootstrap {
  private readonly questionsAi: AiAssistant;
  private readonly stepsAi: AiAssistant;

  constructor(
    @Inject(CONFIG) private readonly config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    const common = {
      service: 'svc-dreams',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    };
    this.questionsAi = new AiAssistant({ ...common, toolId: QUESTIONS_TOOL });
    this.stepsAi = new AiAssistant({ ...common, toolId: STEPS_TOOL });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.questionsAi.describe([QUESTIONS_STEP]);
    await this.stepsAi.describe([STEPS_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  /** Every dream with its questions, steps, check-ins and latest guidance. */
  private async states(only?: string): Promise<DreamState[]> {
    const byDream = only ? eq(dreams.id, only) : undefined;
    const [dreamRows, questionRows, stepRows, checkInRows, guidanceRows] =
      await Promise.all([
        this.db
          .select()
          .from(dreams)
          .where(byDream)
          .orderBy(desc(dreams.updatedAt)),
        this.db
          .select()
          .from(dreamQuestions)
          .where(only ? eq(dreamQuestions.dreamId, only) : undefined)
          .orderBy(asc(dreamQuestions.position), asc(dreamQuestions.createdAt)),
        this.db
          .select()
          .from(dreamSteps)
          .where(only ? eq(dreamSteps.dreamId, only) : undefined)
          .orderBy(asc(dreamSteps.createdAt)),
        this.db
          .select()
          .from(dreamCheckIns)
          .where(only ? eq(dreamCheckIns.dreamId, only) : undefined)
          .orderBy(desc(dreamCheckIns.createdAt)),
        this.db
          .select()
          .from(dreamGuidance)
          .where(only ? eq(dreamGuidance.dreamId, only) : undefined)
          .orderBy(desc(dreamGuidance.createdAt)),
      ]);
    return dreamRows.map((dream) => ({
      dream,
      dto: toDreamDto(
        dream,
        questionRows.filter((q) => q.dreamId === dream.id),
        stepRows.filter((s) => s.dreamId === dream.id),
        checkInRows.filter((c) => c.dreamId === dream.id),
        guidanceRows.find((g) => g.dreamId === dream.id) ?? null,
      ),
    }));
  }

  private async state(id: string): Promise<DreamState> {
    const [found] = await this.states(id);
    if (!found) throw new NotFoundException('There is no such dream');
    return found;
  }

  async overview(day = today()): Promise<DreamsOverviewDto> {
    const [all, aiQuestions, aiSteps] = await Promise.all([
      this.states(),
      this.questionsAi.active(),
      this.stepsAi.active(),
    ]);
    const order = {
      moving: 0,
      dreaming: 1,
      paused: 2,
      reached: 3,
      'let-go': 4,
    };
    return {
      today: day,
      dreams: all
        .map((s) => s.dto)
        .sort((a, b) => order[a.status] - order[b.status]),
      aiQuestions,
      aiSteps,
    };
  }

  /** The dates you gave chosen steps, for the Agenda. */
  async deadlines(
    query: DeadlinesQuery,
    day = today(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const out: DeadlineDto[] = [];
    for (const { dto } of await this.states())
      for (const s of dto.steps)
        if (s.status === 'chosen' && inDeadlineWindow(s.dueDate, window))
          out.push({
            id: `dream-step:${s.id}:${s.dueDate}`,
            module: 'dreams',
            kind: 'step',
            title: s.title,
            detail: `A small step towards “${dto.title}”. Moving the date is fine.`,
            date: s.dueDate!,
            amount: null,
            path: '/dreams',
          });
    return out;
  }

  /** The island badge: only steps waiting for their check-in. Dreams never count as late. */
  async attention(): Promise<LifeAttentionDto> {
    const all = await this.states();
    const items = all.flatMap(({ dto }) =>
      dto.steps
        .filter((s) => s.awaitingCheckIn)
        .map((s) => ({
          id: `check-in:${s.id}`,
          kind: 'check-in',
          title: `How did “${s.title}” go?`,
          detail: `A step towards “${dto.title}”: a short check-in tells the next step.`,
          since: s.doneOn,
          path: '/dreams',
          action: 'Check in',
        })),
    );
    return { expired: 0, expiring: 0, toReview: items.length, items };
  }

  /** What the areas a dream shares say now, as Claude would read it. */
  async context(id: string, day = today()): Promise<DreamContextDto> {
    const { dream } = await this.state(id);
    return readDreamContext(dream.contextAreas, this.config.sources, day);
  }

  /** Asks the questions again: answered ones stay, unanswered ones are replaced. */
  async askQuestions(id: string): Promise<DreamDto> {
    const { dto } = await this.state(id);
    let output;
    let source: 'claude' | 'offline' = 'offline';
    if (await this.questionsAi.active()) {
      const answer = await this.questionsAi.ask({
        step: QUESTIONS_STEP,
        output: dreamQuestionsOutputSchema,
        user: `${questionsDossier(dto)}${
          dto.questions.some((q) => q.answer)
            ? `\n<already answered>\n${dto.questions
                .filter((q) => q.answer)
                .map((q) => `- ${q.question}: ${q.answer}`)
                .join('\n')}\n</already answered>`
            : ''
        }`,
      });
      output = answer.output;
      source = 'claude';
    } else output = offlineQuestions(dto);
    const answered = dto.questions.filter((q) => q.answer);
    await this.db.transaction(async (tx) => {
      await tx.delete(dreamQuestions).where(
        answered.length
          ? and(
              eq(dreamQuestions.dreamId, id),
              notInArray(
                dreamQuestions.id,
                answered.map((q) => q.id),
              ),
            )
          : eq(dreamQuestions.dreamId, id),
      );
      const fresh = output.questions
        .slice(0, 5)
        .filter((q) => !answered.some((a) => a.question === q.question));
      if (fresh.length)
        await tx.insert(dreamQuestions).values(
          fresh.map((q, i) => ({
            dreamId: id,
            question: q.question,
            why: q.why,
            source,
            position: answered.length + i,
          })),
        );
      await tx
        .update(dreams)
        .set({ opening: output.opening, updatedAt: new Date() })
        .where(eq(dreams.id, id));
    });
    return (await this.state(id)).dto;
  }

  async answer(questionId: string, request: DreamAnswerRequest): Promise<void> {
    const [row] = await this.db
      .update(dreamQuestions)
      .set({ answer: request.answer ?? null })
      .where(eq(dreamQuestions.id, questionId))
      .returning({ dreamId: dreamQuestions.dreamId });
    if (!row) throw new NotFoundException('There is no such question');
    await this.touch(row.dreamId);
  }

  /** The next small steps: earlier suggestions you did not pick make room for new ones. */
  async suggest(
    id: string,
    request: DreamSuggestRequest,
    day = today(),
  ): Promise<DreamDto> {
    const { dream, dto } = await this.state(id);
    const reach = dto.reach;
    const context = dream.contextAreas.length
      ? await readDreamContext(dream.contextAreas, this.config.sources, day)
      : null;
    let output;
    let source: 'claude' | 'offline' = 'offline';
    let model: string | null = null;
    // Earlier suggestions are replaced, so they do not count as steps taken.
    const kept = dto.steps.filter((s) => s.status !== 'suggested');
    if (await this.stepsAi.active()) {
      const answer = await this.stepsAi.ask({
        step: STEPS_STEP,
        output: dreamStepsOutputSchema,
        user: stepsDossier(
          day,
          dto,
          dto.questions,
          kept,
          dto.checkIns,
          reach,
          context,
          request.note?.trim() || null,
        ),
      });
      output = clampSteps(answer.output, reach);
      source = 'claude';
      model = answer.model;
    } else output = offlineSteps(dto, kept, reach, context?.safetyNet ?? null);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(dreamSteps)
        .where(
          and(eq(dreamSteps.dreamId, id), eq(dreamSteps.status, 'suggested')),
        );
      if (output.steps.length)
        await tx.insert(dreamSteps).values(
          output.steps.map((s) => ({
            dreamId: id,
            title: s.title,
            kind: s.kind,
            why: s.why,
            minutes: s.minutes,
            costEuro: s.costEuro,
            cost: s.cost.trim() || null,
            stretch: s.stretch,
            undo: s.undo,
            smaller: s.smaller,
            status: 'suggested' as const,
            source,
          })),
        );
      await tx.insert(dreamGuidance).values({
        dreamId: id,
        reflection: output.reflection,
        notYet: output.notYet,
        care: output.care,
        source,
        model,
      });
      const old = await tx
        .select({ id: dreamGuidance.id })
        .from(dreamGuidance)
        .where(eq(dreamGuidance.dreamId, id))
        .orderBy(desc(dreamGuidance.createdAt))
        .offset(5);
      if (old.length)
        await tx.delete(dreamGuidance).where(
          inArray(
            dreamGuidance.id,
            old.map((o) => o.id),
          ),
        );
      await tx
        .update(dreams)
        .set({ updatedAt: new Date() })
        .where(eq(dreams.id, id));
    });
    return (await this.state(id)).dto;
  }

  /** How a step went: it is marked done or set aside, and the next round follows the pace. */
  async checkIn(request: DreamCheckInRequest, day = today()): Promise<void> {
    await requireRow(this.db, dreams, request.dreamId, 'Dream');
    if (request.stepId) {
      const [step] = await this.db
        .select()
        .from(dreamSteps)
        .where(eq(dreamSteps.id, request.stepId));
      if (!step || step.dreamId !== request.dreamId)
        throw new NotFoundException('There is no such step in this dream');
      if (request.outcome)
        await this.db
          .update(dreamSteps)
          .set({
            status: request.outcome,
            doneOn: request.outcome === 'done' ? (step.doneOn ?? day) : null,
          })
          .where(eq(dreamSteps.id, step.id));
    }
    await this.db.insert(dreamCheckIns).values({
      dreamId: request.dreamId,
      stepId: request.stepId ?? null,
      outcome: request.stepId ? (request.outcome ?? null) : null,
      feeling: request.feeling,
      note: request.note ?? null,
      nextPace: request.nextPace ?? 'same',
    });
    await this.db
      .update(dreams)
      .set({ updatedAt: new Date() })
      .where(eq(dreams.id, request.dreamId));
    await this.db
      .update(dreams)
      .set({ status: 'moving' })
      .where(
        and(eq(dreams.id, request.dreamId), eq(dreams.status, 'dreaming')),
      );
  }

  /** Picks a suggestion, sets one aside or brings it back; the dream starts moving with its first chosen step. */
  async setStepStatus(
    id: string,
    status: DreamStepStatus,
    day = today(),
  ): Promise<void> {
    const [step] = await this.db
      .update(dreamSteps)
      .set({ status, doneOn: status === 'done' ? day : null })
      .where(eq(dreamSteps.id, id))
      .returning({ dreamId: dreamSteps.dreamId });
    if (!step) throw new NotFoundException('There is no such step');
    await this.touch(step.dreamId);
    if (status === 'chosen' || status === 'done')
      await this.db
        .update(dreams)
        .set({ status: 'moving' })
        .where(and(eq(dreams.id, step.dreamId), eq(dreams.status, 'dreaming')));
  }

  async removeCheckIn(id: string): Promise<void> {
    await this.db.delete(dreamCheckIns).where(eq(dreamCheckIns.id, id));
  }

  private async touch(dreamId: string): Promise<void> {
    await this.db
      .update(dreams)
      .set({ updatedAt: new Date() })
      .where(eq(dreams.id, dreamId));
  }
}

export function toDreamDto(
  dream: DreamRow,
  questions: readonly DreamQuestionRow[],
  steps: readonly DreamStepRow[],
  checkIns: readonly DreamCheckInRow[],
  guidance: DreamGuidanceRow | null,
): DreamDto {
  const { updatedAt: _, opening, ...fields } = dream;
  const checked = new Set(checkIns.map((c) => c.stepId).filter(Boolean));
  const stepDtos: DreamStepDto[] = steps
    .map((s) => ({
      ...s,
      createdAt: iso(s.createdAt),
      awaitingCheckIn:
        (s.status === 'done' || s.status === 'skipped') && !checked.has(s.id),
    }))
    .sort(
      (a, b) =>
        STEP_ORDER[a.status] - STEP_ORDER[b.status] ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const titles = new Map(steps.map((s) => [s.id, s.title]));
  const checkInDtos: DreamCheckInDto[] = checkIns.map((c) => ({
    ...c,
    createdAt: iso(c.createdAt),
    stepTitle: c.stepId ? (titles.get(c.stepId) ?? null) : null,
  }));
  const questionDtos: DreamQuestionDto[] = questions.map((q) => ({
    id: q.id,
    dreamId: q.dreamId,
    question: q.question,
    why: q.why,
    answer: q.answer,
    source: q.source,
    createdAt: iso(q.createdAt),
  }));
  return {
    ...fields,
    createdAt: iso(dream.createdAt),
    opening,
    questions: questionDtos,
    steps: stepDtos,
    checkIns: checkInDtos,
    guidance: guidance
      ? {
          reflection: guidance.reflection,
          notYet: guidance.notYet,
          care: guidance.care,
          source: guidance.source,
          model: guidance.model,
          createdAt: iso(guidance.createdAt),
        }
      : null,
    nextStep: stepDtos.find((s) => s.status === 'chosen') ?? null,
    doneSteps: stepDtos.filter((s) => s.status === 'done').length,
    unansweredQuestions: questionDtos.filter((q) => !q.answer).length,
    reach: reachOf(dream, checkInDtos),
  };
}
