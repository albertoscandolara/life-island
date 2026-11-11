import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the test results explainer; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Health existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and HEALTH_DATABASE_URL themselves.
 */
export const LOCAL_HEALTH_PORT = 3014;
export const LOCAL_HEALTH_DATABASE_URL =
  'postgres://health_svc:dev_health@localhost:5432/life_island';
export const DEFAULT_HEALTH_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'HEALTH_PORT',
      numberEnv('PORT', LOCAL_HEALTH_PORT, env),
      env,
    ),
    databaseUrl: env['HEALTH_DATABASE_URL'] || LOCAL_HEALTH_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['HEALTH_AI_MODEL']?.trim() || DEFAULT_HEALTH_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
