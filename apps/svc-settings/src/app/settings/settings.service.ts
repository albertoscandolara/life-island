import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import {
  AI_BUDGET_REACHED_SETTING,
  AI_BUDGET_SETTING,
  AI_BUDGET_STOP_SETTING,
  aiTool,
  aiToolDescribedV1Schema,
  aiToolSettingKey,
  aiToolUsedV1Schema,
  invalidSettingValue,
  isKnownSettingKey,
  SETTING_CHANGED_EVENT,
  useCostUsd,
  validSettingValue,
  type AppSettingValue,
  type EventEnvelope,
  type SettingChangedV1,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { CONFIG, SERVICE_DB, type SettingsConfig } from '../config.js';
import { aiToolRequests, aiToolUses, settingValues } from '../db/schema.js';
import {
  budgetOf,
  buildOverview,
  RECENT_USES,
  type MonthToolSpend,
  type UsageTotals,
} from './overview.js';

type Db = pg.Pool | pg.PoolClient;

/** Settings that move the budget: a change re-checks whether AI must stop. */
const BUDGET_KEYS = new Set([AI_BUDGET_SETTING, AI_BUDGET_STOP_SETTING]);

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) private readonly config: SettingsConfig,
  ) {}

  /** `YYYY-MM` now, in the time zone months are counted in. */
  private async month(db: Db = this.svc.pool): Promise<string> {
    const { rows } = await db.query<{ month: string }>(
      `select to_char(now() at time zone $1, 'YYYY-MM') as month`,
      [this.config.timezone],
    );
    return rows[0].month;
  }

  /** What each tool cost per month, for the last year. */
  private async monthly(db: Db = this.svc.pool): Promise<MonthToolSpend[]> {
    const { rows } = await db.query<{
      month: string;
      tool_id: string;
      uses: string;
      cost: string | null;
    }>(
      `select to_char(used_at at time zone $1, 'YYYY-MM') as month, tool_id,
              count(*) as uses, sum(cost_usd) as cost
         from ${this.svc.schema}.ai_tool_uses
        where used_at >= now() - interval '13 months'
        group by 1, 2`,
      [this.config.timezone],
    );
    return rows.map((row) => ({
      month: row.month,
      toolId: row.tool_id,
      uses: Number(row.uses),
      costUsd: Number(row.cost ?? 0),
    }));
  }

  async overview(): Promise<SettingsOverviewDto> {
    const db = drizzle(this.svc.pool);
    const [values, requests, totals, recent, month, monthly] =
      await Promise.all([
        db.select().from(settingValues),
        db.select().from(aiToolRequests),
        this.svc.pool.query<{
          tool_id: string;
          uses: string;
          billed_uses: string;
          total_cost: string | null;
          last_used_at: Date | null;
        }>(
          `select tool_id, count(*) as uses,
                count(*) filter (where cost_usd > 0) as billed_uses,
                sum(cost_usd) as total_cost, max(used_at) as last_used_at
           from ${this.svc.schema}.ai_tool_uses group by tool_id`,
        ),
        // The latest few per tool, without reading the whole history.
        this.svc.pool.query<{
          tool_id: string;
          outcome: 'ok' | 'error';
          error: string | null;
          cost_usd: string;
          steps: never;
          used_at: Date;
        }>(
          `select tool_id, outcome, error, cost_usd, steps, used_at from (
           select *, row_number() over (partition by tool_id order by used_at desc) as n
             from ${this.svc.schema}.ai_tool_uses) ranked
          where n <= $1`,
          [RECENT_USES],
        ),
        this.month(),
        this.monthly(),
      ]);
    return buildOverview({
      values,
      requests,
      month,
      monthly,
      totals: totals.rows.map((row): UsageTotals => ({
        toolId: row.tool_id,
        uses: Number(row.uses),
        billedUses: Number(row.billed_uses),
        totalCostUsd: Number(row.total_cost ?? 0),
        lastUsedAt: row.last_used_at,
      })),
      recentUses: recent.rows.map((row) => ({
        toolId: row.tool_id,
        outcome: row.outcome,
        error: row.error,
        costUsd: Number(row.cost_usd),
        steps: row.steps,
        usedAt: row.used_at,
      })),
    });
  }

  async setAiTool(toolId: string, enabled: boolean): Promise<void> {
    if (!aiTool(toolId))
      throw new BadRequestException(`${toolId} is not an AI tool`);
    await this.set(aiToolSettingKey(toolId), enabled);
  }

  /**
   * Stores a value and publishes `settings.changed@1` in the same
   * transaction; every service that reads the key updates its replica.
   */
  async set(key: string, value: AppSettingValue): Promise<void> {
    const invalid = invalidSettingValue(key, value);
    if (invalid) throw new BadRequestException(invalid);
    await withTransaction(this.svc.pool, async (client) => {
      await this.write(client, key, value);
      if (BUDGET_KEYS.has(key)) await this.checkBudget(client);
    });
  }

  /**
   * Back to the registry default: the value is removed and `null` published,
   * which every replica reads as "not set".
   */
  async reset(key: string): Promise<void> {
    if (!isKnownSettingKey(key))
      throw new BadRequestException(`${key} is not a setting`);
    await withTransaction(this.svc.pool, async (client) => {
      await this.write(client, key, null);
      if (BUDGET_KEYS.has(key)) await this.checkBudget(client);
    });
  }

  /**
   * Many values at once (a backup): all of them are checked first, so a file
   * with one wrong value changes nothing. null resets a key.
   */
  async import(
    values: Record<string, AppSettingValue | null>,
  ): Promise<number> {
    const problems = Object.entries(values).flatMap(([key, value]) => {
      if (!isKnownSettingKey(key)) return [`${key} is not a setting`];
      const invalid = value === null ? null : invalidSettingValue(key, value);
      return invalid ? [invalid] : [];
    });
    if (problems.length) throw new BadRequestException(problems.join('; '));
    await withTransaction(this.svc.pool, async (client) => {
      for (const [key, value] of Object.entries(values))
        await this.write(client, key, value);
      await this.checkBudget(client);
    });
    return Object.keys(values).length;
  }

  /** Every value you set, for a backup (not the budget state Settings keeps itself). */
  async export(): Promise<Record<string, AppSettingValue>> {
    const rows = await drizzle(this.svc.pool).select().from(settingValues);
    return Object.fromEntries(
      rows
        .filter(
          (row) =>
            isKnownSettingKey(row.key) && validSettingValue(row.key, row.value),
        )
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => [row.key, row.value as AppSettingValue]),
    );
  }

  /**
   * Whether AI must stop for the budget, now: when the answer changes, it is
   * stored and published as AI_BUDGET_REACHED_SETTING, which every service's
   * isAiToolEnabled reads. Runs after each use, each budget change, at
   * startup and every hour (a new month lifts it).
   */
  async checkBudget(client?: pg.PoolClient): Promise<boolean> {
    const run = async (db: pg.PoolClient) => {
      const [values, month, monthly] = await Promise.all([
        drizzle(db).select().from(settingValues),
        this.month(db),
        this.monthly(db),
      ]);
      const spent = monthly
        .filter((row) => row.month === month)
        .reduce((sum, row) => sum + row.costUsd, 0);
      const blocking = budgetOf(values, month, spent).blocking;
      const stored = values.find(
        (row) => row.key === AI_BUDGET_REACHED_SETTING,
      )?.value;
      if ((stored === true) !== blocking)
        await this.write(db, AI_BUDGET_REACHED_SETTING, blocking);
      return blocking;
    };
    return client ? run(client) : withTransaction(this.svc.pool, run);
  }

  /** Stores (or, for null, removes) a value and publishes the change, in the caller's transaction. */
  private async write(
    client: pg.PoolClient,
    key: string,
    value: AppSettingValue | null,
  ): Promise<void> {
    const db = drizzle(client);
    let changedAt: Date;
    if (value === null) {
      await db.delete(settingValues).where(eq(settingValues.key, key));
      const { rows } = await client.query<{ now: Date }>('select now()');
      changedAt = rows[0].now;
    } else {
      const [row] = await db
        .insert(settingValues)
        .values({ key, value, changedAt: sql`now()` })
        .onConflictDoUpdate({
          target: settingValues.key,
          set: { value, changedAt: sql`now()` },
        })
        .returning();
      changedAt = row.changedAt;
    }
    const payload: SettingChangedV1 = {
      key,
      value,
      changedAt: changedAt.toISOString(),
    };
    await enqueueEvent(client, this.svc.schema, {
      type: SETTING_CHANGED_EVENT,
      payload,
    });
  }

  /**
   * Publishes every stored value again, so a service added later (or one
   * whose replica was reset) catches up. Runs at startup; replicas keep the
   * newest value per key, so a repeat is harmless.
   */
  async republishAll(): Promise<number> {
    return withTransaction(this.svc.pool, async (client) => {
      const rows = await drizzle(client).select().from(settingValues);
      for (const row of rows)
        await enqueueEvent(client, this.svc.schema, {
          type: SETTING_CHANGED_EVENT,
          payload: {
            key: row.key,
            value: row.value as SettingChangedV1['value'],
            changedAt: row.changedAt.toISOString(),
          } satisfies SettingChangedV1,
        });
      return rows.length;
    });
  }

  /** Keeps the most recent description of a tool's request. */
  async applyDescribed(
    event: EventEnvelope,
    client: pg.PoolClient,
  ): Promise<void> {
    const described = aiToolDescribedV1Schema.parse(event.payload);
    if (!aiTool(described.toolId)) return;
    const row = {
      toolId: described.toolId,
      service: described.service,
      available: described.available,
      promptVersion: described.promptVersion,
      steps: described.steps,
      describedAt: new Date(described.describedAt),
    };
    await drizzle(client)
      .insert(aiToolRequests)
      .values(row)
      .onConflictDoUpdate({
        target: aiToolRequests.toolId,
        set: row,
        setWhere: sql`${aiToolRequests.describedAt} <= excluded.described_at`,
      });
  }

  /** Records a use with its cost; the event id keeps a redelivery from counting twice. */
  async applyUsed(event: EventEnvelope, client: pg.PoolClient): Promise<void> {
    const used = aiToolUsedV1Schema.parse(event.payload);
    if (!aiTool(used.toolId)) return;
    await drizzle(client)
      .insert(aiToolUses)
      .values({
        id: event.id,
        toolId: used.toolId,
        service: used.service,
        outcome: used.outcome,
        error: used.error,
        costUsd: useCostUsd(used.steps),
        steps: used.steps,
        usedAt: new Date(used.usedAt),
      })
      .onConflictDoNothing();
    await this.checkBudget(client);
  }
}
