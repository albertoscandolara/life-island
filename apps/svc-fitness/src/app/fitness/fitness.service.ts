import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { readNumberSetting, type ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  deadlineWindow,
  FITNESS_WEEKLY_MINUTES_DEFAULT,
  FITNESS_WEEKLY_MINUTES_SETTING,
  inDeadlineWindow,
  isoAddDays,
  isoDaysBetween,
  isoToday,
  isoWeekStart,
  trainingPlanOutputSchema,
  type DeadlineDto,
  type DeadlinesQuery,
  type FitnessOverviewDto,
  type LifeAttentionDto,
  type LifeQuestionRequest,
  type TrainingPlanDto,
  type WorkoutKind,
} from '@life-island/contracts';
import { desc, eq, gte, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  fitnessEvents,
  measurements,
  trainingPlans,
  workouts,
  type TrainingPlanRow,
} from '../db/schema.js';
import {
  COACH_INSTRUCTIONS,
  coachDossier,
  offlinePlan,
  stats,
  weeks,
  withActive,
} from './training.js';

/** The AI tool of Fitness (AI_TOOLS in libs/contracts settings.ts). */
export const PLAN_TOOL = 'fitness.training-plan';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const PLAN_STEP = {
  stepId: 'plan',
  label: 'Plan the week',
  system: COACH_INSTRUCTIONS,
  userTemplate:
    '{today and the weekly goal; the last 6 weeks: active minutes, workouts, minutes by kind; the streak and recent average; weight and sleep trends; events ahead}\n\n{My question: <your question>, or: Plan my training week.}',
  outputFormat: 'trainingPlanOutput',
  effort: 'low' as const,
  maxTokens: 6000,
};

const iso = <T extends { createdAt: Date }>(row: T) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class FitnessService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: PLAN_TOOL,
      service: 'svc-fitness',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([PLAN_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  private async state(day: string) {
    const since = isoAddDays(isoWeekStart(day), -7 * 26);
    const [workoutRows, measurementRows, eventRows, goal] = await Promise.all([
      this.db
        .select()
        .from(workouts)
        .where(gte(workouts.date, since))
        .orderBy(desc(workouts.date), desc(workouts.createdAt)),
      this.db
        .select()
        .from(measurements)
        .where(gte(measurements.date, isoAddDays(day, -400)))
        .orderBy(desc(measurements.date)),
      this.db.select().from(fitnessEvents).orderBy(fitnessEvents.date),
      readNumberSetting(
        this.svc.pool,
        this.svc.schema,
        FITNESS_WEEKLY_MINUTES_SETTING,
      ).catch(() => FITNESS_WEEKLY_MINUTES_DEFAULT),
    ]);
    const all = workoutRows.map((w) => withActive(iso(w)));
    const list = weeks(all, day);
    const ms = measurementRows.map(iso);
    const events = eventRows.map((e) => ({
      ...iso(e),
      daysToGo: isoDaysBetween(day, e.date),
    }));
    return {
      goalMinutes: goal || FITNESS_WEEKLY_MINUTES_DEFAULT,
      workouts: all,
      measurements: ms,
      events,
      weeks: list,
      stats: stats(list, ms, goal || FITNESS_WEEKLY_MINUTES_DEFAULT, day),
    };
  }

  async overview(day = today()): Promise<FitnessOverviewDto> {
    const [state, planRows, aiCoach] = await Promise.all([
      this.state(day),
      this.db
        .select()
        .from(trainingPlans)
        .orderBy(desc(trainingPlans.createdAt))
        .limit(5),
      this.ai.active(),
    ]);
    return {
      today: day,
      weekStart: isoWeekStart(day),
      ...state,
      workouts: state.workouts.filter((w) => w.date > isoAddDays(day, -120)),
      plans: planRows.map(toPlanDto),
      aiCoach,
    };
  }

  /** The events you train for, for the Agenda. */
  async deadlines(
    query: DeadlinesQuery,
    day = today(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const rows = await this.db
      .select()
      .from(fitnessEvents)
      .where(eq(fitnessEvents.done, false));
    return rows
      .filter((e) => inDeadlineWindow(e.date, window))
      .map((e) => ({
        id: `event:${e.id}:${e.date}`,
        module: 'fitness',
        kind: 'event',
        title: e.name,
        detail: e.target ? `Target: ${e.target}` : null,
        date: e.date,
        amount: null,
        path: '/fitness',
      }));
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const rows = await this.db
      .select()
      .from(fitnessEvents)
      .where(eq(fitnessEvents.done, false));
    return {
      expired: 0,
      expiring: rows.filter(
        (e) => e.date >= day && e.date <= isoAddDays(day, 7),
      ).length,
      toReview: rows.filter((e) => e.date < day).length,
    };
  }

  async plan(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<TrainingPlanDto> {
    const state = await this.state(day);
    const question = request.question?.trim() || null;
    let row: Omit<TrainingPlanRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: PLAN_STEP,
        output: trainingPlanOutputSchema,
        user: `${coachDossier(day, state.goalMinutes, state.weeks, state.stats, state.events)}\n\n${question ? `My question: ${question}` : 'Plan my training week.'}`,
      });
      row = {
        question,
        output: answer.output,
        source: 'claude',
        model: answer.model,
      };
    } else {
      const counts = new Map<WorkoutKind, number>();
      for (const w of state.workouts.slice(0, 30))
        counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
      const favourite =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const next = state.events.find((e) => !e.done && e.daysToGo >= 0) ?? null;
      row = {
        question,
        output: offlinePlan(state.stats, state.goalMinutes, favourite, next),
        source: 'offline',
        model: null,
      };
    }
    const [saved] = await this.db.insert(trainingPlans).values(row).returning();
    const old = await this.db
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .orderBy(desc(trainingPlans.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(trainingPlans).where(
        inArray(
          trainingPlans.id,
          old.map((o) => o.id),
        ),
      );
    return toPlanDto(saved);
  }

  async removePlan(id: string): Promise<void> {
    await this.db.delete(trainingPlans).where(eq(trainingPlans.id, id));
  }
}

function toPlanDto(row: TrainingPlanRow): TrainingPlanDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
