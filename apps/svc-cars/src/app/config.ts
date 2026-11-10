import {
  numberEnv,
  requiredEnv,
  type StorageOptions,
} from '@life-island/be-common';

export interface CarsConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** svc-ingestion, which serves the original files of car documents. */
  ingestionUrl: string;
  /** svc-people, whose people are offered as the holder and owner of a car. */
  peopleUrl: string;
  /**
   * Object storage for the cars' 3D models, in this service's own bucket;
   * null when S3 is not configured (models cannot be uploaded then).
   */
  storage: StorageOptions | null;
  /**
   * The Claude API key for the insurance quote comparison, the same one the
   * parse worker reads; null leaves the comparison unavailable.
   */
  anthropicApiKey: string | null;
  aiModel: string;
}

/**
 * Local defaults, so a `.env` made before Cars existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and CARS_DATABASE_URL themselves.
 */
export const LOCAL_CARS_PORT = 3007;
export const LOCAL_CARS_DATABASE_URL =
  'postgres://cars_svc:dev_cars@localhost:5432/life_island';

export const DEFAULT_CARS_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CarsConfig {
  return {
    port: numberEnv('CARS_PORT', numberEnv('PORT', LOCAL_CARS_PORT, env), env),
    databaseUrl: env['CARS_DATABASE_URL'] || LOCAL_CARS_DATABASE_URL,
    natsUrl: requiredEnv('NATS_URL', env),
    ingestionUrl: (
      env['INGESTION_URL'] ??
      `http://localhost:${numberEnv('INGESTION_PORT', 3001, env)}`
    ).replace(/\/+$/, ''),
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
            bucket: env['CARS_S3_BUCKET'] || 'cars-models',
          }
        : null,
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['CARS_AI_MODEL']?.trim() || DEFAULT_CARS_AI_MODEL,
  };
}

export const CONFIG = Symbol('CarsConfig');
export const SERVICE_DB = Symbol('ServiceDb');
