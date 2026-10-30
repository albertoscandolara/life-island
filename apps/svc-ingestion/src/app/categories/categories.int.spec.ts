import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import type {
  CategoryDto,
  CategorySuggestionDto,
  ExtractedFields,
  ParseQueueDto,
  UploadDto,
  UploadUpdatedV1,
} from '@life-island/contracts';
import {
  categorySuggestions,
  documentCategories,
  uploads,
} from '@life-island/ingestion-db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

describe.skipIf(!configured)('categories and suggestions API', () => {
  let app: INestApplication;
  let base: string;
  let svc: ServiceDb;
  const uploadIds: string[] = [];
  const categoryIds: string[] = [];
  const suggestionIds: string[] = [];
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
    // These events are about test rows: never let a relay publish them.
    if (uploadIds.length)
      await svc.pool.query(
        `delete from ingestion.outbox where payload->>'uploadId' = any($1)`,
        [uploadIds],
      );
    if (suggestionIds.length)
      await db()
        .delete(categorySuggestions)
        .where(inArray(categorySuggestions.id, suggestionIds));
    if (categoryIds.length)
      await db()
        .delete(documentCategories)
        .where(inArray(documentCategories.id, categoryIds));
    if (uploadIds.length)
      await db().delete(uploads).where(inArray(uploads.id, uploadIds));
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

  /** The newest `upload.updated` snapshot in the outbox for a document. */
  async function lastSnapshot(
    uploadId: string,
  ): Promise<UploadUpdatedV1 | undefined> {
    const { rows } = await svc.pool.query<{ payload: UploadUpdatedV1 }>(
      `select payload from ingestion.outbox
        where event_type = 'upload.updated@1' and payload->>'uploadId' = $1
        order by created_at desc, id desc limit 1`,
      [uploadId],
    );
    return rows[0]?.payload;
  }

  const extracted: ExtractedFields = {
    fields: {
      total_amount: {
        label: 'Total amount',
        type: 'amount',
        value: 10,
        status: 'found',
        required: true,
        categories: ['BILL'],
      },
      currency: {
        label: 'Currency',
        type: 'currency',
        value: null,
        status: 'missing',
        required: false,
        categories: ['BILL'],
      },
    },
    warnings: ['Total amount: conflicting (10 / 12)'],
  };

  async function parsedUpload(): Promise<string> {
    const id = randomUUID();
    await db()
      .insert(uploads)
      .values({
        id,
        title: 'Bolletta Enel',
        originalFilename: 'enel.pdf',
        storageKey: `test/${id}`,
        status: 'PARSED',
        fileFormat: 'PDF',
        categories: ['BILL', 'EXPENSE'],
        extractedFields: extracted,
        completedSteps: ['CLASSIFY', 'EXTRACT', 'DISCOVER'],
      });
    uploadIds.push(id);
    return id;
  }

  async function suggestion(
    uploadIdsOf: string[],
  ): Promise<{ id: string; categoryId: string }> {
    const categoryId = `TEST_ENEL_${randomUUID().slice(0, 8).toUpperCase()}`;
    const [row] = await db()
      .insert(categorySuggestions)
      .values({
        categoryId,
        title: `Enel ${categoryId}`,
        description: 'Documents issued by Enel',
        templateJson: {
          fields: [
            {
              key: 'total_amount',
              label: 'Total',
              type: 'amount',
              description: '',
              required: true,
            },
          ],
        },
        reason: 'Issued by ENEL Energia',
        uploadIds: uploadIdsOf,
      })
      .returning();
    suggestionIds.push(row.id);
    categoryIds.push(categoryId);
    return { id: row.id, categoryId };
  }

  it('lists the starter categories with their templates', async () => {
    const { status, body } = await call<CategoryDto[]>('GET', '/categories');
    expect(status).toBe(200);
    const invoice = body.find((category) => category.id === 'INVOICE');
    expect(invoice?.template.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'invoice_number',
        'issue_date',
        'supplier_name',
        'supplier_vat_number',
        'customer_name',
        'total_amount',
        'currency',
        'tax_amount',
        'due_date',
      ]),
    );
    expect(body.find((category) => category.id === 'WATER_BILL')).toBeTruthy();
  });

  it('approves a suggestion into a category and assigns it to the documents that suggested it', async () => {
    const upload = await parsedUpload();
    const { id, categoryId } = await suggestion([upload]);

    const listed = await call<CategorySuggestionDto[]>(
      'GET',
      `/category-suggestions?status=PENDING&uploadId=${upload}`,
    );
    expect(listed.body.map((item) => item.id)).toEqual([id]);

    const approved = await call<CategorySuggestionDto>(
      'POST',
      `/category-suggestions/${id}/approve`,
      { description: 'Bills and letters from Enel' },
    );
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      approvedCategoryId: categoryId,
    });
    const [category] = await db()
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.id, categoryId));
    expect(category).toMatchObject({
      description: 'Bills and letters from Enel',
      templateJson: {
        fields: [expect.objectContaining({ key: 'total_amount' })],
      },
    });
    const [row] = await db()
      .select()
      .from(uploads)
      .where(eq(uploads.id, upload));
    expect(row.categories).toEqual(['BILL', 'EXPENSE', categoryId]);

    const again = await call('POST', `/category-suggestions/${id}/approve`, {});
    expect(again.status).toBe(409);
    // The review inbox hears about it, with the new category's fields to fill in.
    expect(await lastSnapshot(upload)).toMatchObject({
      categories: ['BILL', 'EXPENSE', categoryId],
      suggestedCategories: [],
    });
    expect(row.extractedFields?.fields['total_amount'].categories).toEqual(
      expect.arrayContaining(['BILL', categoryId]),
    );
  });

  it('edits a document: title, description, categories and field values', async () => {
    const upload = await parsedUpload();
    const { status, body } = await call<UploadDto>(
      'PATCH',
      `/uploads/${upload}`,
      {
        title: 'Acqua Q3',
        description: '',
        categories: ['WATER_BILL', 'BILL'],
        fields: { total_amount: '12,50', currency: 'eur' },
      },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      title: 'Acqua Q3',
      description: null,
      categories: ['WATER_BILL', 'BILL'],
    });
    const fields = body.extractedFields!.fields;
    expect(fields['total_amount']).toMatchObject({
      value: 12.5,
      status: 'found',
      raw: '10',
      editedAt: expect.any(String),
    });
    expect(fields['currency']).toMatchObject({ value: 'EUR', status: 'found' });
    // WATER_BILL's template fields arrive as missing, for you to fill in.
    expect(fields['customer_id']).toMatchObject({
      status: 'missing',
      value: null,
      categories: expect.arrayContaining(['WATER_BILL']),
    });
    expect(body.extractedFields!.warnings).not.toContain(
      'Total amount: conflicting (10 / 12)',
    );
    expect(await lastSnapshot(upload)).toMatchObject({
      uploadId: upload,
      title: 'Acqua Q3',
      description: null,
      fileFormat: 'PDF',
      categories: ['WATER_BILL', 'BILL'],
    });

    // Clearing a value marks it missing again.
    const cleared = await call<UploadDto>('PATCH', `/uploads/${upload}`, {
      fields: { currency: null },
    });
    expect(cleared.body.extractedFields!.fields['currency']).toMatchObject({
      value: null,
      status: 'missing',
    });
  });

  it('refuses unknown categories, unknown fields and values that do not fit', async () => {
    const upload = await parsedUpload();
    for (const body of [
      { categories: ['NO_SUCH_CATEGORY'] },
      { fields: { no_such_field: '1' } },
      { fields: { total_amount: 'twelve' } },
    ]) {
      const response = await call<{ message: string }>(
        'PATCH',
        `/uploads/${upload}`,
        body,
      );
      expect(response.status).toBe(422);
    }
    expect(
      (await call('PATCH', `/uploads/${upload}`, { categories: ['lower'] }))
        .status,
    ).toBe(400);
  });

  it('creates a category and deletes it from every document', async () => {
    const upload = await parsedUpload();
    const id = `TEST_GAS_${randomUUID().slice(0, 8).toUpperCase()}`;
    categoryIds.push(id);
    const created = await call<CategoryDto>('POST', '/categories', {
      id,
      title: `Gas ${id}`,
      description: 'Gas bills',
      template: {
        fields: [{ key: 'gas_consumption', label: 'Gas used', type: 'number' }],
      },
    });
    expect(created.status).toBe(201);
    expect(
      (
        await call('POST', '/categories', {
          id,
          title: 'Other',
          description: 'x',
        })
      ).status,
    ).toBe(409);

    await call('PATCH', `/uploads/${upload}`, { categories: ['BILL', id] });
    const deleted = await call('DELETE', `/categories/${id}`);
    expect(deleted.status).toBe(204);
    const [row] = await db()
      .select()
      .from(uploads)
      .where(eq(uploads.id, upload));
    expect(row.categories).toEqual(['BILL']);
    expect(row.extractedFields?.fields['gas_consumption']).toBeUndefined();
    expect((await lastSnapshot(upload))?.categories).toEqual(['BILL']);
    expect((await call('DELETE', `/categories/${id}`)).status).toBe(404);
  });

  it('edits and deletes a suggestion, updating the documents it was suggested for', async () => {
    const upload = await parsedUpload();
    const { id } = await suggestion([upload]);
    const renamed = `TEST_RENAMED_${randomUUID().slice(0, 8).toUpperCase()}`;
    const edited = await call<CategorySuggestionDto>(
      'PATCH',
      `/category-suggestions/${id}`,
      { id: renamed, title: `Renamed ${renamed}` },
    );
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      categoryId: renamed,
      status: 'PENDING',
    });
    expect((await lastSnapshot(upload))?.suggestedCategories).toEqual([
      renamed,
    ]);
    expect(
      (await call('PATCH', `/category-suggestions/${id}`, { id: 'BILL' }))
        .status,
    ).toBe(409);

    await call('POST', `/category-suggestions/${id}/reject`);
    expect((await lastSnapshot(upload))?.suggestedCategories).toEqual([]);
    expect(
      (await call('PATCH', `/category-suggestions/${id}`, { title: 'Late' }))
        .status,
    ).toBe(409);
  });

  it('refuses an id that already exists and an invalid template', async () => {
    const { id } = await suggestion([]);
    expect(
      (
        await call('POST', `/category-suggestions/${id}/approve`, {
          id: 'BILL',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('POST', `/category-suggestions/${id}/approve`, {
          template: {
            fields: [{ key: 'Bad Key', label: 'x', type: 'string' }],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/category-suggestions/${id}/approve`, {
          id: 'lower',
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a suggestion without creating a category', async () => {
    const { id, categoryId } = await suggestion([]);
    const rejected = await call<CategorySuggestionDto>(
      'POST',
      `/category-suggestions/${id}/reject`,
    );
    expect(rejected.body.status).toBe('REJECTED');
    expect(
      await db()
        .select()
        .from(documentCategories)
        .where(eq(documentCategories.id, categoryId)),
    ).toEqual([]);
  });

  it('edits a category template', async () => {
    const { id, categoryId } = await suggestion([]);
    await call('POST', `/category-suggestions/${id}/approve`, {});
    const updated = await call<CategoryDto>(
      'PATCH',
      `/categories/${categoryId}`,
      {
        template: {
          fields: [
            {
              key: 'contract_number',
              label: 'Contract number',
              type: 'string',
            },
          ],
        },
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.template.fields).toEqual([
      {
        key: 'contract_number',
        label: 'Contract number',
        type: 'string',
        description: '',
        required: false,
      },
    ]);
  });

  it('reports the parse queue', async () => {
    const { status, body } = await call<ParseQueueDto>('GET', '/parse-queue');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: expect.any(String),
      pendingDocuments: expect.any(Number),
    });
  });
});
