import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface PeopleConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files of ID documents. */
  ingestionUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PeopleConfig {
  return {
    port: numberEnv('PEOPLE_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('PEOPLE_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
  };
}

export const CONFIG = Symbol('PeopleConfig');
export const SERVICE_DB = Symbol('ServiceDb');
