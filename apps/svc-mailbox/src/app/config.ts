import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the letter explainer; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Admin mailbox existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and MAILBOX_DATABASE_URL themselves.
 */
export const LOCAL_MAILBOX_PORT = 3016;
export const LOCAL_MAILBOX_DATABASE_URL =
  'postgres://mailbox_svc:dev_mailbox@localhost:5432/life_island';
export const DEFAULT_MAILBOX_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'MAILBOX_PORT',
      numberEnv('PORT', LOCAL_MAILBOX_PORT, env),
      env,
    ),
    databaseUrl: env['MAILBOX_DATABASE_URL'] || LOCAL_MAILBOX_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['MAILBOX_AI_MODEL']?.trim() || DEFAULT_MAILBOX_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
