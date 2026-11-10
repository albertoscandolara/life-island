import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import {
  aiTool,
  aiToolDescribedV1Schema,
  aiToolSettingKey,
  aiToolUsedV1Schema,
  invalidSettingValue,
  SETTING_CHANGED_EVENT,
  useCostUsd,
  type EventEnvelope,
  type SettingChangedV1,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { SERVICE_DB } from '../config.js';
import { aiToolRequests, aiToolUses, settingValues } from '../db/schema.js';
import { buildOverview, RECENT_USES, type UsageTotals } from './overview.js';

@Injectable()
export class SettingsService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async overview(): Promise<SettingsOverviewDto> {
    const db = drizzle(this.svc.pool);
    const [values, requests, totals, recent] = await Promise.all([
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
    ]);
    return buildOverview({
      values,
      requests,
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
  async set(key: string, value: boolean | string): Promise<void> {
    const invalid = invalidSettingValue(key, value);
    if (invalid) throw new BadRequestException(invalid);
    await withTransaction(this.svc.pool, async (client) => {
      const [row] = await drizzle(client)
        .insert(settingValues)
        .values({ key, value, changedAt: sql`now()` })
        .onConflictDoUpdate({
          target: settingValues.key,
          set: { value, changedAt: sql`now()` },
        })
        .returning();
      const payload: SettingChangedV1 = {
        key,
        value,
        changedAt: row.changedAt.toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: SETTING_CHANGED_EVENT,
        payload,
      });
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
  }
}
