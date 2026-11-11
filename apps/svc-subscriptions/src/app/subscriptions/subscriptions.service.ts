import {
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { readNumberSetting, type ServiceDb } from '@life-island/be-common';
import { AiAssistant, RecordCollections } from '@life-island/be-nest';
import {
  deadlineWindow,
  inDeadlineWindow,
  isoToday,
  renewalAdvisorOutputSchema,
  SUBSCRIPTIONS_WARN_DAYS_SETTING,
  type DeadlineDto,
  type DeadlinesQuery,
  type LifeAttentionDto,
  type LifeQuestionRequest,
  type RenewalAdviceDto,
  type SubscriptionKind,
  type SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  contracts,
  priceChanges,
  renewalAdvice,
  type RenewalAdviceRow,
} from '../db/schema.js';
import { RECORDS } from './collections.js';
import {
  ADVISOR_INSTRUCTIONS,
  advisorDossier,
  isLive,
  offlineAdvice,
  withRenewal,
} from './renewals.js';

/** The AI tool of Subscriptions (AI_TOOLS in libs/contracts settings.ts). */
export const ADVISOR_TOOL = 'subscriptions.renewal-advisor';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const ADVISE_STEP = {
  stepId: 'advise',
  label: 'Advise on the renewals',
  system: ADVISOR_INSTRUCTIONS,
  userTemplate:
    '{today, one line per live contract: kind, provider, status, cost and cycle, yearly cost, usage, next renewal, cancel-by, locked until, price changes}\n\n{My question: <your question>, or: Which contracts should I keep?}',
  outputFormat: 'renewalAdvisorOutput',
  effort: 'low' as const,
  maxTokens: 8000,
};

const round = (v: number) => Math.round(v * 100) / 100;

@Injectable()
export class SubscriptionsService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(RECORDS) private readonly records: RecordCollections,
  ) {
    this.ai = new AiAssistant({
      toolId: ADVISOR_TOOL,
      service: 'svc-subscriptions',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([ADVISE_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  private async items(day: string) {
    const [rows, changes] = await Promise.all([
      this.db.select().from(contracts).orderBy(contracts.name),
      this.db.select().from(priceChanges).orderBy(priceChanges.date),
    ]);
    return rows.map(({ updatedAt: _, ...row }) =>
      withRenewal(
        {
          ...row,
          createdAt: row.createdAt.toISOString(),
          priceChanges: changes
            .filter((c) => c.contractId === row.id)
            .map((c) => ({ date: c.date, from: c.fromCost, to: c.toCost })),
        },
        day,
      ),
    );
  }

  async overview(day = today()): Promise<SubscriptionsOverviewDto> {
    const [items, adviceRows, aiAdvisor] = await Promise.all([
      this.items(day),
      this.db
        .select()
        .from(renewalAdvice)
        .orderBy(desc(renewalAdvice.createdAt))
        .limit(5),
      this.ai.active(),
    ]);
    const live = items.filter(isLive);
    const byKind = new Map<SubscriptionKind, number>();
    for (const i of live)
      byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + i.yearly);
    return {
      today: day,
      items: items.sort(
        (a, b) =>
          Number(isLive(b)) - Number(isLive(a)) ||
          (a.cancelBy ?? a.nextRenewal ?? '9999').localeCompare(
            b.cancelBy ?? b.nextRenewal ?? '9999',
          ),
      ),
      totals: {
        monthly: round(live.reduce((s, i) => s + i.monthly, 0)),
        yearly: round(live.reduce((s, i) => s + i.yearly, 0)),
        active: live.length,
        unused: round(
          live
            .filter((i) => i.usage === 'rarely' || i.usage === 'never')
            .reduce((s, i) => s + i.yearly, 0),
        ),
      },
      byKind: [...byKind.entries()]
        .map(([kind, yearly]) => ({ kind, yearly: round(yearly) }))
        .sort((a, b) => b.yearly - a.yearly),
      advice: adviceRows.map(toAdviceDto),
      aiAdvisor,
    };
  }

  /** Changes a contract, keeping the history of its cost. */
  async update(id: string, body: unknown, day = today()): Promise<void> {
    const [before] = await this.db
      .select()
      .from(contracts)
      .where(eq(contracts.id, id))
      .catch(() => []);
    if (!before) throw new NotFoundException('Contract not found');
    await this.records.update('items', id, body);
    const [after] = await this.db
      .select({ cost: contracts.cost })
      .from(contracts)
      .where(eq(contracts.id, id));
    if (after && after.cost !== before.cost)
      await this.db.insert(priceChanges).values({
        contractId: id,
        date: day,
        fromCost: before.cost,
        toCost: after.cost,
      });
  }

  /** Renewals, last days to cancel and the end of minimum terms, for the Agenda. */
  async deadlines(
    query: DeadlinesQuery,
    day = today(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const out: DeadlineDto[] = [];
    for (const i of (await this.items(day)).filter(isLive)) {
      if (
        i.cancelBy &&
        i.noticeDays > 0 &&
        inDeadlineWindow(i.cancelBy, window)
      )
        out.push({
          id: `cancel-by:${i.id}:${i.cancelBy}`,
          module: 'subscriptions',
          kind: 'cancel-by',
          title: `Last day to cancel ${i.name}`,
          detail: `It renews on ${i.nextRenewal} with ${i.noticeDays} days of notice.`,
          date: i.cancelBy,
          amount: null,
          path: '/subscriptions',
        });
      if (i.nextRenewal && inDeadlineWindow(i.nextRenewal, window))
        out.push({
          id: `renewal:${i.id}:${i.nextRenewal}`,
          module: 'subscriptions',
          kind: i.status === 'trial' ? 'trial-end' : 'renewal',
          title:
            i.status === 'trial'
              ? `${i.name}: the free trial ends`
              : `${i.name} renews`,
          detail: i.autoRenew
            ? 'It renews on its own.'
            : 'It does not renew on its own.',
          date: i.nextRenewal,
          amount: i.cost,
          path: '/subscriptions',
        });
      if (i.lockedUntil && inDeadlineWindow(i.lockedUntil, window))
        out.push({
          id: `locked:${i.id}:${i.lockedUntil}`,
          module: 'subscriptions',
          kind: 'locked-until',
          title: `${i.name}: the minimum term ends`,
          detail: 'From now on you can leave without a fee.',
          date: i.lockedUntil,
          amount: null,
          path: '/subscriptions',
        });
    }
    return out;
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const [items, warnDays] = await Promise.all([
      this.items(day),
      readNumberSetting(
        this.svc.pool,
        this.svc.schema,
        SUBSCRIPTIONS_WARN_DAYS_SETTING,
      ).catch(() => 14),
    ]);
    const watched = items.filter((i) => i.daysToCancelBy !== null);
    return {
      expired: 0,
      expiring: watched.filter(
        (i) => i.daysToCancelBy! >= 0 && i.daysToCancelBy! <= warnDays,
      ).length,
      toReview: items.filter((i) => isLive(i) && i.usage === 'never').length,
    };
  }

  async advise(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<RenewalAdviceDto> {
    const items = await this.items(day);
    const question = request.question?.trim() || null;
    let row: Omit<RenewalAdviceRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: ADVISE_STEP,
        output: renewalAdvisorOutputSchema,
        user: `${advisorDossier(day, items)}\n\n${question ? `My question: ${question}` : 'Which contracts should I keep?'}`,
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
        output: offlineAdvice(items),
        source: 'offline',
        model: null,
      };
    const [saved] = await this.db.insert(renewalAdvice).values(row).returning();
    const old = await this.db
      .select({ id: renewalAdvice.id })
      .from(renewalAdvice)
      .orderBy(desc(renewalAdvice.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(renewalAdvice).where(
        inArray(
          renewalAdvice.id,
          old.map((o) => o.id),
        ),
      );
    return toAdviceDto(saved);
  }

  async removeAdvice(id: string): Promise<void> {
    await this.db.delete(renewalAdvice).where(eq(renewalAdvice.id, id));
  }
}

function toAdviceDto(row: RenewalAdviceRow): RenewalAdviceDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
