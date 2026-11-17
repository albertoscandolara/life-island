import { internalHeaders } from '@life-island/be-common';
import { Logger } from '@nestjs/common';
import {
  ATTENTION_SOURCES,
  DEADLINE_SOURCES,
  type AgendaSourceDto,
  type AgendaWaitingDto,
  type DeadlineDto,
  type LifeAttentionItemDto,
} from '@life-island/contracts';

/*
 * Reads `GET /deadlines` from every area (principle 2: reads over HTTP). An
 * area that is off, not running or slow answers nothing within the timeout:
 * the agenda still shows the rest and says which area it could not read.
 */

const TIMEOUT_MS = 4000;
const logger = new Logger('AgendaSources');

export async function readDeadlines(
  sources: Readonly<Record<string, string>>,
  window: { from: string; to: string },
  fetcher: typeof fetch = fetch,
): Promise<{ deadlines: DeadlineDto[]; sources: AgendaSourceDto[] }> {
  const results = await Promise.all(
    DEADLINE_SOURCES.map(async (source) => {
      const base = sources[source.module];
      const status: AgendaSourceDto = {
        module: source.module,
        name: source.name,
        emblem: source.emblem,
        ok: false,
        error: null,
        count: 0,
      };
      if (!base) {
        status.error = 'Not configured (AGENDA_SOURCES)';
        return { status, deadlines: [] as DeadlineDto[] };
      }
      try {
        const response = await fetcher(
          `${base}/deadlines?from=${window.from}&to=${window.to}`,
          { signal: AbortSignal.timeout(TIMEOUT_MS), headers: internalHeaders() },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as unknown;
        const deadlines = (Array.isArray(body) ? body : [])
          .filter(isDeadline)
          .map((d) => ({
            ...d,
            module: source.module,
            autoPaid: d.autoPaid === true,
            done: d.done === true,
          }));
        status.ok = true;
        status.count = deadlines.length;
        return { status, deadlines };
      } catch (error) {
        status.error = describe(error);
        logger.debug(`${source.module}: ${status.error}`);
        return { status, deadlines: [] as DeadlineDto[] };
      }
    }),
  );
  return {
    deadlines: results.flatMap((r) => r.deadlines),
    sources: results.map((r) => r.status),
  };
}

/**
 * Reads `GET /attention` from every area for the undated things that wait for
 * you (its `items`). An area that does not answer is left out: its own badge
 * on the island still counts them, and the Agenda's dates say it is down.
 */
export async function readWaiting(
  sources: Readonly<Record<string, string>>,
  fetcher: typeof fetch = fetch,
): Promise<AgendaWaitingDto[]> {
  const results = await Promise.all(
    ATTENTION_SOURCES.map(async (source) => {
      const base = sources[source.module];
      if (!base) return [];
      try {
        const response = await fetcher(`${base}/attention`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: internalHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { items?: unknown } | null;
        return (Array.isArray(body?.items) ? body.items : [])
          .filter(isAttentionItem)
          .map((item): AgendaWaitingDto => ({
            ...item,
            detail: item.detail ?? null,
            since:
              typeof item.since === 'string' &&
              /^\d{4}-\d{2}-\d{2}/.test(item.since)
                ? item.since.slice(0, 10)
                : null,
            key: `${source.module}:${item.id}`,
            module: source.module,
          }));
      } catch (error) {
        logger.debug(`${source.module} attention: ${describe(error)}`);
        return [];
      }
    }),
  );
  // Oldest first: what has waited longest; undated ones after.
  return results
    .flat()
    .sort((a, b) => (a.since ?? '9999').localeCompare(b.since ?? '9999'));
}

function isAttentionItem(value: unknown): value is LifeAttentionItemDto {
  const i = value as Partial<LifeAttentionItemDto> | null;
  return (
    !!i &&
    typeof i.id === 'string' &&
    typeof i.title === 'string' &&
    typeof i.path === 'string' &&
    i.path.startsWith('/') &&
    typeof i.action === 'string' &&
    typeof i.kind === 'string'
  );
}

function isDeadline(value: unknown): value is DeadlineDto {
  const d = value as Partial<DeadlineDto> | null;
  return (
    !!d &&
    typeof d.id === 'string' &&
    typeof d.title === 'string' &&
    typeof d.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.date)
  );
}

function describe(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'Did not answer in time';
  const message = String((error as Error)?.message ?? error);
  if (/ECONNREFUSED|fetch failed/i.test(message)) return 'Not running';
  return message.slice(0, 120);
}
