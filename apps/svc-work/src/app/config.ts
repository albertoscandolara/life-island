import { numberEnv } from '@life-island/be-common';

export interface WorkConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files of work documents. */
  ingestionUrl: string;
  /**
   * The Claude API key for the career feedback, the same one the parse worker
   * reads; null writes the feedback with Life Island's own rules instead.
   */
  anthropicApiKey: string | null;
  feedbackModel: string;
}

/**
 * Local defaults, so a `.env` made before Work existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and WORK_DATABASE_URL themselves.
 */
export const LOCAL_WORK_PORT = 3008;
export const LOCAL_WORK_DATABASE_URL =
  'postgres://work_svc:dev_work@localhost:5432/life_island';
export const DEFAULT_FEEDBACK_MODEL = 'claude-sonnet-5-5';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkConfig {
  return {
    port: numberEnv('WORK_PORT', numberEnv('PORT', LOCAL_WORK_PORT, env), env),
    databaseUrl: env['WORK_DATABASE_URL'] || LOCAL_WORK_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    feedbackModel: env['WORK_FEEDBACK_MODEL']?.trim() || DEFAULT_FEEDBACK_MODEL,
  };
}

export const CONFIG = Symbol('WorkConfig');
export const SERVICE_DB = Symbol('ServiceDb');
