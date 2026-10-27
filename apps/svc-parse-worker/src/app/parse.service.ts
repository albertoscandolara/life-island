import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import {
  DOCUMENT_PARSE_FAILED_EVENT,
  DOCUMENT_PARSED_EVENT,
  UPLOAD_PARSING_STARTED_EVENT,
  type DocumentParsedV1,
  type DocumentParseFailedV1,
  type UploadParsingStartedV1,
} from '@life-island/contracts';
import { parseRuns, uploads, type UploadRow } from '@life-island/ingestion-db';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  CONFIG,
  PARSER,
  SERVICE_DB,
  STORAGE,
  type WorkerConfig,
} from './config.js';
import { normalizeDocument } from './normalize.js';
import {
  PermanentParseError,
  type DocumentParser,
  type ParseResult,
  type ParseRunRecord,
} from './parsers/document-parser.js';

interface ClaimedRow {
  id: string;
  attempts: number;
}

/** Minutes to wait before attempt n+1: 1, 4, 16, 64... capped at one day. */
export function backoffMinutes(attempts: number): number {
  return Math.min(24 * 60, 4 ** Math.max(0, attempts - 1));
}

export interface RunSummary {
  parsed: number;
  retried: number;
  failed: number;
}

@Injectable()
export class ParseService {
  private readonly logger = new Logger(ParseService.name);

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(PARSER) private readonly parser: DocumentParser,
    @Inject(CONFIG) private readonly config: WorkerConfig,
  ) {}

  /**
   * Claims up to `limit` uploads ready to parse, plus PARSING ones whose lease
   * expired (a crashed worker). `skip locked` lets several workers run side by
   * side without ever taking the same row. The claim and its
   * `upload.parsing_started` events commit together.
   */
  async claimBatch(limit: number): Promise<UploadRow[]> {
    return withTransaction(this.svc.pool, async (client) => {
      const { rows } = await client.query<ClaimedRow>(
        `update ingestion.uploads
            set status = 'PARSING',
                locked_until = now() + make_interval(mins => $2),
                attempts = attempts + 1,
                updated_at = now()
          where id in (
            select id from ingestion.uploads
             where (status = 'TO_BE_PARSED' and next_attempt_at <= now())
                or (status = 'PARSING' and locked_until < now())
             order by created_at
             limit $1
             for update skip locked
          )
          returning id, attempts`,
        [limit, this.config.leaseMinutes],
      );
      const startedAt = new Date().toISOString();
      for (const row of rows) {
        const event: UploadParsingStartedV1 = {
          uploadId: row.id,
          attempt: row.attempts,
          startedAt,
        };
        await enqueueEvent(client, this.svc.schema, {
          type: UPLOAD_PARSING_STARTED_EVENT,
          payload: event,
        });
      }
      if (rows.length === 0) return [];
      return drizzle(client)
        .select()
        .from(uploads)
        .where(
          inArray(
            uploads.id,
            rows.map((row) => row.id),
          ),
        );
    });
  }

  /** Drains everything that is ready: claims batches until none are left. */
  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = { parsed: 0, retried: 0, failed: 0 };
    for (;;) {
      const batch = await this.claimBatch(this.config.batchSize);
      if (batch.length === 0) break;
      const queue = [...batch];
      const workers = Array.from(
        { length: Math.min(this.config.concurrency, queue.length) },
        async () => {
          for (let upload = queue.shift(); upload; upload = queue.shift()) {
            const outcome = await this.process(upload);
            summary[outcome]++;
          }
        },
      );
      await Promise.all(workers);
    }
    return summary;
  }

  async process(upload: UploadRow): Promise<keyof RunSummary> {
    let runs: ParseRunRecord[] = [];
    try {
      if (!upload.fileFormat)
        throw new PermanentParseError('The upload has no detected format');
      const bytes = await this.storage.getBytes(upload.storageKey);
      const document = await normalizeDocument(bytes, upload.fileFormat);
      const result = await this.parser.parse({
        document,
        filename: upload.originalFilename,
        title: upload.title,
        description: upload.description,
      });
      runs = result.runs;
      await this.saveResult(upload, result);
      this.logger.log(
        `Parsed ${upload.id} as ${result.targetKey} (${result.confidence})`,
      );
      return 'parsed';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = error as { runs?: ParseRunRecord[] };
      const permanent = error instanceof PermanentParseError;
      const outcome = await this.saveFailure(
        upload,
        message,
        permanent,
        failure.runs ?? runs,
      );
      this.logger.warn(`Parsing ${upload.id} failed (${outcome}): ${message}`);
      return outcome;
    }
  }

  private async saveResult(
    upload: UploadRow,
    result: ParseResult,
  ): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      await this.insertRuns(db, upload.id, result.runs);
      const [saved] = await db
        .update(uploads)
        .set({
          status: 'PARSED',
          categories: [result.category],
          targetKey: result.targetKey,
          details: result.details,
          confidence: result.confidence,
          flags: result.flags,
          description: upload.description ?? result.description ?? null,
          parsedAt: new Date(),
          lockedUntil: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'PARSING')))
        .returning();
      // Lost the lease to another worker that recovered the row; let that one report.
      if (!saved) return;
      const event: DocumentParsedV1 = {
        uploadId: saved.id,
        title: saved.title,
        description: saved.description,
        originalFilename: saved.originalFilename,
        fileFormat: saved.fileFormat!,
        sizeBytes: saved.sizeBytes ?? 0,
        uploadedAt: (saved.uploadedAt ?? saved.createdAt).toISOString(),
        category: result.category,
        targetKey: result.targetKey,
        details: result.details,
        confidence: result.confidence,
        flags: result.flags,
        parsedAt: saved.parsedAt!.toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: DOCUMENT_PARSED_EVENT,
        payload: event,
      });
    });
  }

  private async saveFailure(
    upload: UploadRow,
    message: string,
    permanent: boolean,
    runs: ParseRunRecord[],
  ): Promise<'retried' | 'failed'> {
    const giveUp = permanent || upload.attempts >= this.config.maxAttempts;
    await withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      await this.insertRuns(db, upload.id, runs);
      const [saved] = await db
        .update(uploads)
        .set({
          status: giveUp ? 'FAILED' : 'TO_BE_PARSED',
          lastError: message.slice(0, 2000),
          lockedUntil: null,
          nextAttemptAt: new Date(
            Date.now() + backoffMinutes(upload.attempts) * 60_000,
          ),
          updatedAt: new Date(),
        })
        .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'PARSING')))
        .returning();
      if (!saved || !giveUp) return;
      const event: DocumentParseFailedV1 = {
        uploadId: upload.id,
        error: message.slice(0, 2000),
        attempts: upload.attempts,
        failedAt: new Date().toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: DOCUMENT_PARSE_FAILED_EVENT,
        payload: event,
      });
    });
    return giveUp ? 'failed' : 'retried';
  }

  private async insertRuns(
    db: NodePgDatabase,
    uploadId: string,
    runs: ParseRunRecord[],
  ): Promise<void> {
    if (runs.length === 0) return;
    await db.insert(parseRuns).values(
      runs.map((run) => ({
        uploadId,
        step: run.step,
        model: run.model,
        promptVersion: run.promptVersion,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
        rawOutput: run.rawOutput,
        error: run.error,
      })),
    );
  }
}
