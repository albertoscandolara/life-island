import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface ReviewConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /**
   * svc-ingestion, asked before every write whether a historical
   * reclassification holds the lock. Unset: no check (tests, a lone service).
   */
  ingestionUrl: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReviewConfig {
  return {
    port: numberEnv('REVIEW_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('REVIEW_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: env['INGESTION_URL']?.trim().replace(/\/+$/, '') || null,
  };
}

export const CONFIG = Symbol('ReviewConfig');
export const SERVICE_DB = Symbol('ServiceDb');
