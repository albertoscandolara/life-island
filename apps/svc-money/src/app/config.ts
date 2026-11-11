import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the spending review; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Money existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and MONEY_DATABASE_URL themselves.
 */
export const LOCAL_MONEY_PORT = 3012;
export const LOCAL_MONEY_DATABASE_URL =
  'postgres://money_svc:dev_money@localhost:5432/life_island';
export const DEFAULT_MONEY_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'MONEY_PORT',
      numberEnv('PORT', LOCAL_MONEY_PORT, env),
      env,
    ),
    databaseUrl: env['MONEY_DATABASE_URL'] || LOCAL_MONEY_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['MONEY_AI_MODEL']?.trim() || DEFAULT_MONEY_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
