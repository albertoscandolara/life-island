import { numberEnv } from '@life-island/be-common';

export interface SettingsConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The time zone months are counted in, for the monthly AI budget. */
  timezone: string;
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
  };
}

export const CONFIG = Symbol('SettingsConfig');
export const SERVICE_DB = Symbol('ServiceDb');
