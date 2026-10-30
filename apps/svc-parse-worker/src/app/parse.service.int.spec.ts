import {
  createServiceDb,
  migrateServiceSchema,
  ObjectStorage,
  storageOptionsFromEnv,
  type ServiceDb,
} from '@life-island/be-common';
import type { ProviderErrorDetails } from '@life-island/contracts';
import {
  categorySuggestions,
  documentCategories,
  PARSE_QUEUE_ID,
  parseQueue,
  uploads,
} from '@life-island/ingestion-db';
import { arrayContains, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, type WorkerConfig } from './config.js';
import { ParseService } from './parse.service.js';
import {
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
  type DocumentAnalyzer,
} from './parsers/document-parser.js';
import { FakeParser } from './parsers/fake-parser.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

// svc-ingestion owns the ingestion schema; the test applies its migrations (idempotent, locked).
const MIGRATIONS = fileURLToPath(
  new URL('../../../svc-ingestion/drizzle', import.meta.url),
);

type Step = 'classify' | 'extract' | 'discover';

/**
 * The offline analyzer with a script: count the calls per step, and make a
 * step throw (a quota error, a crash...) until the script is cleared.
 */
class ScriptedAnalyzer implements DocumentAnalyzer {
  readonly name = 'scripted';
  readonly calls: Record<Step, number> = {
    classify: 0,
    extract: 0,
    discover: 0,
  };
  failures: Partial<Record<Step, () => Error>> = {};
  suggestions?: { id: string; title: string }[];
  private readonly inner = new FakeParser();

  private check(step: Step) {
    this.calls[step]++;
    const failure = this.failures[step];
    if (failure) throw failure();
  }

  classify: DocumentAnalyzer['classify'] = async (input, categories) => {
    this.check('classify');
    return this.inner.classify(input, categories);
  };

  extract: DocumentAnalyzer['extract'] = async (input, plan) => {
    this.check('extract');
    return this.inner.extract(input, plan);
  };

  discover: DocumentAnalyzer['discover'] = async (input, context) => {
    this.check('discover');
    if (!this.suggestions) return this.inner.discover(input, context);
    return {
      runs: [],
      result: {
        suggestions: this.suggestions.map((s) => ({
          ...s,
          description: `${s.title} documents`,
          reason: 'scripted',
          template: {
            fields: [
              {
                key: 'total_amount',
                label: 'Total',
                type: 'amount' as const,
                description: '',
                required: true,
              },
            ],
          },
        })),
      },
    };
  };
}

const providerError: ProviderErrorDetails = {
  status: 400,
  type: 'invalid_request_error',
  message: 'Your credit balance is too low to access the Anthropic API.',
};

describe.skipIf(!configured)(
  'ParseService against Postgres and object storage',
  () => {
    let svc: ServiceDb;
    let storage: ObjectStorage;
    let config: WorkerConfig;
    const created: string[] = [];
    const createdCategories: string[] = [];
    const db = () => drizzle(svc.pool);

    beforeAll(async () => {
      config = { ...loadConfig(), maxAttempts: 2 };
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'ingestion',
      });
      await migrateServiceSchema(svc.pool, svc.schema, MIGRATIONS);
      storage = new ObjectStorage(storageOptionsFromEnv());
      await storage.ensureBucket([]);
    });

    beforeEach(async () => {
      await db()
        .insert(parseQueue)
        .values({ id: PARSE_QUEUE_ID })
        .onConflictDoNothing();
      await db()
        .update(parseQueue)
        .set({
          status: 'IDLE',
          resumeAt: null,
          resumeAttempts: 0,
          pausedAt: null,
        })
        .where(eq(parseQueue.id, PARSE_QUEUE_ID));
    });

    afterAll(async () => {
      if (created.length) {
        await db().delete(uploads).where(inArray(uploads.id, created));
        await svc.pool.query(
          `delete from ingestion.category_suggestions where upload_ids && $1::uuid[]`,
          [created],
        );
      }
      if (createdCategories.length)
        await db()
          .delete(documentCategories)
          .where(inArray(documentCategories.id, createdCategories));
      await svc.pool.query(
        `update ingestion.parse_queue set status = 'IDLE', resume_at = null where id = 'documents'`,
      );
      await svc?.close();
    });

    /** A TO_BE_PARSED row old enough to be claimed before anything other tests create. */
    async function seed(
      text: string,
      filename = 'bolletta.txt',
    ): Promise<string> {
      const id = randomUUID();
      const key = `test/${id}/${filename}`;
      await storage.put(key, Buffer.from(text), 'text/plain');
      await db()
        .insert(uploads)
        .values({
          id,
          title: filename.replace(/\.\w+$/, ''),
          originalFilename: filename,
          fileFormat: 'TXT',
          sizeBytes: text.length,
          storageKey: key,
          status: 'TO_BE_PARSED',
          uploadedAt: new Date(),
          createdAt: new Date('2000-01-01T00:00:00Z'),
        });
      created.push(id);
      return id;
    }

    const row = async (id: string) =>
      (await db().select().from(uploads).where(eq(uploads.id, id)))[0];
    const queueRow = async () =>
      (
        await db()
          .select()
          .from(parseQueue)
          .where(eq(parseQueue.id, PARSE_QUEUE_ID))
      )[0];
    const events = async (id: string) =>
      (
        await svc.pool.query<{ event_type: string }>(
          `select event_type from ingestion.outbox where payload->>'uploadId' = $1 order by created_at`,
          [id],
        )
      ).rows.map((event) => event.event_type);
    const suggestionsFor = (id: string) =>
      db()
        .select()
        .from(categorySuggestions)
        .where(arrayContains(categorySuggestions.uploadIds, [id]));
    /** Lets time pass: the pause and the document's retry delay are over. */
    const timePasses = async (id: string) => {
      await db()
        .update(parseQueue)
        .set({ resumeAt: new Date(Date.now() - 1000) })
        .where(eq(parseQueue.id, PARSE_QUEUE_ID));
      await db()
        .update(uploads)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(uploads.id, id));
    };
    const claim = async (service: ParseService, id: string) => {
      const claimed = await service.claimNext();
      expect(claimed?.id).toBe(id);
      return claimed!;
    };

    const ENEL = `ENEL ENERGIA - Bolletta luce\nEmessa il 12/10/2026\nTOTALE EUR 84,20 ${randomUUID()}`;

    it('classifies, extracts and discovers, then hands the document to review', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      const service = new ParseService(svc, storage, analyzer, config);
      const claimed = await claim(service, id);
      expect(claimed).toMatchObject({ status: 'PARSING', attempts: 1 });
      expect(claimed.lockToken).toBeTruthy();
      // A second worker never takes a row that is already leased.
      expect((await service.claimNext())?.id).not.toBe(id);

      expect(await service.process(claimed)).toBe('parsed');
      const saved = await row(id);
      expect(saved).toMatchObject({
        status: 'PARSED',
        targetKey: 'general.document@1',
        lockedUntil: null,
        lockToken: null,
        currentStep: null,
      });
      expect([...saved.completedSteps].sort()).toEqual([
        'CLASSIFY',
        'DISCOVER',
        'EXTRACT',
      ]);
      // Several existing categories at once, only ids that exist.
      expect([...saved.categories].sort()).toEqual(['BILL', 'EXPENSE', 'HOME']);
      expect(saved.extractedFields?.fields['total_amount']).toMatchObject({
        status: 'found',
        value: 84.2,
        categories: ['BILL', 'EXPENSE'],
      });
      expect(saved.extractedFields?.fields['provider']).toMatchObject({
        status: 'missing',
        value: null,
      });
      expect(saved.analysis?.categoryEvidence.map((item) => item.id)).toContain(
        'BILL',
      );
      // New categories are suggested even though BILL and EXPENSE matched; none is saved yet.
      const suggested = await suggestionsFor(id);
      expect(suggested.map((s) => s.categoryId).sort()).toEqual([
        'ELECTRICITY_BILL',
        'ENEL',
      ]);
      expect(suggested.every((s) => s.status === 'PENDING')).toBe(true);
      expect(suggested[0].templateJson.fields.length).toBeGreaterThan(0);
      expect(
        await db()
          .select()
          .from(documentCategories)
          .where(inArray(documentCategories.id, ['ENEL', 'ELECTRICITY_BILL'])),
      ).toEqual([]);
      // The inbox hears about the categories after CLASSIFY and the suggestions after DISCOVER.
      expect(await events(id)).toEqual([
        'upload.parsing_started@1',
        'upload.updated@1',
        'upload.updated@1',
        'document.parsed@1',
      ]);
      const { rows } = await svc.pool.query<{
        payload: { categories: string[]; suggestedCategories: string[] };
      }>(
        `select payload from ingestion.outbox
          where event_type = 'upload.updated@1' and payload->>'uploadId' = $1
          order by created_at desc limit 1`,
        [id],
      );
      expect(rows[0].payload.categories).toEqual(saved.categories);
      expect([...rows[0].payload.suggestedCategories].sort()).toEqual([
        'ELECTRICITY_BILL',
        'ENEL',
      ]);
    });

    it('pauses on an exhausted quota, keeps the finished steps, and makes no more AI calls', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      analyzer.failures.discover = () =>
        new QuotaExhaustedError('quota gone', providerError, null);
      const service = new ParseService(svc, storage, analyzer, config);

      expect(await service.process(await claim(service, id))).toBe('paused');
      const paused = await row(id);
      expect(paused).toMatchObject({
        status: 'PAUSED_QUOTA',
        attempts: 0, // a pause is not the document's fault
        currentStep: 'DISCOVER',
        lockToken: null,
        lastError: 'quota gone',
      });
      expect([...paused.completedSteps].sort()).toEqual([
        'CLASSIFY',
        'EXTRACT',
      ]);
      expect(paused.extractedFields?.fields['total_amount']?.value).toBe(84.2);
      expect(paused.parsedAt).toBeNull();

      const queue = await queueRow();
      expect(queue).toMatchObject({
        status: 'PAUSED_QUOTA',
        resumeAtReliable: false,
        resumeAttempts: 1,
        providerError,
      });
      // No reset time from the provider: the first check is PARSE_QUOTA_RETRY_MINUTES away.
      const waitMinutes = (queue.resumeAt!.getTime() - Date.now()) / 60_000;
      expect(waitMinutes).toBeGreaterThan(config.quotaRetryMinutes - 1);
      expect(paused.nextAttemptAt.getTime()).toBe(queue.resumeAt!.getTime());
      expect(await events(id)).toContain('document.parse_interrupted@1');

      // While paused, a run (the daily schedule, a restart) sends no AI request at all.
      analyzer.failures = {};
      const before = { ...analyzer.calls };
      expect(await service.runOnce()).toMatchObject({ parsed: 0, paused: 0 });
      expect(analyzer.calls).toEqual(before);
      expect(await service.queue.canProceed()).toBe(false);

      // The quota is back: the document resumes at DISCOVER, nothing earlier runs again.
      await timePasses(id);
      const resumed = await claim(service, id);
      expect(resumed.attempts).toBe(1);
      expect(await service.process(resumed)).toBe('parsed');
      expect(analyzer.calls).toEqual({ classify: 1, extract: 1, discover: 2 });
      expect((await row(id)).status).toBe('PARSED');
      expect(await queueRow()).toMatchObject({
        status: 'RUNNING',
        resumeAttempts: 0,
        resumeAt: null,
      });
    });

    it('waits longer each time the quota is still exhausted, and trusts a provider reset time', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      analyzer.failures.classify = () =>
        new QuotaExhaustedError('quota gone', providerError, null);
      const service = new ParseService(svc, storage, analyzer, config);

      await service.process(await claim(service, id));
      const first = (await queueRow()).resumeAt!.getTime() - Date.now();
      await timePasses(id);
      await service.process(await claim(service, id));
      const second = (await queueRow()).resumeAt!.getTime() - Date.now();
      expect(second / first).toBeGreaterThan(1.9);
      expect((await queueRow()).resumeAttempts).toBe(2);

      const reset = new Date(Date.now() + 3 * 24 * 3600_000);
      analyzer.failures.classify = () =>
        new QuotaExhaustedError('quota gone', providerError, reset);
      await timePasses(id);
      await service.process(await claim(service, id));
      expect(await queueRow()).toMatchObject({ resumeAtReliable: true });
      expect((await queueRow()).resumeAt!.getTime()).toBe(
        reset.getTime() + 60_000,
      );
      expect((await row(id)).attempts).toBe(0);
    });

    it('pauses until the retry time after a rate limit', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      const retryAt = new Date(Date.now() + 30_000);
      analyzer.failures.extract = () =>
        new RateLimitedError(
          'slow down',
          { status: 429, message: 'slow down' },
          retryAt,
        );
      const service = new ParseService(svc, storage, analyzer, config);

      expect(await service.process(await claim(service, id))).toBe('paused');
      expect(await row(id)).toMatchObject({
        status: 'PAUSED_RATE_LIMIT',
        completedSteps: ['CLASSIFY'],
      });
      expect(await queueRow()).toMatchObject({
        status: 'PAUSED_RATE_LIMIT',
        resumeAtReliable: true,
      });
      expect((await queueRow()).resumeAt!.getTime()).toBe(
        retryAt.getTime() + 1000,
      );
    });

    it('keeps partial results across a temporary error and a crashed worker, never repeating a step', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      analyzer.failures.extract = () => new Error('503 overloaded');
      const service = new ParseService(svc, storage, analyzer, config);

      expect(await service.process(await claim(service, id))).toBe('retried');
      const partial = await row(id);
      expect(partial).toMatchObject({
        status: 'TO_BE_PARSED',
        completedSteps: ['CLASSIFY'],
        attempts: 1,
        lastError: '503 overloaded',
      });
      expect(partial.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(partial.categories.length).toBeGreaterThan(0);

      // A worker claims it and dies (no writes, lease left behind).
      analyzer.failures = {};
      await timePasses(id);
      const crashed = await claim(service, id);
      await db()
        .update(uploads)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(uploads.id, id));

      // After a restart another worker recovers it, with a new lease.
      const restarted = new ParseService(svc, storage, analyzer, config);
      const recovered = await claim(restarted, id);
      expect(recovered.lockToken).not.toBe(crashed.lockToken);
      // The dead worker's lease is void: it cannot write anything any more.
      expect(await service.process(crashed)).toBe('lost');

      expect(await restarted.process(recovered)).toBe('parsed');
      expect(analyzer.calls.classify).toBe(1);
      expect(analyzer.calls.extract).toBe(2); // the failed call, then the one that worked
      expect(analyzer.calls.discover).toBe(1);
      const suggestions = await suggestionsFor(id);
      expect(new Set(suggestions.map((s) => s.categoryId)).size).toBe(
        suggestions.length,
      );
    });

    it('stops the run on refused credentials without spending the document’s attempts', async () => {
      const id = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      analyzer.failures.classify = () =>
        new CredentialsError('invalid x-api-key', {
          status: 401,
          message: 'invalid x-api-key',
        });
      const service = new ParseService(svc, storage, analyzer, config);
      expect(await service.process(await claim(service, id))).toBe('blocked');
      expect(await row(id)).toMatchObject({
        status: 'TO_BE_PARSED',
        attempts: 0,
      });
      expect((await queueRow()).status).toBe('BLOCKED_CREDENTIALS');
      await db()
        .update(uploads)
        .set({ status: 'FAILED' })
        .where(eq(uploads.id, id));
    });

    it('fails at once on a permanent error, and after the last attempt on others', async () => {
      const refused = await seed(ENEL);
      const analyzer = new ScriptedAnalyzer();
      analyzer.failures.classify = () => new PermanentParseError('declined');
      const service = new ParseService(svc, storage, analyzer, config);
      expect(await service.process(await claim(service, refused))).toBe(
        'failed',
      );
      expect(await row(refused)).toMatchObject({
        status: 'FAILED',
        lastError: 'declined',
      });
      expect(await events(refused)).toContain('document.parse_failed@1');

      const flaky = await seed(ENEL);
      analyzer.failures.classify = () => new Error('socket hang up');
      expect(await service.process(await claim(service, flaky))).toBe(
        'retried',
      );
      await timePasses(flaky);
      expect(await service.process(await claim(service, flaky))).toBe('failed');
      expect((await row(flaky)).attempts).toBe(2);
    });

    it('shares one suggestion between documents and never duplicates it', async () => {
      const suffix = randomUUID().slice(0, 8).toUpperCase();
      const proposed = {
        id: `TEST_VENDOR_${suffix}`,
        title: `Test vendor ${suffix}`,
      };
      const analyzer = new ScriptedAnalyzer();
      analyzer.suggestions = [proposed, { ...proposed, id: `${proposed.id}S` }];
      const service = new ParseService(svc, storage, analyzer, config);
      const first = await seed(ENEL);
      const second = await seed(ENEL.replace('84,20', '90,00'));
      await service.process(await claim(service, first));
      await service.process(await claim(service, second));

      const rows = await db()
        .select()
        .from(categorySuggestions)
        .where(
          sql`${categorySuggestions.categoryId} like ${`TEST_VENDOR_${suffix}%`}`,
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        categoryId: proposed.id,
        status: 'PENDING',
      });
      expect([...rows[0].uploadIds].sort()).toEqual([first, second].sort());
    });

    it('saves and assigns suggested categories at once when auto-approval is on', async () => {
      const id = `TEST_AUTO_${randomUUID().slice(0, 8).toUpperCase()}`;
      createdCategories.push(id);
      const analyzer = new ScriptedAnalyzer();
      analyzer.suggestions = [{ id, title: `Auto ${id}` }];
      const service = new ParseService(svc, storage, analyzer, {
        ...config,
        autoApproveCategories: true,
      });
      const upload = await seed(ENEL);
      await service.process(await claim(service, upload));
      expect((await row(upload)).categories).toContain(id);
      expect(
        await db()
          .select()
          .from(documentCategories)
          .where(eq(documentCategories.id, id)),
      ).toHaveLength(1);
      expect(
        (await suggestionsFor(upload)).find((s) => s.categoryId === id),
      ).toMatchObject({
        status: 'APPROVED',
        approvedCategoryId: id,
      });
    });
  },
);
