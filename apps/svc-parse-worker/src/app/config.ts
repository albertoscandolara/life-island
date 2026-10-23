import {
  booleanEnv,
  numberEnv,
  requiredEnv,
  storageOptionsFromEnv,
  type StorageOptions,
} from '@life-island/be-common';

export type ParserKind = 'claude' | 'fake';

export interface WorkerConfig {
  databaseUrl: string;
  natsUrl: string;
  storage: StorageOptions;
  /** Cron expression for the scheduled run; the default runs every day at 03:00. */
  schedule: string;
  timezone?: string;
  /** Also run once right after startup. */
  runOnStart: boolean;
  batchSize: number;
  concurrency: number;
  maxAttempts: number;
  /** How long a claimed upload stays locked before another worker may recover it. */
  leaseMinutes: number;
  parser: ParserKind;
  classifyModel: string;
  extractModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parser = (env['PARSER'] ||
    (env['ANTHROPIC_API_KEY'] ? 'claude' : 'fake')) as ParserKind;
  if (parser !== 'claude' && parser !== 'fake') {
    throw new Error(`PARSER must be "claude" or "fake", got "${parser}"`);
  }
  return {
    databaseUrl: requiredEnv('INGESTION_DATABASE_URL', env),
    natsUrl: requiredEnv('NATS_URL', env),
    storage: storageOptionsFromEnv(env),
    schedule: env['PARSE_SCHEDULE'] || '0 3 * * *',
    timezone: env['PARSE_TIMEZONE'] || undefined,
    runOnStart: booleanEnv('PARSE_RUN_ON_START', false, env),
    batchSize: numberEnv('PARSE_BATCH_SIZE', 10, env),
    concurrency: numberEnv('PARSE_CONCURRENCY', 4, env),
    maxAttempts: numberEnv('PARSE_MAX_ATTEMPTS', 5, env),
    leaseMinutes: numberEnv('PARSE_LEASE_MINUTES', 5, env),
    parser,
    // Cheap model to classify, stronger model to extract (docs/architecture.md, AI extraction workflow).
    classifyModel: env['PARSE_CLASSIFY_MODEL'] || 'claude-haiku-5-5',
    extractModel: env['PARSE_EXTRACT_MODEL'] || 'claude-sonnet-5-5',
  };
}

export const CONFIG = Symbol('WorkerConfig');
export const SERVICE_DB = Symbol('ServiceDb');
export const STORAGE = Symbol('ObjectStorage');
export const PARSER = Symbol('DocumentParser');
