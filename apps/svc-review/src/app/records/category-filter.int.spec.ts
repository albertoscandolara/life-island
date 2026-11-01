import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  CategoryChangedV1,
  CategoryCountDto,
  EventEnvelope,
  Page,
  RecordDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { applyDocumentEvent } from './document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['REVIEW_DATABASE_URL'];

describe.skipIf(!configured)(
  'review inbox: hierarchical category filter',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const marker = randomUUID().slice(0, 8);
    const suffix = marker.toUpperCase();
    const id = (name: string) => `T${suffix}_${name}`;

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
      await svc?.pool.query(
        `delete from review.category_tree where id like $1`,
        [`T${suffix}_%`],
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

    async function category(
      name: string,
      parent: string | null,
      changes: Partial<CategoryChangedV1> = {},
    ): Promise<void> {
      await apply('category.changed@1', {
        id: id(name),
        title: name,
        parentId: parent ? id(parent) : null,
        dimension: 'DOCUMENT_TYPE',
        deleted: false,
        changedAt: new Date().toISOString(),
        ...changes,
      } satisfies CategoryChangedV1);
    }

    /** A record with these categories (test names), PARSED unless said otherwise. */
    async function record(
      title: string,
      categories: string[],
      status: 'parsed' | 'uploaded' = 'parsed',
    ): Promise<string> {
      const uploadId = randomUUID();
      const base = {
        uploadId,
        title: `${title} ${marker}`,
        description: null,
        originalFilename: `${title}.pdf`,
        fileFormat: 'PDF' as const,
        uploadedAt: new Date().toISOString(),
      };
      await apply('upload.completed@1', { ...base, sizeBytes: 10 });
      if (status === 'parsed')
        await apply('document.parsed@1', {
          ...base,
          sizeBytes: 10,
          category: 'other',
          targetKey: 'general.document@1',
          details: { documentType: 'bill', summary: 'x', keyFacts: [] },
          confidence: 0.9,
          flags: [],
          parsedAt: new Date().toISOString(),
        });
      await apply('upload.updated@1', {
        ...base,
        categories: categories.map(id),
        suggestedCategories: [],
        updatedAt: new Date().toISOString(),
      });
      return base.title;
    }

    async function titles(query: string): Promise<string[]> {
      const response = await fetch(
        `${base}/records?limit=100&q=${marker}&${query}`,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as Page<RecordDto>;
      return page.items.map((item) => item.title.replace(` ${marker}`, ''));
    }

    beforeAll(async () => {
      // BILL > ELECTRICITY_BILL, GAS_BILL, WATER_BILL, TELECOMMUNICATION > MOBILE > MOBILE_ROAMING
      await category('BILL', null);
      for (const child of [
        'ELECTRICITY_BILL',
        'GAS_BILL',
        'WATER_BILL',
        'TELECOMMUNICATION',
      ])
        await category(child, 'BILL');
      await category('MOBILE', 'TELECOMMUNICATION');
      await category('MOBILE_ROAMING', 'MOBILE');
      await category('MEDICAL', null, { dimension: 'SUBJECT' });

      await record('generic bill', ['BILL']);
      await record('electricity', ['ELECTRICITY_BILL']);
      await record('gas', ['GAS_BILL']);
      await record('water', ['WATER_BILL'], 'uploaded');
      await record('roaming', ['MOBILE_ROAMING']);
      await record('doctor', ['MEDICAL']);
      await record('nothing', []);
    });

    it('filtering by BILL includes BILL and all its descendants', async () => {
      expect((await titles(`documentCategory=${id('BILL')}`)).sort()).toEqual(
        ['electricity', 'gas', 'generic bill', 'roaming', 'water'].sort(),
      );
    });

    it('filtering by ELECTRICITY_BILL includes neither BILL nor GAS_BILL', async () => {
      expect(
        await titles(`documentCategory=${id('ELECTRICITY_BILL')}`),
      ).toEqual(['electricity']);
    });

    it('works at any depth', async () => {
      expect(
        await titles(`documentCategory=${id('TELECOMMUNICATION')}`),
      ).toEqual(['roaming']);
      expect(await titles(`documentCategory=${id('MOBILE_ROAMING')}`)).toEqual([
        'roaming',
      ]);
    });

    it('combines with the status and search filters', async () => {
      expect(
        (await titles(`documentCategory=${id('BILL')}&status=PARSED`)).sort(),
      ).toEqual(['electricity', 'gas', 'generic bill', 'roaming'].sort());
      expect(
        await titles(`documentCategory=${id('BILL')}&status=UPLOADED`),
      ).toEqual(['water']);
      const response = await fetch(
        `${base}/records?q=${encodeURIComponent(`gas ${marker}`)}&documentCategory=${id('BILL')}`,
      );
      const page = (await response.json()) as Page<RecordDto>;
      expect(page.items.map((item) => item.title)).toEqual([`gas ${marker}`]);
    });

    it('several categories show the records of any of them', async () => {
      expect(
        (
          await titles(
            `documentCategory=${id('ELECTRICITY_BILL')},${id('MEDICAL')}`,
          )
        ).sort(),
      ).toEqual(['doctor', 'electricity']);
    });

    it('matches only the category itself when subcategories are excluded', async () => {
      expect(
        await titles(
          `documentCategory=${id('BILL')}&includeSubcategories=false`,
        ),
      ).toEqual(['generic bill']);
    });

    it('follows moves and deletions of categories', async () => {
      // MOBILE moves out of BILL's tree: roaming no longer matches BILL.
      await category('MOBILE', null);
      expect(await titles(`documentCategory=${id('BILL')}`)).not.toContain(
        'roaming',
      );
      expect(await titles(`documentCategory=${id('MOBILE')}`)).toEqual([
        'roaming',
      ]);
      // An older event arriving late changes nothing.
      await category('MOBILE', 'TELECOMMUNICATION', {
        changedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(await titles(`documentCategory=${id('BILL')}`)).not.toContain(
        'roaming',
      );
      // Back under TELECOMMUNICATION.
      await category('MOBILE', 'TELECOMMUNICATION');
      expect(await titles(`documentCategory=${id('BILL')}`)).toContain(
        'roaming',
      );
    });

    it('counts records per category under the other filters', async () => {
      const response = await fetch(
        `${base}/records/category-counts?q=${marker}&status=PARSED`,
      );
      expect(response.status).toBe(200);
      const counts = (await response.json()) as CategoryCountDto[];
      const of = (name: string) => counts.find((item) => item.id === id(name));
      expect(of('BILL')).toEqual({ id: id('BILL'), direct: 1, total: 4 });
      expect(of('TELECOMMUNICATION')).toMatchObject({ direct: 0, total: 1 });
      expect(of('WATER_BILL')).toMatchObject({ direct: 0, total: 0 });
      expect(of('MEDICAL')).toMatchObject({ direct: 1, total: 1 });
    });
  },
);
