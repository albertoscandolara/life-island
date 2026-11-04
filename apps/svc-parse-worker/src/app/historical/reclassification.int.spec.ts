import {
  createServiceDb,
  migrateServiceSchema,
  ObjectStorage,
  storageOptionsFromEnv,
  type ServiceDb,
} from '@life-island/be-common';
import {
  bumpTaxonomyVersion,
  documentCategories,
  reclassificationRuns,
  uploads,
} from '@life-island/ingestion-db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, type WorkerConfig } from '../config.js';
import { FakeParser } from '../parsers/fake-parser.js';
import { ReclassificationService } from './reclassification.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

const MIGRATIONS = fileURLToPath(
  new URL('../../../../svc-ingestion/drizzle', import.meta.url),
);

describe.skipIf(!configured)('historical reclassification run', () => {
  let svc: ServiceDb;
  let storage: ObjectStorage;
  let config: WorkerConfig;
  const created: string[] = [];
  const categoryIds: string[] = [];
  const runIds: string[] = [];
  const db = () => drizzle(svc.pool);

  beforeAll(async () => {
    config = { ...loadConfig(), reclassifyLeaseMinutes: 1 };
    svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'ingestion',
    });
    await migrateServiceSchema(svc.pool, svc.schema, MIGRATIONS);
    storage = new ObjectStorage(storageOptionsFromEnv());
    await storage.ensureBucket([]);
  });

  afterAll(async () => {
    if (created.length) {
      await svc.pool.query(
        `delete from ingestion.outbox where payload->>'uploadId' = any($1)`,
        [created],
      );
      await db().delete(uploads).where(inArray(uploads.id, created));
    }
    if (categoryIds.length)
      await db()
        .delete(documentCategories)
        .where(inArray(documentCategories.id, categoryIds));
    if (runIds.length)
      await db()
        .delete(reclassificationRuns)
        .where(inArray(reclassificationRuns.id, runIds));
    await svc?.close();
  });

  async function parsed(text: string, classifiedAt: number): Promise<string> {
    const id = randomUUID();
    const key = `test/${id}/doc.txt`;
    await storage.put(key, Buffer.from(text), 'text/plain');
    await db()
      .insert(uploads)
      .values({
        id,
        title: 'doc',
        originalFilename: 'doc.txt',
        fileFormat: 'TXT',
        sizeBytes: text.length,
        storageKey: key,
        status: 'PARSED',
        categories: [],
        completedSteps: ['CLASSIFY', 'EXTRACT', 'DISCOVER'],
        classifiedCategoryVersion: classifiedAt,
      });
    created.push(id);
    return id;
  }

  const row = async (id: string) =>
    (await db().select().from(uploads).where(eq(uploads.id, id)))[0];

  it('checks past documents against newer categories only, and stores findings apart', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const categoryId = `TEST_HIST_${suffix}`;
    const word = `Zebrafish${suffix.toLowerCase()}`;

    const client = await svc.pool.connect();
    let version: number;
    try {
      version = await bumpTaxonomyVersion(client);
    } finally {
      client.release();
    }
    await db()
      .insert(documentCategories)
      .values({
        id: categoryId,
        title: word,
        description: `Documents about ${word}`,
        templateJson: { fields: [] },
        taxonomyVersion: version,
      });
    categoryIds.push(categoryId);

    const matching = await parsed(`An invoice about ${word}`, version - 1);
    const unrelated = await parsed('Nothing to see here', version - 1);
    const current = await parsed(`Also about ${word}`, version);

    const [run] = await db()
      .insert(reclassificationRuns)
      .values({
        trigger: 'MANUAL',
        status: 'RUNNING',
        targetVersion: version,
        leaseUntil: new Date(Date.now() + 60_000),
        startedAt: new Date(),
      })
      .returning();
    runIds.push(run.id);

    const service = new ReclassificationService(
      svc,
      storage,
      new FakeParser(),
      config,
    );
    const summary = await service.run(run);
    expect(summary.suggested).toBeGreaterThanOrEqual(1);

    const found = await row(matching);
    expect(found).toMatchObject({
      historicalStatus: 'PENDING_REVIEW',
      historicalProcessingVersion: version,
      categories: [],
    });
    expect(found.historicalSuggestions.map((s) => s.categoryId)).toEqual([
      categoryId,
    ]);

    // Nothing applies: checked without findings, never asked again.
    expect(await row(unrelated)).toMatchObject({
      historicalStatus: null,
      historicalReviewedVersion: version,
    });
    // Classified with the category already known: not eligible at all.
    expect(await row(current)).toMatchObject({
      historicalStatus: null,
      historicalReviewedVersion: null,
    });

    const [finished] = await db()
      .select()
      .from(reclassificationRuns)
      .where(eq(reclassificationRuns.id, run.id));
    expect(finished).toMatchObject({ status: 'COMPLETED', leaseUntil: null });

    const { rows } = await svc.pool.query<{
      payload: { historicalStatus: string };
    }>(
      `select payload from ingestion.outbox
        where event_type = 'upload.updated@1' and payload->>'uploadId' = $1
        order by created_at desc, id desc limit 1`,
      [matching],
    );
    expect(rows[0]?.payload.historicalStatus).toBe('PENDING_REVIEW');
  });
});
