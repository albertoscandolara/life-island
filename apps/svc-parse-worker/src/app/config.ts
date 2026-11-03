import {
  booleanEnv,
  numberEnv,
  requiredEnv,
  storageOptionsFromEnv,
  type StorageOptions,
} from '@life-island/be-common';

export type ParserKind = 'claude' | 'fake';

/** How much the model may think before answering: lower is cheaper and faster. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function effortEnv(
  name: string,
  fallback: Effort,
  env: NodeJS.ProcessEnv = process.env,
): Effort {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (!EFFORTS.includes(raw as Effort))
    throw new Error(
      `${name} must be one of ${EFFORTS.join(', ')}, got "${raw}"`,
    );
  return raw as Effort;
}

export interface WorkerConfig {
  databaseUrl: string;
  natsUrl: string;
  storage: StorageOptions;
  /** Cron expression for the daily run; the default runs every day at 06:00. */
  schedule: string;
  timezone?: string;
  /** Also run once right after startup. */
  runOnStart: boolean;
  maxAttempts: number;
  /** How long a claimed upload stays locked before another worker may recover it. */
  leaseMinutes: number;
  /**
   * First wait after the AI usage quota runs out when the provider gives no
   * reset time. It doubles after each failed check, up to `quotaRetryMaxMinutes`.
   */
  quotaRetryMinutes: number;
  quotaRetryMaxMinutes: number;
  /** Wait after a rate limit that came without a retry-after time. */
  rateLimitRetrySeconds: number;
  /** Save suggested categories straight into the category table (off: they wait for approval). */
  autoApproveCategories: boolean;
  /** Text longer than this is split into chunks when it does not fit the model's context. */
  chunkChars: number;
  parser: ParserKind;
  classifyModel: string;
  extractModel: string;
  discoverModel: string;
  /**
   * Effort of the discovery and extraction calls. Short documents rarely need
   * long reasoning, and thinking tokens are billed as output.
   */
  discoverEffort: Effort;
  extractEffort: Effort;
  /**
   * Send the scheduled runs through the Message Batches API: half the price,
   * results usually within the hour (at most 24 h). Parse now stays direct.
   */
  batch: boolean;
  /** Documents processed side by side in one batch round. */
  batchMaxDocuments: number;
  batchPollSeconds: number;
  /** Fake parser only: simulate a usage quota of this many AI steps per period (0 = unlimited). */
  fakeQuotaSteps: number;
  fakeQuotaPeriodMinutes: number;
}

/**
 * `PARSE_SCHEDULE` is a cron expression, or simply a time of day (`06:00`,
 * `6:30`), which means every day at that time.
 */
export function scheduleToCron(value: string | undefined): string {
  const schedule = value?.trim() || '06:00';
  const time = /^(\d{1,2}):(\d{2})$/.exec(schedule);
  if (!time) return schedule;
  const [hours, minutes] = [Number(time[1]), Number(time[2])];
  if (hours > 23 || minutes > 59)
    throw new Error(`PARSE_SCHEDULE "${schedule}" is not a valid time of day`);
  return `${minutes} ${hours} * * *`;
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
    schedule: scheduleToCron(env['PARSE_SCHEDULE']),
    timezone: env['PARSE_TIMEZONE'] || undefined,
    runOnStart: booleanEnv('PARSE_RUN_ON_START', false, env),
    maxAttempts: numberEnv('PARSE_MAX_ATTEMPTS', 5, env),
    leaseMinutes: numberEnv('PARSE_LEASE_MINUTES', 5, env),
    quotaRetryMinutes: numberEnv('PARSE_QUOTA_RETRY_MINUTES', 360, env),
    quotaRetryMaxMinutes: numberEnv('PARSE_QUOTA_RETRY_MAX_MINUTES', 1440, env),
    rateLimitRetrySeconds: numberEnv('PARSE_RATE_LIMIT_RETRY_SECONDS', 60, env),
    autoApproveCategories: booleanEnv('CATEGORY_AUTO_APPROVE', false, env),
    chunkChars: numberEnv('PARSE_CHUNK_CHARS', 200_000, env),
    parser,
    // Cheap model to classify, stronger ones to extract and to design new categories
    // (docs/architecture.md, AI extraction workflow).
    classifyModel: env['PARSE_CLASSIFY_MODEL'] || 'claude-haiku-5-5',
    extractModel: env['PARSE_EXTRACT_MODEL'] || 'claude-sonnet-5-5',
    discoverModel: env['PARSE_DISCOVER_MODEL'] || 'claude-sonnet-5-5',
    discoverEffort: effortEnv('PARSE_DISCOVER_EFFORT', 'low', env),
    extractEffort: effortEnv('PARSE_EXTRACT_EFFORT', 'low', env),
    batch: booleanEnv('PARSE_BATCH', true, env),
    batchMaxDocuments: Math.max(
      1,
      numberEnv('PARSE_BATCH_MAX_DOCUMENTS', 100, env),
    ),
    batchPollSeconds: Math.max(
      5,
      numberEnv('PARSE_BATCH_POLL_SECONDS', 60, env),
    ),
    fakeQuotaSteps: numberEnv('FAKE_QUOTA_STEPS', 0, env),
    fakeQuotaPeriodMinutes: numberEnv('FAKE_QUOTA_PERIOD_MINUTES', 60, env),
  };
}

export const CONFIG = Symbol('WorkerConfig');
export const SERVICE_DB = Symbol('ServiceDb');
export const STORAGE = Symbol('ObjectStorage');
export const PARSER = Symbol('DocumentAnalyzer');
