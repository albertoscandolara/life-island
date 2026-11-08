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
  /**
   * Object storage for the cars' 3D models, in this service's own bucket;
   * null when S3 is not configured (models cannot be uploaded then).
   */
  storage: StorageOptions | null;
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
  };
}

export const CONFIG = Symbol('CarsConfig');
export const SERVICE_DB = Symbol('ServiceDb');
