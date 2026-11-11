import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the training plan; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Fitness existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and FITNESS_DATABASE_URL themselves.
 */
export const LOCAL_FITNESS_PORT = 3018;
export const LOCAL_FITNESS_DATABASE_URL =
  'postgres://fitness_svc:dev_fitness@localhost:5432/life_island';
export const DEFAULT_FITNESS_AI_MODEL = 'claude-haiku-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'FITNESS_PORT',
      numberEnv('PORT', LOCAL_FITNESS_PORT, env),
      env,
    ),
    databaseUrl: env['FITNESS_DATABASE_URL'] || LOCAL_FITNESS_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['FITNESS_AI_MODEL']?.trim() || DEFAULT_FITNESS_AI_MODEL,
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');
