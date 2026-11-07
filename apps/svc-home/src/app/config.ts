import {
  booleanEnv,
  numberEnv,
  requiredEnv,
  type StorageOptions,
} from '@life-island/be-common';

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
  /** svc-people, whose people are offered as house owners. */
  peopleUrl: string;
  /**
   * Object storage for the houses' 3D models, in this service's own bucket;
   * null when S3 is not configured (models cannot be uploaded then).
   */
  storage: StorageOptions | null;
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
    peopleUrl: (
      env['PEOPLE_URL'] ??
      `http://localhost:${numberEnv('PEOPLE_PORT', 3006, env)}`
    ).replace(/\/+$/, ''),
    storage:
      env['S3_ENDPOINT'] && env['S3_ACCESS_KEY'] && env['S3_SECRET_KEY']
        ? {
            endpoint: env['S3_ENDPOINT'],
            publicEndpoint: env['S3_PUBLIC_ENDPOINT'] || undefined,
            region: env['S3_REGION'] || 'us-east-1',
            accessKeyId: env['S3_ACCESS_KEY'],
            secretAccessKey: env['S3_SECRET_KEY'],
            bucket: env['HOME_S3_BUCKET'] || 'home-models',
          }
        : null,
  };
}

export const CONFIG = Symbol('HomeConfig');
export const SERVICE_DB = Symbol('ServiceDb');
