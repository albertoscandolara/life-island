import { numberEnv } from '@life-island/be-common';
import type { AiGuardLimits } from '@life-island/contracts';

export interface SettingsConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The time zone months are counted in, for the monthly AI budget. */
  timezone: string;
  /**
   * The AI spending guard's limits (docs/security.md). From the environment
   * only, so nobody signed in can raise them from Settings.
   */
  aiLimits: AiGuardLimits;
}

/**
 * Local defaults, so a `.env` made before Settings existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and SETTINGS_DATABASE_URL themselves.
 */
export const LOCAL_SETTINGS_PORT = 3009;
export const LOCAL_SETTINGS_DATABASE_URL =
  'postgres://settings_svc:dev_settings@localhost:5432/life_island';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): SettingsConfig {
  return {
    port: numberEnv(
      'SETTINGS_PORT',
      numberEnv('PORT', LOCAL_SETTINGS_PORT, env),
      env,
    ),
    databaseUrl: env['SETTINGS_DATABASE_URL'] || LOCAL_SETTINGS_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    timezone: env['SETTINGS_TIMEZONE'] || 'Europe/Rome',
    aiLimits: {
      monthlyUsd: numberEnv('AI_HARD_MONTHLY_USD', 25, env),
      userDailyUsd: numberEnv('AI_USER_DAILY_USD', 5, env),
      userPerMinute: numberEnv('AI_USER_PER_MINUTE', 6, env),
      userPerHour: numberEnv('AI_USER_PER_HOUR', 60, env),
      maxCallUsd: numberEnv('AI_MAX_CALL_USD', 3, env),
    },
  };
}

export const CONFIG = Symbol('SettingsConfig');
export const SERVICE_DB = Symbol('ServiceDb');
