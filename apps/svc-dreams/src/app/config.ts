import { numberEnv, sourcesEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the dream guide (questions and small steps); null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
  /** Where each area a dream may read answers GET /overview: `money=http://localhost:3012,…`. */
  sources: Record<string, string>;
}

/**
 * Local defaults, so a `.env` made before Dreams existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and DREAMS_DATABASE_URL themselves.
 */
export const LOCAL_DREAMS_PORT = 3019;
export const LOCAL_DREAMS_DATABASE_URL =
  'postgres://dreams_svc:dev_dreams@localhost:5432/life_island';
export const DEFAULT_DREAMS_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'DREAMS_PORT',
      numberEnv('PORT', LOCAL_DREAMS_PORT, env),
      env,
    ),
    databaseUrl: env['DREAMS_DATABASE_URL'] || LOCAL_DREAMS_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['DREAMS_AI_MODEL']?.trim() || DEFAULT_DREAMS_AI_MODEL,
    sources: sourcesEnv('DREAMS_SOURCES', LOCAL_DREAMS_SOURCES, env),
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');

/** The areas a dream can read, on your machine (npm run dev). */
export const LOCAL_DREAMS_SOURCES: Readonly<Record<string, string>> = {
  money: 'http://localhost:3012',
  work: 'http://localhost:3008',
  studies: 'http://localhost:3010',
  fitness: 'http://localhost:3018',
  travel: 'http://localhost:3017',
};
