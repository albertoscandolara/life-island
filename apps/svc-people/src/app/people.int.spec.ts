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
  PersonSummaryDto,
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

    it('never makes a person from a document read as nothing', async () => {
      const blank = await upload(['PASSPORT'], {});
      expect(
        (await send('POST', `/reviews/${blank}/approve`, { personId: null }))
          .status,
      ).toBe(422);
      // It can still be filed under someone you pick.
      expect(
        (await send('POST', `/reviews/${blank}/approve`, { personId })).status,
      ).toBe(204);
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

    it('links a residence to a house, and a typed address unlinks it', async () => {
      const house = randomUUID();
      expect(
        (
          await send('PATCH', `/people/${personId}`, {
            residencePropertyId: house,
            residenceAddress: 'Via Ponzilovo 1, Verona',
          })
        ).status,
      ).toBe(204);
      expect(await person(personId)).toMatchObject({
        residencePropertyId: house,
        residenceAddress: 'Via Ponzilovo 1, Verona',
      });
      await send('PATCH', `/people/${personId}`, {
        residenceAddress: 'Via Roma 2, Milano',
      });
      expect(await person(personId)).toMatchObject({
        residencePropertyId: null,
        residenceAddress: 'Via Roma 2, Milano',
      });
      await send('PATCH', `/people/${personId}`, { residenceAddress: null });
    });

    it('says when the Home area cannot list its houses', async () => {
      const houses = await json<{ available: boolean; houses: unknown[] }>(
        await send('GET', '/houses'),
      );
      // Either svc-home answered, or Residence falls back to typing.
      expect(houses.available || houses.houses.length === 0).toBe(true);
    });

    it('records your edits in the history, with the documents', async () => {
      await send('PATCH', `/people/${personId}`, { birthPlace: 'VERONA' });
      const maria = await person(personId);
      expect(maria.history[0]).toMatchObject({
        kind: 'edit',
        changes: [{ field: 'birthPlace', previous: null, value: 'VERONA' }],
      });
      expect(maria.history.map((h) => h.kind)).toContain('created');
      expect(maria.taxCodeCheck.status).not.toBe('unknown');
    });

    it('relates people, keeps fiscal dependents, and counts what needs you', async () => {
      const childCard = await upload(['IDENTITY_CARD'], {
        last_name: lastName,
        first_name: 'CHILD',
        birth_date: day(-365 * 10),
        valid_for_travel: 'false',
        card_format: 'electronic',
        card_access_number: '123456',
        expiry_date: day(-1),
      });
      await send('POST', `/reviews/${childCard}/approve`, { personId: null });
      const child = (await overview()).people.find(
        (p) => p.firstName === 'CHILD',
      ) as PersonDto;
      expect(child.age).toBe(9);
      expect(child.series[0].versions[0].details).toMatchObject({
        cardFormat: 'electronic',
        cardAccessNumber: '123456',
        validForTravel: false,
      });
      expect(child.notices.map((n) => n.text).join(' ')).toMatch(/Under 14/);

      expect(
        (
          await send('POST', `/people/${personId}/relations`, {
            personId: child.id,
            kind: 'child',
          })
        ).status,
      ).toBe(204);
      expect((await person(child.id)).relations).toEqual([
        { personId, kind: 'parent' },
      ]);
      expect(
        (
          await send('PATCH', `/people/${child.id}`, {
            taxDependentOf: personId,
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await send('PATCH', `/people/${personId}`, {
            taxDependentOf: child.id,
          })
        ).status,
      ).toBe(422);

      const attention = await json<{ expired: number; toReview: number }>(
        await send('GET', '/attention'),
      );
      expect(attention.expired).toBeGreaterThanOrEqual(1);

      const summary = (
        await json<PersonSummaryDto[]>(await send('GET', '/people'))
      ).find((p) => p.id === child.id);
      expect(summary).toMatchObject({
        taxDependentOf: personId,
        drivingLicence: null,
      });

      expect(
        (await send('DELETE', `/people/${personId}/relations/${child.id}`))
          .status,
      ).toBe(204);
      expect((await person(child.id)).relations).toEqual([]);
      await send('DELETE', `/people/${child.id}`);
    });

    it('answers 503 for a renewal guide without a Claude key', async () => {
      const response = await send(
        'POST',
        `/people/${personId}/renewal-guides`,
        { type: 'PASSPORT', town: 'Verona' },
      );
      // With a key and the tool on it writes a guide; without, it says why.
      expect([201, 503]).toContain(response.status);
    });

    it('merges a duplicate into a person, moving its documents and filling only unknown details', async () => {
      const passport = await upload(['PASSPORT'], {
        last_name: lastName,
        first_name: 'DUPLICATE',
        birth_place: 'VERONA',
      });
      await send('POST', `/reviews/${passport}/approve`, { personId: null });
      const duplicate = (await overview()).people.find(
        (p) => p.firstName === 'DUPLICATE',
      ) as PersonDto;
      const before = await person(personId);

      expect(
        (
          await send('POST', `/people/${personId}/merge`, {
            from: duplicate.id,
          })
        ).status,
      ).toBe(204);
      const all = await overview();
      expect(all.people.some((p) => p.id === duplicate.id)).toBe(false);
      const merged = all.people.find((p) => p.id === personId) as PersonDto;
      expect(merged.firstName).toBe(before.firstName);
      expect(merged.birthPlace).toBe(before.birthPlace ?? 'VERONA');
      expect(
        merged.series.some((s) =>
          s.versions.some((v) => v.uploadId === passport),
        ),
      ).toBe(true);
    });

    it('never merges two people with different tax codes', async () => {
      const other = await upload(['IDENTITY_CARD'], {
        last_name: lastName,
        first_name: 'STRANGER',
        tax_code: `ZZZZZZ00A00${run.slice(0, 4).padEnd(4, 'Y')}Z`.slice(0, 16),
      });
      await send('POST', `/reviews/${other}/approve`, { personId: null });
      const stranger = (await overview()).people.find(
        (p) => p.firstName === 'STRANGER',
      ) as PersonDto;
      expect(
        (await send('POST', `/people/${personId}/merge`, { from: stranger.id }))
          .status,
      ).toBe(409);
    });

    it('removes a person and sends their documents back to review', async () => {
      const stranger = (await overview()).people.find(
        (p) => p.firstName === 'STRANGER',
      ) as PersonDto;
      const documents = stranger.series.flatMap((s) =>
        s.versions.map((v) => v.uploadId),
      );
      expect((await send('DELETE', `/people/${stranger.id}`)).status).toBe(204);
      const all = await overview();
      expect(all.people.some((p) => p.id === stranger.id)).toBe(false);
      for (const uploadId of documents)
        expect(all.reviews.some((r) => r.uploadId === uploadId)).toBe(true);
      expect((await send('DELETE', `/people/${stranger.id}`)).status).toBe(404);
    });
  },
);
