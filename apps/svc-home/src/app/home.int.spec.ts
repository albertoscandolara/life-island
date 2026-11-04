import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  BillDto,
  EventEnvelope,
  PropertyDto,
  WorkDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { applyDocumentEvent } from './documents/document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['HOME_DATABASE_URL'];

describe.skipIf(!configured)(
  'Home (documents → bills, properties and works over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // Words of this run only, so bills never match another run's homes.
    const run = Math.random().toString(36).slice(2, 8);
    const createdProperties: string[] = [];
    const uploads: string[] = [];

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'home',
      });
    });

    afterAll(async () => {
      for (const id of createdProperties)
        await svc?.pool.query('delete from home.properties where id = $1', [
          id,
        ]);
      if (uploads.length) {
        await svc?.pool.query(
          'delete from home.bill_overrides where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from home.documents where upload_id = any($1)',
          [uploads],
        );
      }
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
      await processOnce(svc.pool, 'home', event.id, (client) =>
        applyDocumentEvent(event, client),
      );
    }

    async function upload(
      categories: string[],
      fields: Record<string, string | number | null>,
      title = 'Bill',
    ) {
      const uploadId = randomUUID();
      uploads.push(uploadId);
      await deliver('upload.updated@1', {
        uploadId,
        title,
        description: null,
        originalFilename: 'bill.pdf',
        fileFormat: 'PDF',
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

    async function createProperty(name: string, extra: object = {}) {
      const property = await json<PropertyDto>(
        await send('POST', '/properties', { name, ...extra }),
      );
      createdProperties.push(property.id);
      return property;
    }

    it('creates properties with their own colour and match terms', async () => {
      const first = await createProperty(`Via Alfa${run}`);
      expect(first.matchTerms).toEqual([`alfa${run}`]);
      const list = await json<PropertyDto[]>(await send('GET', '/properties'));
      const slots = list.map((p) => p.colorSlot);
      expect(new Set(slots).size).toBe(slots.length);
    });

    it('reads bills from documents and assigns them to their home', async () => {
      const alfa = await createProperty(`Casa A${run}`, {
        matchTerms: [`strada a${run}`],
      });
      const beta = await createProperty(`Casa B${run}`, {
        supplyCodes: [`IT001E${run}`],
      });
      // A subcategory of GAS_BILL still counts as gas.
      await deliver('category.changed@1', {
        id: `HERA_${run.toUpperCase()}`,
        title: `Hera ${run}`,
        parentId: 'GAS_BILL',
        dimension: null,
        deleted: false,
        changedAt: new Date().toISOString(),
      });
      const gas = await upload([`HERA_${run.toUpperCase()}`], {
        billing_period: '2026-01-01/2026-02-28',
        gas_consumption: '210',
        total_amount: '180,40',
        supply_address: `Strada A${run} 4, Verona`,
      });
      const power = await upload(['ELECTRICITY_BILL'], {
        customer_id: `it001e ${run}`,
        issue_date: '2026-03-10',
        electricity_consumption: 320,
        total_amount: 95.1,
      });
      await upload(['INVOICE'], { total_amount: 50 }, 'Not a bill');

      const bills = await json<BillDto[]>(
        await send('GET', `/bills?from=2026-01-01&to=2026-12-31`),
      );
      const byId = new Map(bills.map((bill) => [bill.uploadId, bill]));
      expect(byId.get(gas)).toMatchObject({
        utility: 'GAS',
        propertyId: alfa.id,
        assignment: 'ADDRESS',
        amount: 180.4,
        consumption: 210,
        periodStart: '2026-01-01',
      });
      expect(byId.get(power)).toMatchObject({
        utility: 'ELECTRICITY',
        propertyId: beta.id,
        assignment: 'SUPPLY_CODE',
      });
      expect(
        bills.every((bill) =>
          uploads.includes(bill.uploadId) ? bill.title !== 'Not a bill' : true,
        ),
      ).toBe(true);

      const onlyBeta = await json<BillDto[]>(
        await send('GET', `/bills?property=${beta.id}&utility=ELECTRICITY`),
      );
      expect(onlyBeta.map((bill) => bill.uploadId)).toEqual([power]);
    });

    it('keeps your corrections to a bill', async () => {
      const home = await createProperty(`Casa C${run}`);
      const uploadId = await upload(['WATER_BILL'], {
        issue_date: '2026-05-02',
        total_amount: 40,
      });
      const moved = await json<{ bill: BillDto }>(
        await send('PATCH', `/bills/${uploadId}`, {
          propertyId: home.id,
          utility: 'GAS',
        }),
      );
      expect(moved.bill).toMatchObject({
        propertyId: home.id,
        assignment: 'MANUAL',
        utility: 'GAS',
        utilityOverridden: true,
      });
      const excluded = await json<{ bill: BillDto | null }>(
        await send('PATCH', `/bills/${uploadId}`, { excluded: true }),
      );
      expect(excluded.bill).toBeNull();
      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.some((bill) => bill.uploadId === uploadId)).toBe(false);
    });

    it('tracks a work with its invoice', async () => {
      const home = await createProperty(`Casa D${run}`);
      const invoice = await upload(
        ['INVOICE'],
        {
          issue_date: '2026-04-01',
          total_amount: 1200,
        },
        'Plumber invoice',
      );
      const work = await json<WorkDto>(
        await send('POST', '/works', {
          propertyId: home.id,
          title: 'New boiler',
          kind: 'REPAIR',
          area: 'Boiler room',
          estimatedCost: 1500,
        }),
      );
      expect(work).toMatchObject({ status: 'PLANNED', documents: [] });

      const bad = await send('PATCH', `/works/${work.id}`, {
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      });
      expect(bad.status).toBe(400);

      const done = await json<WorkDto>(
        await send('PATCH', `/works/${work.id}`, {
          status: 'DONE',
          actualCost: 1200,
          endDate: '2026-04-01',
        }),
      );
      expect(done).toMatchObject({ status: 'DONE', actualCost: 1200 });

      const withInvoice = await json<WorkDto>(
        await send('POST', `/works/${work.id}/documents`, {
          uploadId: invoice,
        }),
      );
      expect(withInvoice.documents).toEqual([
        {
          uploadId: invoice,
          title: 'Plumber invoice',
          date: '2026-04-01',
          amount: 1200,
          deleted: false,
        },
      ]);

      const list = await json<WorkDto[]>(
        await send('GET', `/works?property=${home.id}`),
      );
      expect(list.map((w) => w.id)).toEqual([work.id]);

      const removed = await send('DELETE', `/works/${work.id}`);
      expect(removed.status).toBe(204);
    });
  },
);
