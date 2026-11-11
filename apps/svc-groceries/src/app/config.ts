import { numberEnv, requiredEnv } from '@life-island/be-common';

export interface GroceriesConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the shopping list; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
}

export const DEFAULT_GROCERIES_AI_MODEL = 'claude-haiku-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GroceriesConfig {
  return {
    port: numberEnv('GROCERY_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('GROCERY_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['GROCERIES_AI_MODEL']?.trim() || DEFAULT_GROCERIES_AI_MODEL,
  };
}

export const CONFIG = Symbol('GroceriesConfig');
export const SERVICE_DB = Symbol('ServiceDb');
