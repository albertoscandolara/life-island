import {
  listEnv,
  numberEnv,
  requiredEnv,
  storageOptionsFromEnv,
  type StorageOptions,
} from '@life-island/be-common';

export interface IngestionConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  storage: StorageOptions;
  /** Browser origins allowed to PUT files straight into the bucket. */
  storageCorsOrigins: string[];
  /** Rows left in UPLOADING longer than this are marked FAILED. */
  staleUploadMinutes: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): IngestionConfig {
  return {
    port: numberEnv('INGESTION_PORT', numberEnv('PORT', 3000, env), env),
    databaseUrl: requiredEnv('INGESTION_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    storage: storageOptionsFromEnv(env),
    storageCorsOrigins: listEnv('STORAGE_CORS_ORIGINS', env),
    staleUploadMinutes: numberEnv('STALE_UPLOAD_MINUTES', 60, env),
  };
}

export const CONFIG = Symbol('IngestionConfig');
export const SERVICE_DB = Symbol('ServiceDb');
export const STORAGE = Symbol('ObjectStorage');
