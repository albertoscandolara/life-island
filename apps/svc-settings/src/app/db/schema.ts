import {
  boolean,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AiRequestStep, AiStepUsage } from '@life-island/contracts';

export const settingsSchema = pgSchema('settings');

/**
 * Every value you set in Settings: the server app settings and the switch of
 * each AI tool (`ai-tool.<id>`). A key with no row still has its registry default.
 */
export const settingValues = settingsSchema.table('setting_values', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** How each AI tool calls the model, as its service last reported it (`ai.tool_described@1`). */
export const aiToolRequests = settingsSchema.table('ai_tool_requests', {
  toolId: text('tool_id').primaryKey(),
  service: text('service').notNull(),
  available: boolean('available').notNull(),
  promptVersion: text('prompt_version'),
  steps: jsonb('steps').$type<AiRequestStep[]>().notNull(),
  describedAt: timestamp('described_at', { withTimezone: true }).notNull(),
});

/** One use of an AI tool with the tokens it used (`ai.tool_used@1`); the event id keeps it unique. */
export const aiToolUses = settingsSchema.table(
  'ai_tool_uses',
  {
    id: uuid('id').primaryKey(),
    toolId: text('tool_id').notNull(),
    service: text('service').notNull(),
    outcome: text('outcome').$type<'ok' | 'error'>().notNull(),
    error: text('error'),
    costUsd: numeric('cost_usd', {
      precision: 12,
      scale: 6,
      mode: 'number',
    }).notNull(),
    steps: jsonb('steps').$type<AiStepUsage[]>().notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('ai_tool_uses_tool_idx').on(table.toolId, table.usedAt)],
);

/**
 * The spending guard's ledger (docs/security.md, "AI cost guards"): every
 * model call reserves its worst-case cost here before it starts and settles
 * the real cost after, so limits hold at once, even for calls in parallel.
 */
export const aiReservations = settingsSchema.table(
  'ai_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: text('tool_id').notNull(),
    service: text('service').notNull(),
    /** The signed-in person who asked; null for background work (the parse worker). */
    userId: text('user_id'),
    reservedUsd: numeric('reserved_usd', {
      precision: 12,
      scale: 6,
      mode: 'number',
    }).notNull(),
    /** The real cost once the call ended; null while it runs. */
    actualUsd: numeric('actual_usd', {
      precision: 12,
      scale: 6,
      mode: 'number',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    index('ai_reservations_created_idx').on(table.createdAt),
    index('ai_reservations_user_idx').on(table.userId, table.createdAt),
  ],
);
