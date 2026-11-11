import { numberEnv } from '@life-island/be-common';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  natsUrl: string;
  /** The Claude API key for the week brief; null keeps it on Life Island's own rules. */
  anthropicApiKey: string | null;
  aiModel: string;
  /** Where each area answers GET /deadlines: `people=http://localhost:3006,…`. */
  sources: Record<string, string>;
}

/**
 * Local defaults, so a `.env` made before Agenda existed still runs it: the
 * port and the role of the compose stack (`infra/postgres/init`). Containers
 * set PORT and AGENDA_DATABASE_URL themselves.
 */
export const LOCAL_AGENDA_PORT = 3011;
export const LOCAL_AGENDA_DATABASE_URL =
  'postgres://agenda_svc:dev_agenda@localhost:5432/life_island';
export const DEFAULT_AGENDA_AI_MODEL = 'claude-haiku-5-5';

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    port: numberEnv(
      'AGENDA_PORT',
      numberEnv('PORT', LOCAL_AGENDA_PORT, env),
      env,
    ),
    databaseUrl: env['AGENDA_DATABASE_URL'] || LOCAL_AGENDA_DATABASE_URL,
    natsUrl: env['NATS_URL'] || 'nats://localhost:4222',
    anthropicApiKey: env['ANTHROPIC_API_KEY']?.trim() || null,
    aiModel: env['AGENDA_AI_MODEL']?.trim() || DEFAULT_AGENDA_AI_MODEL,
    sources: parseSources(env['AGENDA_SOURCES']),
  };
}

export const CONFIG = Symbol('ServiceConfig');
export const SERVICE_DB = Symbol('ServiceDb');

/** The areas svc-agenda reads, on your machine (npm run dev). */
export const LOCAL_AGENDA_SOURCES: Readonly<Record<string, string>> = {
  people: 'http://localhost:3006',
  cars: 'http://localhost:3007',
  home: 'http://localhost:3005',
  studies: 'http://localhost:3010',
  money: 'http://localhost:3012',
  goals: 'http://localhost:3013',
  health: 'http://localhost:3014',
  subscriptions: 'http://localhost:3015',
  mailbox: 'http://localhost:3016',
  travel: 'http://localhost:3017',
  fitness: 'http://localhost:3018',
};

/** `people=http://svc-people:3000,cars=…`; the local ports when unset. */
export function parseSources(
  value: string | undefined,
): Record<string, string> {
  if (!value?.trim()) return { ...LOCAL_AGENDA_SOURCES };
  const sources: Record<string, string> = {};
  for (const part of value.split(',')) {
    const [module, url] = part.split('=').map((s) => s.trim());
    if (module && url) sources[module] = url.replace(/\/+$/, '');
  }
  return sources;
}
