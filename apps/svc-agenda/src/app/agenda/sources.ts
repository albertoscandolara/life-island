import { Logger } from '@nestjs/common';
import {
  DEADLINE_SOURCES,
  type AgendaSourceDto,
  type DeadlineDto,
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
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as unknown;
        const deadlines = (Array.isArray(body) ? body : [])
          .filter(isDeadline)
          .map((d) => ({ ...d, module: source.module }));
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
