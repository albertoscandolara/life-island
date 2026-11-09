import { Logger } from '@nestjs/common';
import {
  withTransaction,
  type ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import type { TransactionFacts } from '@life-island/contracts';
import {
  parseRuns,
  relinkDocuments,
  uploads,
  type UploadRow,
} from '@life-island/ingestion-db';
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { normalizeDocument } from './normalize.js';
import type { ParseQueue } from './parse-queue.js';
import {
  ContextTooLargeError,
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
  type DocumentAnalyzer,
  type ParseRunRecord,
} from './parsers/document-parser.js';
import { noTransaction } from './transaction-facts.js';

export interface LinkingSummary {
  /** Documents whose money facts were read. */
  read: number;
  /** Links the matcher added, changed or removed across all documents. */
  linksChanged: number;
  /** The pass stopped for the AI provider (quota, rate limit, credentials). */
  stopped: boolean;
}

/**
 * Invoice and payment matching, run by the parse worker after its documents.
 * For every PARSED document whose money facts are not known yet (just
 * parsed, parsed again, or parsed before matching existed) it asks the
 * analyzer for them, stores them and relinks: the matcher looks at every
 * invoice, quote and payment, so a payment uploaded months after its invoice
 * is linked the moment it is read, and the other way round.
 */
export class TransactionLinker {
  private readonly logger = new Logger(TransactionLinker.name);

  constructor(
    private readonly svc: ServiceDb,
    private readonly storage: ObjectStorage,
    private readonly analyzer: DocumentAnalyzer,
    private readonly queue: ParseQueue,
  ) {}

  /** Reads documents until none is left, `shouldStop` says so or the provider stops it. */
  async run(shouldStop: () => boolean = () => false): Promise<LinkingSummary> {
    const summary: LinkingSummary = {
      read: 0,
      linksChanged: 0,
      stopped: false,
    };
    /** Documents that failed for a passing reason: next run tries them again. */
    const skipped: string[] = [];
    while (!shouldStop() && (await this.queue.canProceed())) {
      const [upload] = await this.svc.db
        .select()
        .from(uploads)
        .where(
          and(
            eq(uploads.status, 'PARSED'),
            isNull(uploads.transactionFacts),
            ...(skipped.length ? [notInArray(uploads.id, skipped)] : []),
          ),
        )
        .orderBy(asc(uploads.parsedAt), asc(uploads.id))
        .limit(1);
      if (!upload) break;
      const outcome = await this.readOne(upload);
      if (outcome === 'stopped') {
        summary.stopped = true;
        break;
      }
      if (outcome === 'skipped') {
        skipped.push(upload.id);
        continue;
      }
      summary.read++;
      summary.linksChanged += outcome.linksChanged;
    }
    if (summary.read)
      this.logger.log(
        `Read the money facts of ${summary.read} document(s); ${summary.linksChanged} invoice-payment link(s) changed`,
      );
    return summary;
  }

  private async readOne(
    upload: UploadRow,
  ): Promise<{ linksChanged: number } | 'skipped' | 'stopped'> {
    let facts: TransactionFacts;
    let runs: ParseRunRecord[] = [];
    try {
      if (!upload.fileFormat)
        throw new PermanentParseError('The upload has no detected format');
      const bytes = await this.storage.getBytes(upload.storageKey);
      const output = await this.analyzer.readTransaction(
        {
          document: await normalizeDocument(bytes, upload.fileFormat),
          filename: upload.originalFilename,
          title: upload.title,
          description: upload.description,
        },
        { analysis: upload.analysis, categories: upload.categories },
      );
      await this.queue.markHealthy();
      facts = output.result;
      runs = output.runs;
    } catch (error) {
      runs = (error as { runs?: ParseRunRecord[] } | null)?.runs ?? [];
      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof QuotaExhaustedError ||
        error instanceof RateLimitedError
      ) {
        const quota = error instanceof QuotaExhaustedError;
        const plan = await this.queue.pause({
          kind: quota ? 'PAUSED_QUOTA' : 'PAUSED_RATE_LIMIT',
          reason: quota
            ? 'The AI provider reports that the usage quota is exhausted'
            : 'The AI provider is rate-limiting requests',
          details: error.details,
          providerResumeAt: quota ? error.resetAt : error.retryAt,
        });
        await this.saveRuns(upload.id, runs);
        this.logger.warn(
          `Stopped matching invoices and payments until ${plan.resumeAt.toISOString()}: ${message}`,
        );
        return 'stopped';
      }
      if (error instanceof CredentialsError) {
        await this.queue.blockCredentials(
          'The AI provider refused the API key',
          error.details,
        );
        await this.saveRuns(upload.id, runs);
        return 'stopped';
      }
      if (
        !(error instanceof PermanentParseError) &&
        !(error instanceof ContextTooLargeError)
      ) {
        await this.saveRuns(upload.id, runs);
        this.logger.warn(
          `Could not read the money facts of ${upload.id}, will try on the next run: ${message}`,
        );
        return 'skipped';
      }
      // It can never be read: count it as no transaction, so it is not tried forever.
      this.logger.warn(
        `The money facts of ${upload.id} cannot be read: ${message}`,
      );
      facts = noTransaction();
    }

    return withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      // Only if it is still the document we read: not parsed again meanwhile.
      const saved = await db
        .update(uploads)
        .set({ transactionFacts: facts })
        .where(
          and(
            eq(uploads.id, upload.id),
            eq(uploads.status, 'PARSED'),
            isNull(uploads.transactionFacts),
            ...(upload.parsedAt ? [eq(uploads.parsedAt, upload.parsedAt)] : []),
          ),
        )
        .returning({ id: uploads.id });
      await this.saveRuns(upload.id, runs, db);
      if (!saved.length) return 'skipped' as const;
      if (facts.role === 'NONE') return { linksChanged: 0 };
      const relinked = await relinkDocuments(client);
      return {
        linksChanged: relinked.created + relinked.updated + relinked.removed,
      };
    });
  }

  private async saveRuns(
    uploadId: string,
    runs: ParseRunRecord[],
    db = this.svc.db,
  ): Promise<void> {
    if (!runs.length) return;
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
