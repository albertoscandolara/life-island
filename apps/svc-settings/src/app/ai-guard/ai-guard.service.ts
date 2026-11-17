import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { withTransaction, type ServiceDb } from '@life-island/be-common';
import {
  AI_BUDGET_SETTING,
  AI_BUDGET_STOP_SETTING,
  type AiGuardLimits,
  type AiGuardStatusDto,
  type AiReserveRequest,
} from '@life-island/contracts';
import type pg from 'pg';
import { CONFIG, SERVICE_DB, type SettingsConfig } from '../config.js';

/** A call the guard refuses, with the reason in words (HTTP 429). */
export class AiSpendRefused extends HttpException {
  constructor(message: string) {
    super({ statusCode: 429, message }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/*
 * Every model call of the island reserves its worst-case cost here first
 * (docs/security.md, "AI cost guards"). One transaction with a lock checks,
 * against what was spent and what is still running:
 * - the island's monthly ceiling from the environment (AI_HARD_MONTHLY_USD),
 *   and the Settings budget when "Turn AI off at the budget" is on;
 * - one person's daily spend and their calls per minute and per hour;
 * - the worst case of a single call.
 * A call that never settles (its service crashed) keeps its reserved cost.
 */
@Injectable()
export class AiGuardService {
  private readonly logger = new Logger('AiGuard');

  constructor(
    @Inject(CONFIG) private readonly config: SettingsConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  get limits(): AiGuardLimits {
    return this.config.aiLimits;
  }

  async reserve(request: AiReserveRequest): Promise<string> {
    const limits = this.limits;
    if (request.maxUsd > limits.maxCallUsd)
      throw this.refuse(
        request,
        `This request could cost up to $${request.maxUsd.toFixed(2)}, above the $${limits.maxCallUsd.toFixed(2)} allowed for one call (AI_MAX_CALL_USD). Try a shorter request.`,
      );
    return withTransaction(this.svc.pool, async (db) => {
      // One reservation at a time: two calls in parallel cannot both fit in the last dollar.
      await db.query(
        "select pg_advisory_xact_lock(hashtext('settings.ai-guard'))",
      );
      const month = await this.monthSpent(db);
      const ceiling = await this.monthlyCeiling(db);
      if (month + request.maxUsd > ceiling.usd)
        throw this.refuse(
          request,
          `AI is paused until next month: this month reached $${month.toFixed(2)} of the $${ceiling.usd.toFixed(2)} ${ceiling.source}.`,
        );
      if (request.userId) {
        const user = await this.userUse(db, request.userId);
        if (user.lastMinute >= limits.userPerMinute)
          throw this.refuse(
            request,
            'Too many AI requests in a minute. Wait a moment and try again.',
          );
        if (user.lastHour >= limits.userPerHour)
          throw this.refuse(
            request,
            `You reached ${limits.userPerHour} AI requests this hour. Try again later.`,
          );
        if (user.todayUsd + request.maxUsd > limits.userDailyUsd)
          throw this.refuse(
            request,
            `You reached today's AI allowance ($${limits.userDailyUsd.toFixed(2)} a day). It starts again tomorrow.`,
          );
      }
      const { rows } = await db.query<{ id: string }>(
        `insert into settings.ai_reservations (tool_id, service, user_id, reserved_usd)
         values ($1, $2, $3, $4) returning id`,
        [request.toolId, request.service, request.userId, request.maxUsd],
      );
      return (rows[0] as { id: string }).id;
    });
  }

  async settle(id: string, actualUsd: number): Promise<void> {
    await this.svc.pool.query(
      `update settings.ai_reservations set actual_usd = $2, settled_at = now()
        where id = $1 and settled_at is null`,
      [id, actualUsd],
    );
  }

  async status(userId: string | null): Promise<AiGuardStatusDto> {
    const month = await this.monthSpent(this.svc.pool);
    const user = userId ? await this.userUse(this.svc.pool, userId) : null;
    return {
      limits: this.limits,
      monthSpentUsd: month,
      todaySpentUsd: user?.todayUsd ?? 0,
      lastHourCalls: user?.lastHour ?? 0,
    };
  }

  private refuse(request: AiReserveRequest, message: string): AiSpendRefused {
    this.logger.warn(
      `Refused ${request.toolId} for ${request.userId ?? 'background work'}: ${message}`,
    );
    return new AiSpendRefused(message);
  }

  private async monthSpent(db: pg.Pool | pg.PoolClient): Promise<number> {
    const { rows } = await db.query<{ spent: string | null }>(
      `select sum(coalesce(actual_usd, reserved_usd)) as spent from settings.ai_reservations
        where created_at >= (date_trunc('month', now() at time zone $1) at time zone $1)`,
      [this.config.timezone],
    );
    return Number(rows[0]?.spent ?? 0);
  }

  private async userUse(
    db: pg.Pool | pg.PoolClient,
    userId: string,
  ): Promise<{ todayUsd: number; lastMinute: number; lastHour: number }> {
    const { rows } = await db.query<{
      today: string | null;
      minute: string;
      hour: string;
    }>(
      `select
         sum(coalesce(actual_usd, reserved_usd))
           filter (where created_at >= (date_trunc('day', now() at time zone $2) at time zone $2)) as today,
         count(*) filter (where created_at > now() - interval '1 minute') as minute,
         count(*) filter (where created_at > now() - interval '1 hour') as hour
       from settings.ai_reservations
       where user_id = $1 and created_at > now() - interval '2 days'`,
      [userId, this.config.timezone],
    );
    const row = rows[0];
    return {
      todayUsd: Number(row?.today ?? 0),
      lastMinute: Number(row?.minute ?? 0),
      lastHour: Number(row?.hour ?? 0),
    };
  }

  /** The environment's ceiling, lowered by the Settings budget when that turns AI off. */
  private async monthlyCeiling(
    db: pg.PoolClient,
  ): Promise<{ usd: number; source: string }> {
    const hard = {
      usd: this.limits.monthlyUsd,
      source: 'allowed by the server (AI_HARD_MONTHLY_USD)',
    };
    const { rows } = await db.query<{ key: string; value: unknown }>(
      'select key, value from settings.setting_values where key = any($1)',
      [[AI_BUDGET_SETTING, AI_BUDGET_STOP_SETTING]],
    );
    const budget = rows.find((row) => row.key === AI_BUDGET_SETTING)?.value;
    const stop =
      rows.find((row) => row.key === AI_BUDGET_STOP_SETTING)?.value === true;
    if (stop && typeof budget === 'number' && budget > 0 && budget < hard.usd)
      return { usd: budget, source: 'monthly budget set in Settings' };
    return hard;
  }
}
