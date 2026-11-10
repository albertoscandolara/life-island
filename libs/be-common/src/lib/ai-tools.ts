import {
  AI_ENABLED_SETTING,
  AI_TOOL_DESCRIBED_EVENT,
  AI_TOOL_USED_EVENT,
  aiToolSettingKey,
  appSetting,
  requireAiTool,
  settingChangedV1Schema,
  type AiRequestStep,
  type AiStepUsage,
  type AiToolDescribedV1,
  type AiToolUsedV1,
  type EventEnvelope,
} from '@life-island/contracts';
import type pg from 'pg';
import { withTransaction } from './db.js';
import { enqueueEvent } from './outbox.js';
import { assertSchemaName } from './schema-name.js';

/*
 * The service side of Settings (docs/guides/ai-tools.md). A service that runs
 * an AI tool or reads a setting:
 * - keeps a replica of the settings in its own schema (`settings_replica`,
 *   added by its own migration) through `applySettingChanged`, a consumer of
 *   `settings.changed@1`;
 * - asks `isAiToolEnabled` before it calls a model, so a switch in Settings
 *   takes effect without a restart and without calling svc-settings;
 * - tells Settings how each tool calls the model (`describeAiTools`, at
 *   startup) and what each use cost (`recordAiToolUse`), both through its outbox.
 */

/**
 * The replica table every such service creates in its own schema, through its
 * own migration: `key text primary key, value jsonb not null, changed_at
 * timestamptz not null` (see svc-work's or ingestion-db's `settingsReplica`).
 */
export const SETTINGS_REPLICA_TABLE = 'settings_replica';

type Queryable = pg.Pool | pg.ClientBase;

/**
 * Consumer handler for `settings.changed@1`: keeps the newest value per key,
 * so an event redelivered or received out of order never undoes a later change.
 */
export function settingChangedHandler(schema: string) {
  const table = `${assertSchemaName(schema)}.${SETTINGS_REPLICA_TABLE}`;
  return async (event: EventEnvelope, client: pg.PoolClient): Promise<void> => {
    const change = settingChangedV1Schema.parse(event.payload);
    await client.query(
      `insert into ${table} (key, value, changed_at) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, changed_at = excluded.changed_at
       where ${table}.changed_at < excluded.changed_at`,
      [change.key, JSON.stringify(change.value), change.changedAt],
    );
  };
}

/** The replicated value of a setting, or undefined while Settings never set it. */
export async function readSetting(
  db: Queryable,
  schema: string,
  key: string,
): Promise<unknown> {
  const { rows } = await db.query<{ value: unknown }>(
    `select value from ${assertSchemaName(schema)}.${SETTINGS_REPLICA_TABLE} where key = $1`,
    [key],
  );
  return rows[0]?.value;
}

/** A boolean setting: the replica, else `fallback`, else the registry default. */
export async function readBooleanSetting(
  db: Queryable,
  schema: string,
  key: string,
  fallback?: boolean,
): Promise<boolean> {
  const value = await readSetting(db, schema, key);
  if (typeof value === 'boolean') return value;
  if (fallback !== undefined) return fallback;
  return appSetting(key)?.default === true;
}

/**
 * Whether a tool may call the model now: the master switch and its own
 * switch, from this service's replica (the registry defaults until set).
 */
export async function isAiToolEnabled(
  db: Queryable,
  schema: string,
  toolId: string,
): Promise<boolean> {
  const tool = requireAiTool(toolId);
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `select key, value from ${assertSchemaName(schema)}.${SETTINGS_REPLICA_TABLE} where key = any($1)`,
    [[AI_ENABLED_SETTING, aiToolSettingKey(toolId)]],
  );
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  const master = value(AI_ENABLED_SETTING);
  const own = value(aiToolSettingKey(toolId));
  return (
    (typeof master === 'boolean' ? master : true) &&
    (typeof own === 'boolean' ? own : tool.defaultEnabled)
  );
}

export interface AiToolDescription {
  toolId: string;
  available: boolean;
  promptVersion?: string | null;
  steps: AiRequestStep[];
}

/**
 * Publishes how each tool calls the model (prompt, model, effort, tools), for
 * the info button. Call it at startup, after migrations: svc-settings keeps the
 * latest one per tool.
 */
export async function describeAiTools(
  pool: pg.Pool,
  schema: string,
  service: string,
  tools: AiToolDescription[],
): Promise<void> {
  const describedAt = new Date().toISOString();
  await withTransaction(pool, async (client) => {
    for (const tool of tools) {
      requireAiTool(tool.toolId);
      const payload: AiToolDescribedV1 = {
        toolId: tool.toolId,
        service,
        available: tool.available,
        promptVersion: tool.promptVersion ?? null,
        steps: tool.steps,
        describedAt,
      };
      await enqueueEvent(client, schema, {
        type: AI_TOOL_DESCRIBED_EVENT,
        payload,
      });
    }
  });
}

/**
 * Records one use of a tool with the tokens each request used, so Settings
 * shows its real cost. Pass the client of a running transaction to write it
 * with the domain change, or the pool.
 */
export async function recordAiToolUse(
  db: pg.Pool | pg.PoolClient,
  schema: string,
  use: {
    toolId: string;
    service: string;
    outcome: 'ok' | 'error';
    error?: string | null;
    steps: AiStepUsage[];
  },
): Promise<void> {
  if (!use.steps.length) return;
  requireAiTool(use.toolId);
  const payload: AiToolUsedV1 = {
    toolId: use.toolId,
    service: use.service,
    outcome: use.outcome,
    error: use.error?.slice(0, 500) ?? null,
    steps: use.steps,
    usedAt: new Date().toISOString(),
  };
  const event = { type: AI_TOOL_USED_EVENT, payload };
  if ('release' in db) await enqueueEvent(db, schema, event);
  else
    await withTransaction(db, (client) => enqueueEvent(client, schema, event));
}

/** The usage of one Claude API response, in the shape `recordAiToolUse` takes. */
export function stepUsage(
  stepId: string,
  message: {
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
      server_tool_use?: { web_search_requests?: number | null } | null;
    };
  },
  latencyMs: number | null = null,
): AiStepUsage {
  return {
    stepId,
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    webSearches: message.usage.server_tool_use?.web_search_requests ?? 0,
    latencyMs,
  };
}
