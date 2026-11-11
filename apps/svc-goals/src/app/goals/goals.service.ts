import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant, requireRow } from '@life-island/be-nest';
import {
  deadlineWindow,
  goalsCoachOutputSchema,
  inDeadlineWindow,
  isoAddDays,
  isoToday,
  isoWeekStart,
  type DeadlineDto,
  type DeadlinesQuery,
  type GoalsCoachDto,
  type GoalsOverviewDto,
  type HabitCheckRequest,
  type LifeAttentionDto,
  type LifeQuestionRequest,
  type WeeklyReviewRequest,
} from '@life-island/contracts';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  coachAnswers,
  goals,
  goalSteps,
  habitChecks,
  habits,
  weeklyReviews,
  type CoachAnswerRow,
} from '../db/schema.js';
import {
  COACH_INSTRUCTIONS,
  coachDossier,
  offlineCoach,
  withChecks,
  withProgress,
} from './progress.js';

/** The AI tool of Goals (AI_TOOLS in libs/contracts settings.ts). */
export const COACH_TOOL = 'goals.coach';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const COACH_STEP = {
  stepId: 'coach',
  label: 'Coach the goals',
  system: COACH_INSTRUCTIONS,
  userTemplate:
    '{today, the active and paused goals with why, measure, steps and days since the last step, the habits this week, the last 3 weekly reviews}\n\n{My question: <your question>, or: Help me move forward.}',
  outputFormat: 'goalsCoachOutput',
  effort: 'medium' as const,
  maxTokens: 8000,
};

const iso = (d: Date) => d.toISOString();

@Injectable()
export class GoalsService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: COACH_TOOL,
      service: 'svc-goals',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([COACH_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  private async state(day: string) {
    const [goalRows, stepRows, habitRows, checkRows, reviewRows] =
      await Promise.all([
        this.db.select().from(goals).orderBy(desc(goals.createdAt)),
        this.db.select().from(goalSteps),
        this.db.select().from(habits).orderBy(habits.createdAt),
        this.db
          .select()
          .from(habitChecks)
          .where(gte(habitChecks.date, isoAddDays(day, -7 * 26))),
        this.db
          .select()
          .from(weeklyReviews)
          .orderBy(desc(weeklyReviews.weekStart))
          .limit(12),
      ]);
    const steps = stepRows.map((s) => ({ ...s, createdAt: iso(s.createdAt) }));
    const order = { active: 0, paused: 1, done: 2, dropped: 3 };
    return {
      goals: goalRows
        .map(({ updatedAt: _, ...g }) =>
          withProgress({ ...g, createdAt: iso(g.createdAt) }, steps, day),
        )
        .sort((a, b) => order[a.status] - order[b.status]),
      habits: habitRows.map((h) =>
        withChecks(
          { ...h, createdAt: iso(h.createdAt) },
          checkRows.filter((c) => c.habitId === h.id).map((c) => c.date),
          day,
        ),
      ),
      reviews: reviewRows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    };
  }

  async overview(day = today()): Promise<GoalsOverviewDto> {
    const [state, adviceRows, aiCoach] = await Promise.all([
      this.state(day),
      this.db
        .select()
        .from(coachAnswers)
        .orderBy(desc(coachAnswers.createdAt))
        .limit(5),
      this.ai.active(),
    ]);
    const weekStart = isoWeekStart(day);
    return {
      today: day,
      weekStart,
      ...state,
      reviewedThisWeek: state.reviews.some((r) => r.weekStart === weekStart),
      advice: adviceRows.map(toAdviceDto),
      aiCoach,
    };
  }

  /** The target dates of active goals and the due dates of their open steps. */
  async deadlines(
    query: DeadlinesQuery,
    day = today(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const { goals: all } = await this.state(day);
    const out: DeadlineDto[] = [];
    for (const g of all.filter((g) => g.status === 'active')) {
      if (g.targetDate && inDeadlineWindow(g.targetDate, window))
        out.push({
          id: `goal:${g.id}:${g.targetDate}`,
          module: 'goals',
          kind: 'goal',
          title: `Goal: ${g.title}`,
          detail:
            g.progress === null
              ? 'No steps yet.'
              : `${g.progress}% of the steps done.`,
          date: g.targetDate,
          amount: null,
          path: '/goals',
        });
      for (const s of g.steps.filter(
        (s) => !s.done && s.dueDate && inDeadlineWindow(s.dueDate, window),
      ))
        out.push({
          id: `step:${s.id}:${s.dueDate}`,
          module: 'goals',
          kind: 'step',
          title: s.title,
          detail: `A step of “${g.title}”.`,
          date: s.dueDate!,
          amount: null,
          path: '/goals',
        });
    }
    return out;
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const state = await this.state(day);
    const active = state.goals.filter((g) => g.status === 'active');
    return {
      expired: active.reduce((n, g) => n + g.overdueSteps, 0),
      expiring: 0,
      toReview: active.filter((g) => g.stuck).length,
    };
  }

  async checkHabit(id: string, request: HabitCheckRequest): Promise<void> {
    await requireRow(this.db, habits, id, 'Habit');
    if (request.done)
      await this.db
        .insert(habitChecks)
        .values({ habitId: id, date: request.date })
        .onConflictDoNothing();
    else
      await this.db
        .delete(habitChecks)
        .where(
          and(eq(habitChecks.habitId, id), eq(habitChecks.date, request.date)),
        );
  }

  /** Writes the review of a week, replacing what was there. */
  async saveWeeklyReview(request: WeeklyReviewRequest): Promise<void> {
    const values = { ...request, weekStart: isoWeekStart(request.weekStart) };
    await this.db
      .insert(weeklyReviews)
      .values(values)
      .onConflictDoUpdate({ target: weeklyReviews.weekStart, set: values });
  }

  async coach(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<GoalsCoachDto> {
    const state = await this.state(day);
    const question = request.question?.trim() || null;
    let row: Omit<CoachAnswerRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: COACH_STEP,
        output: goalsCoachOutputSchema,
        user: `${coachDossier(day, state.goals, state.habits, state.reviews)}\n\n${question ? `My question: ${question}` : 'Help me move forward.'}`,
      });
      row = {
        question,
        output: answer.output,
        source: 'claude',
        model: answer.model,
      };
    } else
      row = {
        question,
        output: offlineCoach(state.goals, state.habits),
        source: 'offline',
        model: null,
      };
    const [saved] = await this.db.insert(coachAnswers).values(row).returning();
    const old = await this.db
      .select({ id: coachAnswers.id })
      .from(coachAnswers)
      .orderBy(desc(coachAnswers.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(coachAnswers).where(
        inArray(
          coachAnswers.id,
          old.map((o) => o.id),
        ),
      );
    return toAdviceDto(saved);
  }

  async removeAdvice(id: string): Promise<void> {
    await this.db.delete(coachAnswers).where(eq(coachAnswers.id, id));
  }
}

function toAdviceDto(row: CoachAnswerRow): GoalsCoachDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
