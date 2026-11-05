import { booleanEnv, numberEnv, requiredEnv } from '@life-island/be-common';

export interface HomeConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files of bills and work invoices. */
  ingestionUrl: string;
  /**
   * Link every home to a PROPERTY category of the documents app, creating it
   * through svc-ingestion when none names the home (on by default).
   */
  linkPropertyCategories: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HomeConfig {
  return {
    port: numberEnv('HOME_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('HOME_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
    linkPropertyCategories: booleanEnv(
      'HOME_LINK_PROPERTY_CATEGORIES',
      true,
      env,
    ),
  };
}

export const CONFIG = Symbol('HomeConfig');
export const SERVICE_DB = Symbol('ServiceDb');
