import {
  createServiceDb,
  migrateServiceSchema,
  ObjectStorage,
  storageOptionsFromEnv,
  type ServiceDb,
} from '@life-island/be-common';
import { uploads } from '@life-island/ingestion-db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, type WorkerConfig } from './config.js';
import { ParseService } from './parse.service.js';
import { FakeParser } from './parsers/fake-parser.js';
import {
  PermanentParseError,
  type DocumentParser,
} from './parsers/document-parser.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

// svc-ingestion owns the ingestion schema; the test applies its migrations (idempotent, locked).
const MIGRATIONS = fileURLToPath(
  new URL('../../../svc-ingestion/drizzle', import.meta.url),
);

describe.skipIf(!configured)(
  'ParseService against Postgres and object storage',
  () => {
    let svc: ServiceDb;
    let storage: ObjectStorage;
    let config: WorkerConfig;
    const created: string[] = [];

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

    afterAll(async () => {
      if (created.length)
        await drizzle(svc.pool)
          .delete(uploads)
          .where(inArray(uploads.id, created));
      await svc?.close();
    });

    /** A TO_BE_PARSED row old enough to be claimed before anything other tests create. */
    async function seed(
      text: string,
      filename = 'scontrino.txt',
    ): Promise<string> {
      const id = randomUUID();
      const key = `test/${id}/${filename}`;
      await storage.put(key, Buffer.from(text), 'text/plain');
      await drizzle(svc.pool)
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
      (
        await drizzle(svc.pool).select().from(uploads).where(eq(uploads.id, id))
      )[0];
    const events = async (id: string) =>
      (
        await svc.pool.query<{ event_type: string }>(
          `select event_type from ingestion.outbox where payload->>'uploadId' = $1`,
          [id],
        )
      ).rows.map((event) => event.event_type);

    it('claims, parses and reports a document in one go', async () => {
      const id = await seed(`Esselunga TOTALE 7,47 ${randomUUID()}`);
      const service = new ParseService(svc, storage, new FakeParser(), config);
      const [claimed] = await service.claimBatch(1);
      expect(claimed.id).toBe(id);
      expect(claimed.status).toBe('PARSING');
      expect(claimed.attempts).toBe(1);

      // A second worker never takes a row that is already leased.
      expect(
        (await service.claimBatch(50)).map((upload) => upload.id),
      ).not.toContain(id);

      expect(await service.process(claimed)).toBe('parsed');
      expect(await row(id)).toMatchObject({
        status: 'PARSED',
        categories: ['groceries'],
        targetKey: 'grocery.receipt@1',
        flags: ['fake_parser'],
        lockedUntil: null,
      });
      expect((await row(id)).parsedAt).toBeInstanceOf(Date);
      expect((await events(id)).sort()).toEqual([
        'document.parsed@1',
        'upload.parsing_started@1',
      ]);
    });

    it('retries transient failures with backoff, then gives up', async () => {
      const id = await seed('anything');
      const flaky: DocumentParser = {
        name: 'flaky',
        parse: async () => Promise.reject(new Error('503 overloaded')),
      };
      const service = new ParseService(svc, storage, flaky, config);

      const [first] = await service.claimBatch(1);
      expect(await service.process(first)).toBe('retried');
      const retried = await row(id);
      expect(retried).toMatchObject({
        status: 'TO_BE_PARSED',
        lastError: '503 overloaded',
      });
      expect(retried.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      // Make it due again; the second attempt reaches maxAttempts.
      await drizzle(svc.pool)
        .update(uploads)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(uploads.id, id));
      const [second] = await service.claimBatch(1);
      expect(second.attempts).toBe(2);
      expect(await service.process(second)).toBe('failed');
      expect((await row(id)).status).toBe('FAILED');
      expect(await events(id)).toContain('document.parse_failed@1');
    });

    it('fails at once on a permanent error', async () => {
      const id = await seed('anything');
      const refusing: DocumentParser = {
        name: 'refusing',
        parse: async () => Promise.reject(new PermanentParseError('declined')),
      };
      const service = new ParseService(svc, storage, refusing, config);
      const [claimed] = await service.claimBatch(1);
      expect(await service.process(claimed)).toBe('failed');
      expect(await row(id)).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        lastError: 'declined',
      });
    });
  },
);
