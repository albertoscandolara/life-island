import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the renewal advisor; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Contracts & subscriptions existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and SUBSCRIPTIONS_DATABASE_URL themselves.
 */
export const LOCAL_SUBSCRIPTIONS_PORT = 3015;
export const LOCAL_SUBSCRIPTIONS_DATABASE_URL =
  'postgres://subscriptions_svc:dev_subscriptions@localhost:5432/life_island';
export const DEFAULT_SUBSCRIPTIONS_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'SUBSCRIPTIONS_PORT',
      numberEnv('PORT', LOCAL_SUBSCRIPTIONS_PORT, env),
      env,
    ),
    databaseUrl: env['SUBSCRIPTIONS_DATABASE_URL'] || LOCAL_SUBSCRIPTIONS_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['SUBSCRIPTIONS_AI_MODEL']?.trim() || DEFAULT_SUBSCRIPTIONS_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
