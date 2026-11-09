import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  DocumentLinkDto,
  DocumentLinksDto,
  TransactionFacts,
} from '@life-island/contracts';
import { relinkDocuments, uploads } from '@life-island/ingestion-db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

const nobody = { name: null, vatNumber: null, taxCode: null, iban: null };

describe.skipIf(!configured)('invoice and payment links', () => {
  let app: INestApplication;
  let base: string;
  let svc: ServiceDb;
  const created: string[] = [];
  // A supplier of its own, so documents of other tests never compete.
  const vat = String(Math.floor(Math.random() * 1e11)).padStart(11, '7');
  const supplier = { ...nobody, name: `Fornitore ${vat}`, vatNumber: vat };

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
    if (created.length)
      await svc.db.delete(uploads).where(inArray(uploads.id, created));
    await svc?.close();
    await app?.close();
  });

  /** A PARSED document whose money facts the worker already read. */
  async function seed(facts: Partial<TransactionFacts>): Promise<string> {
    const id = randomUUID();
    await svc.db.insert(uploads).values({
      id,
      title: `${facts.role} ${id.slice(0, 8)}`,
      originalFilename: `${id}.pdf`,
      fileFormat: 'PDF',
      storageKey: `test/${id}.pdf`,
      status: 'PARSED',
      parsedAt: new Date(),
      transactionFacts: {
        role: 'INVOICE',
        documentKind: null,
        documentNumber: null,
        issueDate: null,
        dueDate: null,
        paymentDate: null,
        amount: null,
        fees: null,
        currency: 'EUR',
        counterparty: supplier,
        customer: nobody,
        references: [],
        paymentKind: null,
        description: null,
        subjects: [],
        ...facts,
      },
    });
    created.push(id);
    return id;
  }

  const relink = () =>
    withTransaction(svc.pool, (client) => relinkDocuments(client));

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
      body: (text ? JSON.parse(text) : null) as T,
    };
  }
  const linksOf = async (id: string) =>
    (await call<DocumentLinksDto>('GET', `/uploads/${id}/links`)).body;

  it('flags a payment two invoices could match, and settles it with your decisions', async () => {
    const january = await seed({
      documentNumber: 'A-1',
      issueDate: '2026-01-05',
      amount: 50,
    });
    const february = await seed({
      documentNumber: 'A-2',
      issueDate: '2026-02-05',
      amount: 50,
    });
    const payment = await seed({
      role: 'PAYMENT',
      paymentDate: '2026-01-25',
      amount: 50,
      counterparty: { ...supplier, vatNumber: null },
    });
    await relink();

    const before = await linksOf(payment);
    expect(before.facts).toMatchObject({ role: 'PAYMENT', amount: 50 });
    expect(
      before.links.map((l) => [l.invoiceUploadId, l.status]).sort(),
    ).toEqual(
      [
        [january, 'SUGGESTED'],
        [february, 'SUGGESTED'],
      ].sort(),
    );
    const waiting = await call<DocumentLinkDto[]>(
      'GET',
      '/document-links?status=SUGGESTED&limit=200',
    );
    expect(waiting.body.map((l) => l.paymentUploadId)).toContain(payment);

    // Not February's: the matcher now links January on its own.
    const toFebruary = before.links.find(
      (l) => l.invoiceUploadId === february,
    )!;
    const rejected = await call<DocumentLinkDto>(
      'POST',
      `/document-links/${toFebruary.id}/reject`,
    );
    expect(rejected.body).toMatchObject({ status: 'REJECTED' });
    const after = await linksOf(payment);
    expect(after.links).toEqual([
      expect.objectContaining({ invoiceUploadId: january, status: 'AUTO' }),
    ]);
    expect(after.linkedTotal).toBe(50);
    expect((await linksOf(january)).links[0].payment).toMatchObject({
      uploadId: payment,
      role: 'PAYMENT',
      amount: 50,
      date: '2026-01-25',
    });

    // February is offered again for linking by hand, best match first.
    const offered = await call<
      { document: { uploadId: string }; score: number }[]
    >('GET', `/uploads/${payment}/link-candidates`);
    expect(offered.body.map((c) => c.document.uploadId)).toContain(february);
    expect(offered.body.map((c) => c.document.uploadId)).not.toContain(january);

    // Forget the rejection: both compete again.
    await call('DELETE', `/document-links/${toFebruary.id}`);
    expect(
      (await linksOf(payment)).links.every((l) => l.status === 'SUGGESTED'),
    ).toBe(true);

    // You link it to February yourself: that is final, January's suggestion goes.
    const manual = await call<DocumentLinkDto>('POST', '/document-links', {
      invoiceUploadId: february,
      paymentUploadId: payment,
    });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({
      status: 'CONFIRMED',
      decidedAt: expect.any(String),
    });
    expect((await linksOf(payment)).links).toEqual([
      expect.objectContaining({
        invoiceUploadId: february,
        status: 'CONFIRMED',
      }),
    ]);
  });

  it('reads a document again from scratch: the matcher’s links go, yours stay', async () => {
    const invoice = await seed({
      documentNumber: 'B-77',
      amount: 1200,
      issueDate: '2026-04-01',
    });
    const payment = await seed({
      role: 'PAYMENT',
      amount: 1200,
      paymentDate: '2026-04-10',
      description: 'Saldo fattura B-77',
      counterparty: { ...supplier, vatNumber: null },
    });
    await relink();
    expect((await linksOf(payment)).links).toEqual([
      expect.objectContaining({ invoiceUploadId: invoice, status: 'AUTO' }),
    ]);

    const reparsed = await call<{ requeued: string[] }>(
      'POST',
      '/uploads/reparse',
      {
        uploadIds: [invoice],
      },
    );
    expect(reparsed.body.requeued).toEqual([invoice]);
    const links = await linksOf(payment);
    expect(links.links).toEqual([]);
    expect((await linksOf(invoice)).facts).toBeNull();
  });

  it('refuses a document linked to itself and documents that do not exist', async () => {
    const id = await seed({ amount: 10 });
    expect(
      (
        await call('POST', '/document-links', {
          invoiceUploadId: id,
          paymentUploadId: id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/document-links', {
          invoiceUploadId: id,
          paymentUploadId: randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect((await call('GET', `/uploads/${randomUUID()}/links`)).status).toBe(
      404,
    );
  });
});
