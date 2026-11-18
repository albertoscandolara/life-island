import { internalHeaders } from '@life-island/be-common';
import { Logger } from '@nestjs/common';
import {
  isOwnPayable,
  PAYABLE_SOURCES,
  type AgendaSourceDto,
  type PayableDto,
  type PayablesQuery,
} from '@life-island/contracts';

/*
 * Reads `GET /payables` from every area that has them (principle 2: reads
 * over HTTP). An area that is off, not running or slow answers nothing
 * within the timeout: Money matches the rest and says which area it could not
 * read. Only an area's own, well-formed items are kept.
 */

const TIMEOUT_MS = 4000;
const logger = new Logger('PayableSources');

export interface PayablesRead {
  payables: PayableDto[];
  sources: AgendaSourceDto[];
}

export async function readPayables(
  sources: Readonly<Record<string, string>>,
  query: PayablesQuery,
  fetcher: typeof fetch = fetch,
): Promise<PayablesRead> {
  const results = await Promise.all(
    PAYABLE_SOURCES.map(async (source) => {
      const status: AgendaSourceDto = {
        module: source.module,
        name: source.name,
        emblem: source.emblem,
        ok: false,
        error: null,
        count: 0,
      };
      const base = sources[source.module];
      if (!base) {
        status.error = 'Not configured (PAYABLE_SOURCES)';
        return { status, payables: [] as PayableDto[] };
      }
      try {
        const response = await fetcher(
          `${base}/payables?from=${query.from}&to=${query.to}`,
          {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: internalHeaders(),
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as unknown;
        const seen = new Set<string>();
        const payables = (Array.isArray(body) ? body : []).filter(
          (p): p is PayableDto => {
            if (!isOwnPayable(p, source.module) || seen.has(p.key))
              return false;
            seen.add(p.key);
            return true;
          },
        );
        status.ok = true;
        status.count = payables.length;
        return { status, payables };
      } catch (error) {
        status.error =
          error instanceof Error
            ? error.name === 'TimeoutError'
              ? 'Did not answer in time'
              : error.message
            : String(error);
        logger.debug(`${source.module}: ${status.error}`);
        return { status, payables: [] as PayableDto[] };
      }
    }),
  );
  return {
    payables: results.flatMap((r) => r.payables),
    sources: results.map((r) => r.status),
  };
}
