import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  EventEnvelope,
  Page,
  RecordDetailDto,
  RecordDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { applyDocumentEvent } from './document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['REVIEW_DATABASE_URL'];

describe.skipIf(!configured)(
  'review inbox (events → read model → HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const marker = randomUUID().slice(0, 8);

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'review',
      });
    });

    afterAll(async () => {
      await svc?.pool.query(
        `delete from review.staging_records where title like $1`,
        [`%${marker}%`],
      );
      await svc?.close();
      await app?.close();
    });

    const apply = (type: string, payload: unknown) => {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      return withTransaction(svc.pool, (client) =>
        applyDocumentEvent(event, client),
      );
    };

    const get = async <T>(path: string) => {
      const response = await fetch(`${base}${path}`);
      return { status: response.status, body: (await response.json()) as T };
    };

    function upload(title: string) {
      return {
        uploadId: randomUUID(),
        title: `${title} ${marker}`,
        description: null,
        originalFilename: `${title}.jpg`,
        fileFormat: 'JPG' as const,
        sizeBytes: 1234,
        uploadedAt: new Date().toISOString(),
      };
    }

    const details = {
      documentType: 'letter',
      summary: 'A letter',
      keyFacts: [],
    };
    const parsed = (u: ReturnType<typeof upload>) => ({
      ...u,
      category: 'other',
      targetKey: 'general.document@1',
      details,
      confidence: 0.9,
      flags: [],
      parsedAt: new Date().toISOString(),
    });

    async function findByTitle(title: string): Promise<RecordDto> {
      const page = await get<Page<RecordDto>>(
        `/records?q=${encodeURIComponent(title)}`,
      );
      expect(page.body.items).toHaveLength(1);
      return page.body.items[0];
    }

    const send = async <T>(method: string, path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as T };
    };

    it('mirrors the document categories and keeps your edited details for confirmation', async () => {
      const u = upload('acqua');
      await apply('upload.completed@1', u);
      await apply('document.parsed@1', parsed(u));
      const { sizeBytes: _size, ...metadata } = u;
      const newer = new Date();
      await apply('upload.updated@1', {
        ...metadata,
        description: 'Acqua Q3',
        categories: ['BILL', 'WATER_BILL'],
        suggestedCategories: ['ACQUE_SPA'],
        updatedAt: newer.toISOString(),
      });
      // An older snapshot arriving late changes nothing.
      await apply('upload.updated@1', {
        ...metadata,
        categories: [],
        suggestedCategories: [],
        updatedAt: new Date(newer.getTime() - 60_000).toISOString(),
      });

      const page = await get<Page<RecordDto>>(
        `/records?documentCategory=WATER_BILL&q=${encodeURIComponent(u.title)}`,
      );
      expect(page.body.items).toHaveLength(1);
      const record = page.body.items[0];
      expect(record).toMatchObject({
        description: 'Acqua Q3',
        categories: ['BILL', 'WATER_BILL'],
        suggestedCategories: ['ACQUE_SPA'],
        status: 'PARSED',
      });

      const invalid = await send('PATCH', `/records/${record.id}`, {
        details: { summary: 42 },
      });
      expect(invalid.status).toBe(422);
      const edited = { ...details, summary: 'Water bill, edited' };
      const saved = await send<RecordDetailDto>(
        'PATCH',
        `/records/${record.id}`,
        { details: edited },
      );
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ edited: true, details: edited });

      await send('POST', `/records/${record.id}/confirm`, {});
      const { rows } = await svc.pool.query<{ payload: { payload: unknown } }>(
        `select payload from review.outbox
          where event_type = 'record.approved@1' and payload->>'recordId' = $1`,
        [record.id],
      );
      expect(rows[0].payload.payload).toEqual(edited);
      expect(
        (await send('PATCH', `/records/${record.id}`, { details: edited }))
          .status,
      ).toBe(409);
    });

    it('follows a document from upload to confirmation, emitting record.approved', async () => {
      const u = upload('letter');
      await apply('upload.completed@1', u);
      let record = await findByTitle(u.title);
      expect(record).toMatchObject({ status: 'UPLOADED', parsedAt: null });

      // Confirming before parsing is refused.
      const early = await fetch(`${base}/records/${record.id}/confirm`, {
        method: 'POST',
      });
      expect(early.status).toBe(409);

      await apply('upload.parsing_started@1', {
        uploadId: u.uploadId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      });
      await apply('document.parsed@1', parsed(u));
      record = await findByTitle(u.title);
      expect(record).toMatchObject({ status: 'PARSED', category: 'other' });

      const detail = await get<RecordDetailDto>(`/records/${record.id}`);
      expect(detail.body.details).toEqual(details);

      const confirmed = await fetch(`${base}/records/${record.id}/confirm`, {
        method: 'POST',
      });
      expect(confirmed.status).toBe(200);
      expect(((await confirmed.json()) as RecordDetailDto).status).toBe(
        'CONFIRMED',
      );

      const { rows } = await svc.pool.query(
        `select payload from review.outbox where event_type = 'record.approved@1' and payload->>'recordId' = $1`,
        [record.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({
        targetKey: 'general.document@1',
        payload: details,
      });

      // A late parse event (a retry that overtook) cannot reopen a confirmed record.
      await apply('document.parsed@1', {
        ...parsed(u),
        details: { ...details, summary: 'changed' },
      });
      expect(
        (await get<RecordDetailDto>(`/records/${record.id}`)).body,
      ).toMatchObject({ status: 'CONFIRMED', details });

      const twice = await fetch(`${base}/records/${record.id}/confirm`, {
        method: 'POST',
      });
      expect(twice.status).toBe(409);
    });

    it('accepts document.parsed before upload.completed', async () => {
      const u = upload('receipt');
      await apply('document.parsed@1', parsed(u));
      await apply('upload.completed@1', u);
      expect(await findByTitle(u.title)).toMatchObject({ status: 'PARSED' });
    });

    it('filters by status and rejects invalid queries', async () => {
      const failed = upload('broken');
      await apply('upload.completed@1', failed);
      await apply('document.parse_failed@1', {
        uploadId: failed.uploadId,
        error: 'unreadable',
        attempts: 5,
        failedAt: new Date().toISOString(),
      });

      const page = await get<Page<RecordDto>>(
        `/records?q=${marker}&status=PARSE_FAILED`,
      );
      expect(page.body.items.map((item) => item.title)).toEqual([failed.title]);

      expect((await get(`/records?status=NOPE`)).status).toBe(400);
      expect((await get(`/records/${randomUUID()}`)).status).toBe(404);
    });

    it('shows a quota pause and partial progress, and cannot be confirmed until parsed', async () => {
      const u = upload('bill');
      await apply('upload.completed@1', u);
      const started = {
        uploadId: u.uploadId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      };
      const interrupted = (reason: string, completedSteps: string[]) => ({
        uploadId: u.uploadId,
        reason,
        completedSteps,
        error: 'stopped',
        resumeAt: null,
        interruptedAt: new Date().toISOString(),
      });
      await apply('upload.parsing_started@1', started);
      await apply(
        'document.parse_interrupted@1',
        interrupted('QUOTA_EXHAUSTED', ['CLASSIFY', 'EXTRACT']),
      );
      let record = await findByTitle(u.title);
      expect(record.status).toBe('PAUSED_QUOTA');
      const early = await fetch(`${base}/records/${record.id}/confirm`, {
        method: 'POST',
      });
      expect(early.status).toBe(409);

      await apply('upload.parsing_started@1', { ...started, attempt: 2 });
      expect((await findByTitle(u.title)).status).toBe('PARSING');
      await apply(
        'document.parse_interrupted@1',
        interrupted('TRANSIENT_ERROR', ['CLASSIFY']),
      );
      expect((await findByTitle(u.title)).status).toBe('PARTIALLY_PARSED');
      await apply(
        'document.parse_interrupted@1',
        interrupted('RATE_LIMITED', ['CLASSIFY']),
      );
      expect((await findByTitle(u.title)).status).toBe('PAUSED_RATE_LIMIT');

      await apply('upload.parsing_started@1', { ...started, attempt: 3 });
      await apply('document.parsed@1', parsed(u));
      record = await findByTitle(u.title);
      expect(record.status).toBe('PARSED');
    });
  },
);
