import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface CarsConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files of car documents. */
  ingestionUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CarsConfig {
  return {
    port: numberEnv('CARS_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('CARS_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
  };
}

export const CONFIG = Symbol('CarsConfig');
export const SERVICE_DB = Symbol('ServiceDb');
