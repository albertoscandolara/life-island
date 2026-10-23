import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface ReviewConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReviewConfig {
  return {
    port: numberEnv('REVIEW_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('REVIEW_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
  };
}

export const CONFIG = Symbol('ReviewConfig');
export const SERVICE_DB = Symbol('ServiceDb');
