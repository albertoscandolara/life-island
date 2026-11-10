import { numberEnv } from '@life-island/be-common';

export interface StudiesConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /**
   * The Claude API key for the study coach, the same one the parse worker
   * reads; null writes the plan with Life Island's own rules instead.
   */
  anthropicApiKey: string | null;
  coachModel: string;
}

/**
 * Local defaults, so a `.env` made before Studies existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and STUDIES_DATABASE_URL themselves.
 */
export const LOCAL_STUDIES_PORT = 3010;
export const LOCAL_STUDIES_DATABASE_URL =
  'postgres://studies_svc:dev_studies@localhost:5432/life_island';
export const DEFAULT_COACH_MODEL = 'claude-sonnet-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): StudiesConfig {
  return {
    port: numberEnv(
      'STUDIES_PORT',
      numberEnv('PORT', LOCAL_STUDIES_PORT, env),
      env,
    ),
    databaseUrl: env['STUDIES_DATABASE_URL'] || LOCAL_STUDIES_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    coachModel: env['STUDIES_AI_MODEL']?.trim() || DEFAULT_COACH_MODEL,
  };
}

export const CONFIG = Symbol('StudiesConfig');
export const SERVICE_DB = Symbol('ServiceDb');
