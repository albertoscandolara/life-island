import {
  AI_BUDGET_REACHED_SETTING,
  AI_ENABLED_SETTING,
  aiModelSettingKey,
  aiToolModelChoices,
  AI_TOOL_DESCRIBED_EVENT,
  AI_TOOL_USED_EVENT,
  aiToolSettingKey,
  appSetting,
  requireAiTool,
  settingChangedV1Schema,
  validSettingValue,
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
  return rows[0]?.value ?? undefined;
}

/**
 * Several settings at once, by key; a key Settings never set (or reset to
 * its default, stored as null) is missing.
 */
export async function readSettings(
  db: Queryable,
  schema: string,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `select key, value from ${assertSchemaName(schema)}.${SETTINGS_REPLICA_TABLE} where key = any($1)`,
    [keys],
  );
  return new Map(
    rows.filter((row) => row.value !== null).map((row) => [row.key, row.value]),
  );
}

/** A whole-number setting: the replica, else the registry default. */
export async function readNumberSetting(
  db: Queryable,
  schema: string,
  key: string,
): Promise<number> {
  const value = await readSetting(db, schema, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fallback = appSetting(key)?.default;
  return typeof fallback === 'number' ? fallback : 0;
}

/**
 * Several whole-number settings by name, e.g. the reminder windows: each one
 * from the replica when it holds a valid value, else its registry default.
 */
export async function readNumberSettings<K extends string>(
  db: Queryable,
  schema: string,
  keyOf: Readonly<Record<K, string>>,
): Promise<Record<K, number>> {
  const names = Object.keys(keyOf) as K[];
  const stored = await readSettings(
    db,
    schema,
    names.map((name) => keyOf[name]),
  );
  return Object.fromEntries(
    names.map((name) => {
      const key = keyOf[name];
      const value = stored.get(key);
      const fallback = appSetting(key)?.default;
      return [
        name,
        validSettingValue(key, value)
          ? value
          : typeof fallback === 'number'
            ? fallback
            : 0,
      ];
    }),
  ) as Record<K, number>;
}

/**
 * The model you picked for a tool in Settings, or null while its service
 * decides (its env, else the registry default). A value that is not one of
 * the tool's choices is ignored.
 */
export async function aiToolModel(
  db: Queryable,
  schema: string,
  toolId: string,
): Promise<string | null> {
  const tool = requireAiTool(toolId);
  const value = await readSetting(db, schema, aiModelSettingKey(toolId));
  return typeof value === 'string' && aiToolModelChoices(tool).includes(value)
    ? value
    : null;
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
 * Whether a tool may call the model now: the master switch, its own switch
 * and the monthly budget (svc-settings sets AI_BUDGET_REACHED_SETTING when AI
 * must stop), from this service's replica (the registry defaults until set).
 */
export async function isAiToolEnabled(
  db: Queryable,
  schema: string,
  toolId: string,
): Promise<boolean> {
  const tool = requireAiTool(toolId);
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `select key, value from ${assertSchemaName(schema)}.${SETTINGS_REPLICA_TABLE} where key = any($1)`,
    [[AI_ENABLED_SETTING, aiToolSettingKey(toolId), AI_BUDGET_REACHED_SETTING]],
  );
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  const master = value(AI_ENABLED_SETTING);
  const own = value(aiToolSettingKey(toolId));
  return (
    value(AI_BUDGET_REACHED_SETTING) !== true &&
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
