import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the trip planner; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Travel existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and TRAVEL_DATABASE_URL themselves.
 */
export const LOCAL_TRAVEL_PORT = 3017;
export const LOCAL_TRAVEL_DATABASE_URL =
  'postgres://travel_svc:dev_travel@localhost:5432/life_island';
export const DEFAULT_TRAVEL_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'TRAVEL_PORT',
      numberEnv('PORT', LOCAL_TRAVEL_PORT, env),
      env,
    ),
    databaseUrl: env['TRAVEL_DATABASE_URL'] || LOCAL_TRAVEL_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['TRAVEL_AI_MODEL']?.trim() || DEFAULT_TRAVEL_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
