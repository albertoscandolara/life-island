import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import type {
  CategoryChangedV1,
  CategoryDto,
  CategoryHierarchyDto,
  CreateCategoryRequest,
  Page,
  UploadDto,
} from '@life-island/contracts';
import { documentCategories, uploads } from '@life-island/ingestion-db';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

describe.skipIf(!configured)(
  'category hierarchy and metadata dimensions',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    /** A test category id, unique to this run: `id('BILL')` is `T<suffix>_BILL`. */
    const id = (name: string) => `T${suffix}_${name}`;
    const created: string[] = [];
    const uploadIds: string[] = [];
    const db = () => drizzle(svc.pool);

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0, storageCorsOrigins: [] };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'ingestion',
      });
    });

    afterAll(async () => {
      // Never let a relay publish events about test rows.
      await svc.pool.query(
        `delete from ingestion.outbox
        where payload->>'uploadId' = any($1) or payload->>'id' like $2`,
        [uploadIds, `T${suffix}_%`],
      );
      if (uploadIds.length)
        await db().delete(uploads).where(inArray(uploads.id, uploadIds));
      // Children first: a parent cannot be deleted under them.
      await svc.pool.query(
        `update ingestion.document_categories set parent_id = null where id like $1`,
        [`T${suffix}_%`],
      );
      await db()
        .delete(documentCategories)
        .where(inArray(documentCategories.id, created));
      await svc?.close();
      await app?.close();
    });

    async function call<T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: T }> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : undefined) as T,
      };
    }

    async function category(
      name: string,
      extra: Partial<CreateCategoryRequest> = {},
    ): Promise<CategoryDto> {
      const response = await call<CategoryDto>('POST', '/categories', {
        id: id(name),
        title: `${name} ${suffix}`,
        description: `Test category ${name}`,
        ...extra,
      });
      expect(response.status).toBe(201);
      created.push(response.body.id);
      return response.body;
    }

    async function document(categories: string[]): Promise<string> {
      const uploadId = randomUUID();
      await db()
        .insert(uploads)
        .values({
          id: uploadId,
          title: `Document ${suffix}`,
          originalFilename: 'doc.pdf',
          storageKey: `test/${uploadId}`,
          status: 'PARSED',
          fileFormat: 'PDF',
          categories,
          completedSteps: ['CLASSIFY', 'EXTRACT', 'DISCOVER'],
        });
      uploadIds.push(uploadId);
      return uploadId;
    }

    const getCategory = async (categoryId: string) =>
      (await call<CategoryDto[]>('GET', '/categories')).body.find(
        (item) => item.id === categoryId,
      );

    async function changedEvents(categoryId: string) {
      const { rows } = await svc.pool.query<{ payload: CategoryChangedV1 }>(
        `select payload from ingestion.outbox
        where event_type = 'category.changed@1' and payload->>'id' = $1
        order by created_at, id`,
        [categoryId],
      );
      return rows.map((row) => row.payload);
    }

    // BILL > ELECTRICITY_BILL, GAS_BILL; TAX > PROPERTY_TAX > IMU
    let bill: CategoryDto;
    beforeAll(async () => {
      bill = await category('BILL', { dimension: 'DOCUMENT_TYPE' });
      await category('ELECTRICITY_BILL', { parentId: id('BILL') });
      await category('GAS_BILL', { parentId: id('BILL') });
      await category('TAX', { dimension: 'DOCUMENT_TYPE' });
      await category('PROPERTY_TAX', { parentId: id('TAX') });
      await category('IMU', { parentId: id('PROPERTY_TAX') });
      await category('INVOICE', { dimension: 'DOCUMENT_TYPE' });
      await category('MEDICAL', { dimension: 'SUBJECT' });
      await category('HOME', { dimension: 'SUBJECT' });
      await category('TREGNAGO', { dimension: 'PROPERTY' });
      await category('ME', { dimension: 'PERSON' });
      await category('SPOUSE', { dimension: 'PERSON' });
      await category('ENEL', { dimension: 'ISSUER' });
      await category('AMAZON', { dimension: 'ISSUER' });
      await category('PAID', { dimension: 'ATTRIBUTE' });
      await category('TAX_DEDUCTIBLE', { dimension: 'ATTRIBUTE' });
    });

    it('gives a root several children, children inheriting its dimension', async () => {
      expect(bill).toMatchObject({
        parentId: null,
        dimension: 'DOCUMENT_TYPE',
      });
      const { body } = await call<CategoryHierarchyDto>(
        'GET',
        `/categories/${id('BILL')}/hierarchy`,
      );
      expect(body.ancestors).toEqual([]);
      expect(body.children.map((child) => child.id).sort()).toEqual(
        [id('ELECTRICITY_BILL'), id('GAS_BILL')].sort(),
      );
      expect(body.children.every((c) => c.dimension === 'DOCUMENT_TYPE')).toBe(
        true,
      );
    });

    it('nests several levels and reports ancestors and descendants', async () => {
      const imu = await call<CategoryHierarchyDto>(
        'GET',
        `/categories/${id('IMU')}/hierarchy`,
      );
      expect(imu.body.ancestors.map((item) => item.id)).toEqual([
        id('TAX'),
        id('PROPERTY_TAX'),
      ]);
      const tax = await call<CategoryHierarchyDto>(
        'GET',
        `/categories/${id('TAX')}/hierarchy`,
      );
      expect(tax.body.children.map((item) => item.id)).toEqual([
        id('PROPERTY_TAX'),
      ]);
      expect(tax.body.descendants.map((item) => item.id)).toEqual([
        id('PROPERTY_TAX'),
        id('IMU'),
      ]);
    });

    it('rejects a category as its own parent and every cycle', async () => {
      const self = await call<{ message: string }>(
        'PATCH',
        `/categories/${id('TAX')}`,
        { parentId: id('TAX') },
      );
      expect(self.status).toBe(422);
      const cycle = await call<{ message: string }>(
        'PATCH',
        `/categories/${id('TAX')}`,
        { parentId: id('IMU') },
      );
      expect(cycle.status).toBe(422);
      expect(cycle.body.message).toMatch(/own descendant/);
      // The database refuses it too, whatever the caller.
      await expect(
        svc.pool.query(
          `update ingestion.document_categories set parent_id = $1 where id = $2`,
          [id('PROPERTY_TAX'), id('TAX')],
        ),
      ).rejects.toThrow(/below its own descendant/);
      expect((await getCategory(id('TAX')))?.parentId).toBeNull();
    });

    it('refuses mixing dimensions in one tree', async () => {
      const wrong = await call<{ message: string }>('POST', '/categories', {
        id: id('WRONG'),
        title: `Wrong ${suffix}`,
        description: 'x',
        parentId: id('BILL'),
        dimension: 'SUBJECT',
      });
      expect(wrong.status).toBe(422);
      const move = await call<{ message: string }>(
        'PATCH',
        `/categories/${id('MEDICAL')}`,
        { parentId: id('BILL') },
      );
      expect(move.status).toBe(422);
      const child = await call<{ message: string }>(
        'PATCH',
        `/categories/${id('GAS_BILL')}`,
        { dimension: 'SUBJECT' },
      );
      expect(child.status).toBe(422);
    });

    it('moves a category with its subtree, keeping its id and documents', async () => {
      const doc = await document([id('IMU')]);
      const moved = await call<CategoryDto>(
        'PATCH',
        `/categories/${id('PROPERTY_TAX')}`,
        { parentId: id('BILL') },
      );
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({
        id: id('PROPERTY_TAX'),
        parentId: id('BILL'),
      });
      const imu = await call<CategoryHierarchyDto>(
        'GET',
        `/categories/${id('IMU')}/hierarchy`,
      );
      expect(imu.body.ancestors.map((item) => item.id)).toEqual([
        id('BILL'),
        id('PROPERTY_TAX'),
      ]);
      expect(
        (await call<UploadDto>('GET', `/uploads/${doc}`)).body.categories,
      ).toEqual([id('IMU')]);
      // The review inbox hears about the move.
      expect((await changedEvents(id('PROPERTY_TAX'))).at(-1)).toMatchObject({
        parentId: id('BILL'),
        deleted: false,
      });

      // And back: a root again, then under TAX.
      await call('PATCH', `/categories/${id('PROPERTY_TAX')}`, {
        parentId: null,
      });
      expect((await getCategory(id('PROPERTY_TAX')))?.parentId).toBeNull();
      await call('PATCH', `/categories/${id('PROPERTY_TAX')}`, {
        parentId: id('TAX'),
      });
      expect((await getCategory(id('PROPERTY_TAX')))?.parentId).toBe(id('TAX'));
    });

    it('gives a general tree its new parent dimension, and a root dimension change its subtree', async () => {
      await category('UTILITY');
      await category('GAS_UTILITY', { parentId: id('UTILITY') });
      expect((await getCategory(id('GAS_UTILITY')))?.dimension).toBeNull();
      await call('PATCH', `/categories/${id('UTILITY')}`, {
        dimension: 'SUBJECT',
      });
      expect((await getCategory(id('GAS_UTILITY')))?.dimension).toBe('SUBJECT');
      expect((await changedEvents(id('GAS_UTILITY'))).at(-1)?.dimension).toBe(
        'SUBJECT',
      );
    });

    it('counts documents per category, descendants included in the total', async () => {
      await document([id('ELECTRICITY_BILL')]);
      await document([id('GAS_BILL'), id('BILL')]);
      const counted = await getCategory(id('BILL'));
      expect(counted).toMatchObject({
        documentCount: 1,
        totalDocumentCount: 2,
      });
    });

    it('lists documents of a category and its descendants, not its ancestors or siblings', async () => {
      const electric = await document([id('ELECTRICITY_BILL')]);
      const gas = await document([id('GAS_BILL')]);
      const generic = await document([id('BILL')]);
      const list = async (categoryId: string) =>
        (
          await call<Page<UploadDto>>(
            'GET',
            `/uploads?category=${categoryId}&limit=100`,
          )
        ).body.items.map((item) => item.id);
      expect(await list(id('BILL'))).toEqual(
        expect.arrayContaining([electric, gas, generic]),
      );
      const onlyElectric = await list(id('ELECTRICITY_BILL'));
      expect(onlyElectric).toContain(electric);
      expect(onlyElectric).not.toContain(gas);
      expect(onlyElectric).not.toContain(generic);
    });

    describe('document metadata', () => {
      const save = (uploadId: string, categories: string[]) =>
        call<UploadDto & { message?: string }>(
          'PATCH',
          `/uploads/${uploadId}`,
          {
            categories,
          },
        );

      it('classifies a medical document without a property, person or issuer', async () => {
        const doc = await document([]);
        const saved = await save(doc, [id('INVOICE'), id('MEDICAL')]);
        expect(saved.status).toBe(200);
        expect(saved.body.categories).toEqual([id('INVOICE'), id('MEDICAL')]);
      });

      it('lets an electricity bill have a property, or not', async () => {
        const withProperty = await save(await document([]), [
          id('ELECTRICITY_BILL'),
          id('HOME'),
          id('TREGNAGO'),
          id('ENEL'),
        ]);
        expect(withProperty.status).toBe(200);
        const without = await save(await document([]), [
          id('ELECTRICITY_BILL'),
        ]);
        expect(without.status).toBe(200);
      });

      it('takes several people, subjects and attributes on one document', async () => {
        const saved = await save(await document([]), [
          id('INVOICE'),
          id('MEDICAL'),
          id('HOME'),
          id('ME'),
          id('SPOUSE'),
          id('PAID'),
          id('TAX_DEDUCTIBLE'),
        ]);
        expect(saved.status).toBe(200);
        expect(saved.body.categories).toHaveLength(7);
      });

      it('allows one document type and one issuer, a parent with its child counting as one', async () => {
        const doc = await document([]);
        expect(
          (await save(doc, [id('BILL'), id('ELECTRICITY_BILL')])).status,
        ).toBe(200);
        const twoTypes = await save(doc, [id('INVOICE'), id('GAS_BILL')]);
        expect(twoTypes.status).toBe(422);
        expect(twoTypes.body.message).toMatch(/at most one document type/);
        expect((await save(doc, [id('ENEL'), id('AMAZON')])).status).toBe(422);
      });
    });

    describe('deleting', () => {
      it('needs a decision for the children, and never deletes documents', async () => {
        await category('PARENT', { dimension: 'SUBJECT' });
        await category('MIDDLE', { parentId: id('PARENT') });
        await category('LEAF', { parentId: id('MIDDLE') });
        const doc = await document([id('MIDDLE'), id('HOME')]);

        const undecided = await call<{ message: string }>(
          'DELETE',
          `/categories/${id('MIDDLE')}`,
        );
        expect(undecided.status).toBe(409);
        expect(undecided.body.message).toMatch(/subcategor/);

        const deleted = await call(
          'DELETE',
          `/categories/${id('MIDDLE')}?children=MOVE_TO_PARENT&documents=MOVE_TO_PARENT`,
        );
        expect(deleted.status).toBe(204);
        expect((await getCategory(id('LEAF')))?.parentId).toBe(id('PARENT'));
        const upload = await call<UploadDto>('GET', `/uploads/${doc}`);
        expect(upload.status).toBe(200);
        expect(upload.body.categories).toEqual([id('PARENT'), id('HOME')]);
        expect((await changedEvents(id('MIDDLE'))).at(-1)).toMatchObject({
          deleted: true,
        });

        const root = await call(
          'DELETE',
          `/categories/${id('PARENT')}?children=MAKE_ROOT`,
        );
        expect(root.status).toBe(204);
        expect((await getCategory(id('LEAF')))?.parentId).toBeNull();
        const after = await call<UploadDto>('GET', `/uploads/${doc}`);
        expect(after.status).toBe(200);
        expect(after.body.categories).toEqual([id('HOME')]);
      });
    });
  },
);
