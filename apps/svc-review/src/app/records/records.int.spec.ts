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

    const apply = (type: string, payload: unknown, autoConfirm = false) => {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      return withTransaction(svc.pool, (client) =>
        applyDocumentEvent(event, client, { autoConfirm }),
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

    it('mirrors the findings of a later check and filters by them', async () => {
      const u = upload('later');
      await apply('upload.completed@1', u);
      await apply('document.parsed@1', parsed(u));
      const { sizeBytes: _size, ...metadata } = u;
      await apply('upload.updated@1', {
        ...metadata,
        categories: [],
        suggestedCategories: [],
        historicalStatus: 'PENDING_REVIEW',
        historicalSuggestions: ['INSURANCE'],
        updatedAt: new Date().toISOString(),
      });
      const q = `q=${encodeURIComponent(u.title)}`;
      const found = await get<Page<RecordDto>>(
        `/records?historical=PENDING_REVIEW&${q}`,
      );
      expect(found.body.items).toEqual([
        expect.objectContaining({
          status: 'PARSED',
          historicalStatus: 'PENDING_REVIEW',
          historicalSuggestions: ['INSURANCE'],
        }),
      ]);
      expect(
        (await get<Page<RecordDto>>(`/records?historical=RECLASSIFYING&${q}`))
          .body.items,
      ).toEqual([]);
      // An older event without the overlay keeps what is stored.
      await apply('upload.updated@1', {
        ...metadata,
        categories: [],
        suggestedCategories: [],
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      });
      expect(
        (await get<Page<RecordDto>>(`/records?historical=PENDING_REVIEW&${q}`))
          .body.items,
      ).toHaveLength(1);
    });

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

    it('puts a record waiting for review back to parse when you ask for it, and leaves a confirmed one alone', async () => {
      const u = upload('reparse');
      await apply('upload.completed@1', u);
      await apply('document.parsed@1', parsed(u));
      const { sizeBytes: _size, ...metadata } = u;
      await apply('upload.updated@1', {
        ...metadata,
        categories: ['BILL'],
        suggestedCategories: [],
        fields: { amount: 12 },
        updatedAt: new Date().toISOString(),
      });
      let record = await findByTitle(u.title);
      await send('PATCH', `/records/${record.id}`, {
        details: { ...details, summary: 'edited' },
      });

      await apply('upload.reparse_requested@1', {
        uploadId: u.uploadId,
        requestedAt: new Date().toISOString(),
      });
      record = await findByTitle(u.title);
      expect(record).toMatchObject({
        status: 'UPLOADED',
        category: null,
        targetKey: null,
        confidence: null,
        flags: [],
        parsedAt: null,
      });
      const { rows } = await svc.pool.query(
        `select ai_payload, reviewed_payload, document_fields
           from review.staging_records where id = $1`,
        [record.id],
      );
      expect(rows[0]).toEqual({
        ai_payload: null,
        reviewed_payload: null,
        document_fields: null,
      });

      // The new parse lands as usual.
      await apply('upload.parsing_started@1', {
        uploadId: u.uploadId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      });
      expect((await findByTitle(u.title)).status).toBe('PARSING');
      await apply('document.parsed@1', parsed(u));
      record = await findByTitle(u.title);
      expect(record.status).toBe('PARSED');

      // Once confirmed, the record has gone to its module and stays.
      await send('POST', `/records/${record.id}/confirm`, {});
      await apply('upload.reparse_requested@1', {
        uploadId: u.uploadId,
        requestedAt: new Date().toISOString(),
      });
      expect((await findByTitle(u.title)).status).toBe('CONFIRMED');
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

    it('confirms on its own a document with nothing to check, and sends it back to review on request', async () => {
      const sure = upload('quiet invoice');
      await apply('upload.completed@1', sure);
      await apply(
        'document.parsed@1',
        { ...parsed(sure), reviewReasons: [] },
        true,
      );
      const unsure = upload('homeless invoice');
      await apply('upload.completed@1', unsure);
      await apply(
        'document.parsed@1',
        { ...parsed(unsure), reviewReasons: ['NO_PROPERTY'] },
        true,
      );

      const auto = await findByTitle(sure.title);
      expect(auto).toMatchObject({ status: 'CONFIRMED', reviewReasons: [] });
      expect(auto.autoConfirmedAt).not.toBeNull();
      expect(await findByTitle(unsure.title)).toMatchObject({
        status: 'PARSED',
        reviewReasons: ['NO_PROPERTY'],
        autoConfirmedAt: null,
      });
      const { rows } = await svc.pool.query(
        `select 1 from review.outbox where event_type = 'record.approved@1' and payload->>'recordId' = $1`,
        [auto.id],
      );
      expect(rows).toHaveLength(1);

      const listed = await get<Page<RecordDto>>(
        `/records?status=CONFIRMED&autoConfirmed=true&q=${encodeURIComponent(marker)}`,
      );
      expect(listed.body.items.map((item) => item.id)).toEqual([auto.id]);

      const undone = await send<RecordDetailDto>(
        'POST',
        `/records/${auto.id}/undo-auto-confirm`,
        {},
      );
      expect(undone.body).toMatchObject({
        status: 'PARSED',
        autoConfirmedAt: null,
      });
      const again = await send<unknown>(
        'POST',
        `/records/${auto.id}/undo-auto-confirm`,
        {},
      );
      expect(again.status).toBe(409);
    });

    it('rejects and reopens a record, which then cannot be confirmed while rejected', async () => {
      const u = upload('spam');
      await apply('upload.completed@1', u);
      await apply('document.parsed@1', parsed(u));
      const record = await findByTitle(u.title);

      const rejected = await send<RecordDetailDto>(
        'POST',
        `/records/${record.id}/reject`,
        { reason: 'Not mine' },
      );
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        rejectReason: 'Not mine',
      });
      expect(
        (await send('POST', `/records/${record.id}/confirm`, {})).status,
      ).toBe(409);
      // A late parser event does not undo your decision.
      await apply('document.parsed@1', parsed(u));
      expect((await findByTitle(u.title)).status).toBe('REJECTED');

      const reopened = await send<RecordDetailDto>(
        'POST',
        `/records/${record.id}/reopen`,
        {},
      );
      expect(reopened.body).toMatchObject({
        status: 'PARSED',
        rejectedAt: null,
      });
      await send('POST', `/records/${record.id}/confirm`, {});
      expect(
        (await send('POST', `/records/${record.id}/reject`, {})).status,
      ).toBe(409);
    });

    it('moves a record to another module, checking the details against its schema', async () => {
      const u = upload('farmacia');
      await apply('upload.completed@1', u);
      await apply('document.parsed@1', parsed(u));
      const record = await findByTitle(u.title);

      // The general details do not fit a 730 expense.
      const misfit = await send('PATCH', `/records/${record.id}`, {
        targetKey: 'tax730.expense@1',
      });
      expect(misfit.status).toBe(422);
      expect(
        (
          await send('PATCH', `/records/${record.id}`, {
            targetKey: 'nope@1',
            details,
          })
        ).status,
      ).toBe(422);

      const expense = {
        taxYear: 2026,
        expenseType: 'medicines',
        date: '2026-03-02',
        amount: 12.5,
        issuer: 'Farmacia Centrale',
      };
      const moved = await send<RecordDetailDto>(
        'PATCH',
        `/records/${record.id}`,
        { targetKey: 'tax730.expense@1', details: expense },
      );
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({
        category: 'tax730',
        targetKey: 'tax730.expense@1',
        aiTargetKey: 'general.document@1',
        details: expense,
      });

      const { sizeBytes: _size, ...metadata } = u;
      await apply('upload.updated@1', {
        ...metadata,
        categories: [],
        suggestedCategories: [],
        fields: { total: 12.5, vat_number: null },
        updatedAt: new Date().toISOString(),
      });
      await send('POST', `/records/${record.id}/confirm`, {});
      const { rows } = await svc.pool.query<{
        payload: {
          category: string;
          payload: unknown;
          documentFields: unknown;
        };
      }>(
        `select payload from review.outbox
          where event_type = 'record.approved@1' and payload->>'recordId' = $1`,
        [record.id],
      );
      expect(rows[0].payload).toMatchObject({
        category: 'tax730',
        payload: expense,
        documentFields: { total: 12.5, vat_number: null },
      });
    });

    it('drops a deleted document from the inbox, even if an older update arrives later', async () => {
      const u = upload('doppione');
      await apply('upload.completed@1', u);
      const record = await findByTitle(u.title);
      await apply('upload.deleted@1', {
        uploadId: u.uploadId,
        deletedAt: new Date().toISOString(),
      });
      const { sizeBytes: _size, ...metadata } = u;
      await apply('upload.updated@1', {
        ...metadata,
        categories: [],
        suggestedCategories: [],
        updatedAt: new Date().toISOString(),
      });
      const page = await get<Page<RecordDto>>(
        `/records?q=${encodeURIComponent(u.title)}`,
      );
      expect(page.body.items).toHaveLength(0);
      expect((await get(`/records/${record.id}`)).status).toBe(404);
    });

    it('keeps your title when the parse result arrives after your edit', async () => {
      const u = upload('bolletta');
      await apply('upload.completed@1', u);
      const { sizeBytes: _size, ...metadata } = u;
      await apply('upload.updated@1', {
        ...metadata,
        title: `${u.title} edited`,
        categories: [],
        suggestedCategories: [],
        updatedAt: new Date().toISOString(),
      });
      await apply('document.parsed@1', parsed(u));
      const record = await findByTitle(`${u.title} edited`);
      expect(record.status).toBe('PARSED');
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
