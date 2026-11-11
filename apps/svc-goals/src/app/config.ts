import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the goals coach; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Goals & habits existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and GOALS_DATABASE_URL themselves.
 */
export const LOCAL_GOALS_PORT = 3013;
export const LOCAL_GOALS_DATABASE_URL =
  'postgres://goals_svc:dev_goals@localhost:5432/life_island';
export const DEFAULT_GOALS_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'GOALS_PORT',
      numberEnv('PORT', LOCAL_GOALS_PORT, env),
      env,
    ),
    databaseUrl: env['GOALS_DATABASE_URL'] || LOCAL_GOALS_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['GOALS_AI_MODEL']?.trim() || DEFAULT_GOALS_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
