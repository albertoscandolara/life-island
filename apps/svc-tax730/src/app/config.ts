import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface Tax730Config {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files for the commercialista's zip. */
  ingestionUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Tax730Config {
  return {
    port: numberEnv('TAX730_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('TAX730_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
  };
}

export const CONFIG = Symbol('Tax730Config');
export const SERVICE_DB = Symbol('ServiceDb');
