import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  EventEnvelope,
  PeopleOverviewDto,
  PendingReviewDto,
  PersonDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { applyDocumentEvent } from './documents/document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['PEOPLE_DATABASE_URL'];

describe.skipIf(!configured)(
  'People (ID documents → people, versions, review and expiry over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // Names and codes of this run only, so it never matches another run's people.
    const run = Math.random().toString(36).slice(2, 8).toUpperCase();
    const lastName = `ROSSI${run}`;
    const taxCode = `RSSMRA80A01${run.slice(0, 4).padEnd(4, 'X')}X`.slice(
      0,
      16,
    );
    const uploads: string[] = [];

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'people',
      });
      // The categories of svc-ingestion's migration 0010.
      for (const [id, parentId] of [
        ['ID_DOCUMENT', null],
        ['PASSPORT', 'ID_DOCUMENT'],
        ['IDENTITY_CARD', 'ID_DOCUMENT'],
        ['HEALTH_CARD', 'ID_DOCUMENT'],
      ])
        await deliver('category.changed@1', {
          id,
          title: id,
          parentId,
          dimension: 'DOCUMENT_TYPE',
          deleted: false,
          changedAt: new Date().toISOString(),
        });
    });

    afterAll(async () => {
      if (uploads.length) {
        await svc?.pool.query(
          'delete from people.reviews where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from people.documents where upload_id = any($1)',
          [uploads],
        );
      }
      await svc?.pool.query('delete from people.persons where last_name = $1', [
        lastName,
      ]);
      await svc?.close();
      await app?.close();
    });

    async function deliver(type: string, payload: unknown) {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      await processOnce(svc.pool, 'people', event.id, (client) =>
        applyDocumentEvent(event, client),
      );
    }

    async function upload(
      categories: string[],
      fields: Record<string, string | null>,
    ) {
      const uploadId = randomUUID();
      uploads.push(uploadId);
      await deliver('upload.updated@1', {
        uploadId,
        title: `${categories[0]} ${run}`,
        description: null,
        originalFilename: 'scan.jpg',
        fileFormat: 'JPG',
        uploadedAt: new Date().toISOString(),
        categories,
        suggestedCategories: [],
        fields,
        updatedAt: new Date().toISOString(),
      });
      return uploadId;
    }

    const json = async <T>(response: Response): Promise<T> => {
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return (await response.json()) as T;
    };
    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const overview = async () =>
      json<PeopleOverviewDto>(await send('GET', '/overview'));
    const review = async (uploadId: string) =>
      (await overview()).reviews.find(
        (r) => r.uploadId === uploadId,
      ) as PendingReviewDto;
    const person = async (id: string) =>
      (await overview()).people.find((p) => p.id === id) as PersonDto;
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

    let personId: string;

    it('holds a new person for review and creates them on approval', async () => {
      const card = await upload(['HEALTH_CARD'], {
        last_name: lastName,
        first_name: 'MARIA',
        tax_code: taxCode,
        birth_date: '1980-01-01',
        sex: 'F',
        document_number: `8038${run}`,
        issue_date: day(-400),
        expiry_date: day(30),
      });
      const pending = await review(card);
      expect(pending).toMatchObject({
        type: 'HEALTH_CARD',
        personId: null,
        match: 'none',
      });
      expect(pending.changes.map((c) => c.field)).toEqual([
        'lastName',
        'firstName',
        'taxCode',
        'birthDate',
        'sex',
      ]);

      const approved = await send('POST', `/reviews/${card}/approve`, {
        personId: null,
      });
      expect(approved.status).toBe(204);
      const all = await overview();
      expect(all.reviews.some((r) => r.uploadId === card)).toBe(false);
      const created = all.people.find((p) => p.lastName === lastName);
      expect(created).toMatchObject({ taxCode, firstName: 'MARIA' });
      personId = created?.id ?? '';
      // 30 days left: within a health card's 60.
      expect(created?.alerts).toEqual([
        expect.objectContaining({ level: 'expiring', uploadId: card }),
      ]);
    });

    it('matches a passport by name and birth date and applies only what you accept', async () => {
      const passport = await upload(['PASSPORT'], {
        last_name: lastName,
        first_name: 'Maria',
        birth_date: '1980-01-01',
        citizenship: 'IT',
        residence_address: 'VERONA',
        sex: 'M',
        document_number: `YA${run}`,
        issue_date: day(-10),
        expiry_date: day(3650),
      });
      const pending = await review(passport);
      expect(pending).toMatchObject({ personId, match: 'name_and_birth_date' });
      expect(
        pending.changes.map((c) => [c.field, c.kind, c.suggestion]),
      ).toEqual([
        ['sex', 'different_value', 'check'],
        ['citizenship', 'new_value', 'accept'],
        ['residenceAddress', 'new_value', 'accept'],
      ]);

      const approved = await send('POST', `/reviews/${passport}/approve`, {
        personId,
        accept: ['citizenship', 'residenceAddress'],
      });
      expect(approved.status).toBe(204);
      const maria = await person(personId);
      expect(maria).toMatchObject({
        sex: 'F',
        citizenship: 'IT',
        residenceAddress: 'VERONA',
      });
      expect(maria.series.map((s) => s.type)).toEqual([
        'PASSPORT',
        'HEALTH_CARD',
      ]);
      expect(
        (await send('POST', `/reviews/${passport}/approve`, { personId }))
          .status,
      ).toBe(409);
    });

    it('keeps old versions, numbers them and warns about the latest only', async () => {
      const renewed = await upload(['HEALTH_CARD'], {
        last_name: lastName,
        first_name: 'MARIA',
        tax_code: taxCode,
        birth_date: '1980-01-01',
        issue_date: day(-5),
        expiry_date: day(2000),
      });
      expect((await review(renewed)).changes).toEqual([]);
      await send('POST', `/reviews/${renewed}/approve`, { personId });
      const maria = await person(personId);
      const health = maria.series.find((s) => s.type === 'HEALTH_CARD');
      expect(health?.versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'current'],
        [1, 'superseded'],
      ]);
      expect(maria.alerts).toEqual([]);

      // A lost passport is not current any more and never warns.
      const passport = maria.series.find((s) => s.type === 'PASSPORT')
        ?.versions[0].uploadId;
      expect(
        (await send('PATCH', `/documents/${passport}`, { status: 'lost' }))
          .status,
      ).toBe(204);
      expect(
        (await person(personId)).series.find((s) => s.type === 'PASSPORT')
          ?.versions[0].status,
      ).toBe('lost');
    });

    it('rejects a document that is nobody’s and reopens it', async () => {
      const stray = await upload(['ID_DOCUMENT'], { last_name: 'NOBODY' });
      await send('POST', `/reviews/${stray}/reject`);
      let all = await overview();
      expect(all.reviews.some((r) => r.uploadId === stray)).toBe(false);
      expect(all.rejected.some((r) => r.uploadId === stray)).toBe(true);
      await send('POST', `/reviews/${stray}/reopen`);
      all = await overview();
      expect(all.reviews.some((r) => r.uploadId === stray)).toBe(true);
    });

    it('refuses a second person with the same tax code', async () => {
      const twin = await upload(['IDENTITY_CARD'], {
        last_name: lastName,
        first_name: 'OTHER',
        tax_code: taxCode,
      });
      expect(
        (await send('POST', `/reviews/${twin}/approve`, { personId: null }))
          .status,
      ).toBe(409);
    });
  },
);
