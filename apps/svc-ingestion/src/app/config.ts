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
  /**
   * Rows left in UPLOADING longer than this are marked FAILED. Presigned
   * upload URLs last 15 minutes, so an older row can no longer receive its file.
   */
  staleUploadMinutes: number;
  /**
   * Lease of the reclassification lock taken by Reclassify now; the worker
   * renews it. Same variable as the worker's.
   */
  reclassifyLeaseMinutes: number;
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
    staleUploadMinutes: numberEnv('STALE_UPLOAD_MINUTES', 20, env),
    reclassifyLeaseMinutes: numberEnv('RECLASSIFY_LEASE_MINUTES', 5, env),
  };
}

export const CONFIG = Symbol('IngestionConfig');
export const SERVICE_DB = Symbol('ServiceDb');
export const STORAGE = Symbol('ObjectStorage');
