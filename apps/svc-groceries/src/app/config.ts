import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface GroceriesConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GroceriesConfig {
  return {
    port: numberEnv('GROCERY_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('GROCERY_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
  };
}

export const CONFIG = Symbol('GroceriesConfig');
export const SERVICE_DB = Symbol('ServiceDb');
