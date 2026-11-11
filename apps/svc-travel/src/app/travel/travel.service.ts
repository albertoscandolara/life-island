import { Inject, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  deadlineWindow,
  inDeadlineWindow,
  isoAddDays,
  isoDaysBetween,
  isoToday,
  tripPlanOutputSchema,
  type ApplyTripPlanRequest,
  type DeadlineDto,
  type DeadlinesQuery,
  type LifeAttentionDto,
  type TravelOverviewDto,
  type TripDto,
  type TripPlanDto,
  type TripPlanRequest,
} from '@life-island/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import { bookings, checklistItems, expenses, tripPlans, trips, type TripPlanRow } from '../db/schema.js';
import { offlinePlan, PLANNER_INSTRUCTIONS, planDossier } from './planning.js';

/** The AI tool of Travel (AI_TOOLS in libs/contracts settings.ts). */
export const PLANNER_TOOL = 'travel.trip-planner';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const PLAN_STEP = {
  stepId: 'plan',
  label: 'Plan the trip',
  system: PLANNER_INSTRUCTIONS,
  userTemplate:
    '{today; the trip: destination, abroad, dates and nights, travellers, budget; what is booked; the checklist}\n\n{My question: <your question>, or: Help me prepare this trip.}',
  outputFormat: 'tripPlanOutput',
  effort: 'medium' as const,
  maxTokens: 10000,
};

const iso = <T extends { createdAt: Date }>(row: T) => ({ ...row, createdAt: row.createdAt.toISOString() });
const round = (v: number) => Math.round(v * 100) / 100;
const isAhead = (t: TripDto) => t.status === 'planning' || t.status === 'booked' || t.status === 'idea';

@Injectable()
export class TravelService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: PLANNER_TOOL,
      service: 'svc-travel',
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

  private async trips(day: string): Promise<TripDto[]> {
    const [tripRows, bookingRows, checkRows, expenseRows] = await Promise.all([
      this.db.select().from(trips),
      this.db.select().from(bookings).orderBy(bookings.date, bookings.createdAt),
      this.db.select().from(checklistItems).orderBy(checklistItems.done, checklistItems.dueOn, checklistItems.createdAt),
      this.db.select().from(expenses).orderBy(desc(expenses.date)),
    ]);
    return tripRows
      .map((t) => {
        const own = <R extends { tripId: string; createdAt: Date }>(rows: R[]) => rows.filter((r) => r.tripId === t.id).map(iso);
        const tripBookings = own(bookingRows);
        const tripExpenses = own(expenseRows);
        return {
          ...iso(t),
          bookings: tripBookings,
          checklist: own(checkRows),
          expenses: tripExpenses,
          spent: round(
            tripBookings.reduce((s, b) => s + (b.cost ?? 0), 0) + tripExpenses.reduce((s, e) => s + e.amount, 0),
          ),
          nights: t.startOn && t.endOn ? Math.max(0, isoDaysBetween(t.startOn, t.endOn)) : null,
          daysToGo: t.startOn ? isoDaysBetween(day, t.startOn) : null,
        };
      })
      .sort((a, b) => {
        const rank = (t: TripDto) => (isAhead(t) ? 0 : 1);
        return rank(a) - rank(b) || (rank(a) === 0
          ? (a.startOn ?? '9999').localeCompare(b.startOn ?? '9999')
          : (b.startOn ?? '').localeCompare(a.startOn ?? ''));
      });
  }

  async overview(day = today()): Promise<TravelOverviewDto> {
    const [all, planRows, aiPlanner] = await Promise.all([
      this.trips(day),
      this.db.select().from(tripPlans).orderBy(desc(tripPlans.createdAt)).limit(20),
      this.ai.active(),
    ]);
    const year = day.slice(0, 4);
    const thisYear = all.filter((t) => t.status !== 'cancelled' && t.startOn?.startsWith(year));
    return {
      today: day,
      trips: all,
      plans: planRows.map(toPlanDto),
      totals: {
        upcoming: all.filter((t) => isAhead(t) && t.status !== 'idea' && (t.daysToGo ?? 0) >= 0).length,
        spentThisYear: round(thisYear.reduce((s, t) => s + t.spent, 0)),
        nightsThisYear: thisYear.filter((t) => t.status === 'done' || (t.endOn ?? '9999') <= day).reduce((s, t) => s + (t.nights ?? 0), 0),
      },
      aiPlanner,
    };
  }

  /** Departures, free-cancellation limits and checklist dates, for the Agenda. */
  async deadlines(query: DeadlinesQuery, day = today()): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const out: DeadlineDto[] = [];
    for (const t of (await this.trips(day)).filter((t) => t.status === 'planning' || t.status === 'booked')) {
      if (t.startOn && inDeadlineWindow(t.startOn, window))
        out.push({
          id: `trip:${t.id}:${t.startOn}`,
          module: 'travel',
          kind: 'departure',
          title: `Leave for ${t.destination}`,
          detail: `${t.title}${t.nights ? `, ${t.nights} nights` : ''}.`,
          date: t.startOn,
          amount: null,
          path: '/travel',
        });
      for (const b of t.bookings)
        if (b.cancelBy && inDeadlineWindow(b.cancelBy, window))
          out.push({
            id: `free-cancel:${b.id}:${b.cancelBy}`,
            module: 'travel',
            kind: 'free-cancellation',
            title: `Last day to cancel ${b.title} for free`,
            detail: `${t.title}${b.provider ? ` · ${b.provider}` : ''}`,
            date: b.cancelBy,
            amount: b.cost,
            path: '/travel',
          });
      for (const c of t.checklist)
        if (!c.done && c.dueOn && inDeadlineWindow(c.dueOn, window))
          out.push({
            id: `check:${c.id}:${c.dueOn}`,
            module: 'travel',
            kind: 'trip-task',
            title: c.text,
            detail: `Before ${t.title}.`,
            date: c.dueOn,
            amount: null,
            path: '/travel',
          });
    }
    return out;
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const all = (await this.trips(day)).filter((t) => t.status === 'planning' || t.status === 'booked');
    const tasks = all.flatMap((t) => t.checklist.filter((c) => !c.done && c.dueOn));
    return {
      expired: tasks.filter((c) => c.dueOn! < day).length,
      expiring: tasks.filter((c) => c.dueOn! >= day && c.dueOn! <= isoAddDays(day, 7)).length,
      toReview: 0,
    };
  }

  private async trip(id: string, day: string): Promise<TripDto> {
    const found = (await this.trips(day)).find((t) => t.id === id);
    if (!found) throw new NotFoundException('Trip not found');
    return found;
  }

  async plan(tripId: string, request: TripPlanRequest, day = today()): Promise<TripPlanDto> {
    const trip = await this.trip(tripId, day);
    const question = request.question?.trim() || null;
    let row: Omit<TripPlanRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: PLAN_STEP,
        output: tripPlanOutputSchema,
        user: `${planDossier(trip, day)}\n\n${question ? `My question: ${question}` : 'Help me prepare this trip.'}`,
      });
      row = { tripId, question, output: answer.output, source: 'claude', model: answer.model };
    } else row = { tripId, question, output: offlinePlan(trip), source: 'offline', model: null };
    const [saved] = await this.db.insert(tripPlans).values(row).returning();
    const old = await this.db
      .select({ id: tripPlans.id })
      .from(tripPlans)
      .where(eq(tripPlans.tripId, tripId))
      .orderBy(desc(tripPlans.createdAt))
      .offset(5);
    if (old.length) await this.db.delete(tripPlans).where(inArray(tripPlans.id, old.map((o) => o.id)));
    return toPlanDto(saved);
  }

  /** Adds the plan's checklist (dated from the departure) and packing list to the trip. */
  async applyPlan(planId: string, request: ApplyTripPlanRequest, day = today()): Promise<{ added: number }> {
    const [plan] = await this.db.select().from(tripPlans).where(eq(tripPlans.id, planId)).catch(() => []);
    if (!plan) throw new NotFoundException('Plan not found');
    const trip = await this.trip(plan.tripId, day);
    const there = new Set(trip.checklist.map((c) => c.text.toLowerCase()));
    const rows: (typeof checklistItems.$inferInsert)[] = [];
    if (request.checklist !== false)
      for (const c of plan.output.checklist) {
        const due = trip.startOn ? isoAddDays(trip.startOn, -Math.max(0, Math.round(c.daysBefore))) : null;
        rows.push({ tripId: trip.id, text: c.text.slice(0, 200), dueOn: due && due < day ? day : due, packing: false });
      }
    if (request.packing !== false)
      for (const p of plan.output.packing) rows.push({ tripId: trip.id, text: p.slice(0, 200), packing: true });
    const fresh = rows.filter((r) => !there.has(r.text.toLowerCase()));
    if (fresh.length) await this.db.insert(checklistItems).values(fresh);
    return { added: fresh.length };
  }

  async removePlan(id: string): Promise<void> {
    await this.db.delete(tripPlans).where(eq(tripPlans.id, id));
  }
}

function toPlanDto(row: TripPlanRow): TripPlanDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
