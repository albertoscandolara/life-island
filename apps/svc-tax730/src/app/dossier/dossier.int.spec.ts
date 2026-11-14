import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  recordApprovedHandler,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  DossierExpenseDto,
  EventEnvelope,
  RecordApprovedV1,
  Tax730DocumentCandidateDto,
  TaxYearDossierDto,
  UploadUpdatedV1,
} from '@life-island/contracts';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { applyDocumentEvent } from '../documents/document-events.handler.js';
import { expenseLoader } from '../expenses/expense-loader.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['TAX730_DATABASE_URL'];

describe.skipIf(!configured)(
  '730 dossier (documents, attachments, zip and Excel)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let ingestion: Server;
    const taxYear = 2000 + Math.floor(Math.random() * 90);
    const handle = recordApprovedHandler('tax730', expenseLoader);
    const invoiceId = randomUUID();
    const transferId = randomUUID();
    const certificationId = randomUUID();
    const cuId = randomUUID();
    // Before any taxYear above, so the two tests never share a year.
    const cuYear = 1950 + Math.floor(Math.random() * 40);

    beforeAll(async () => {
      // Stands in for svc-ingestion: every file's bytes are its id.
      ingestion = createServer((request, response) => {
        const id = /\/uploads\/([^/]+)\//.exec(request.url ?? '')?.[1];
        response.setHeader('content-type', 'application/pdf');
        response.end(`file ${id}`);
      });
      await new Promise<void>((resolve) => ingestion.listen(0, resolve));
      const port = (ingestion.address() as AddressInfo).port;

      const config = {
        ...loadConfig(),
        port: 0,
        ingestionUrl: `http://localhost:${port}`,
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'tax730',
      });
    });

    afterAll(async () => {
      await svc?.pool.query(
        `delete from tax730.attachments where tax_year = $1`,
        [taxYear],
      );
      await svc?.pool.query(`delete from tax730.expenses where tax_year = $1`, [
        taxYear,
      ]);
      await svc?.pool.query(
        `delete from tax730.tax_years where tax_year = $1`,
        [taxYear],
      );
      await svc?.pool.query(
        `delete from tax730.documents where upload_id = any($1)`,
        [[invoiceId, transferId, certificationId, cuId]],
      );
      await svc?.close();
      await app?.close();
      ingestion?.close();
    });

    async function apply(
      type: string,
      payload: unknown,
      handler = applyDocumentEvent,
    ) {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      await processOnce(svc.pool, 'tax730', event.id, (client) =>
        handler(event, client),
      );
    }

    const uploaded = (
      uploadId: string,
      title: string,
      fields: UploadUpdatedV1['fields'],
      categories: string[] = [],
    ): UploadUpdatedV1 => ({
      uploadId,
      title,
      description: null,
      originalFilename: `${title}.pdf`,
      fileFormat: 'PDF',
      uploadedAt: new Date().toISOString(),
      categories,
      suggestedCategories: [],
      fields,
      updatedAt: new Date().toISOString(),
    });

    const json = async <T>(response: Response): Promise<T> => {
      expect(response.status).toBeLessThan(300);
      return (await response.json()) as T;
    };

    it('files an invoice, suggests and files its payment proof, then exports the year', async () => {
      await apply(
        'upload.updated@1',
        uploaded(invoiceId, 'Fattura notaio', {
          total_amount: 6500,
          issue_date: `${taxYear}-07-16`,
        }),
      );
      await apply(
        'upload.updated@1',
        uploaded(
          transferId,
          'Bonifico Chiliberti',
          { total_amount: 6500, execution_date: `${taxYear}-06-27` },
          ['BANK_TRANSFER'],
        ),
      );
      await apply(
        'upload.updated@1',
        uploaded(certificationId, 'Certificazione unica', {
          issue_date: `${taxYear + 1}-03-10`,
        }),
      );

      const record: RecordApprovedV1 = {
        recordId: randomUUID(),
        uploadId: invoiceId,
        category: 'tax730',
        targetKey: 'tax730.expense@1',
        payload: {
          taxYear,
          expenseType: 'other',
          date: `${taxYear}-06-27`,
          amount: 6500,
          issuer: 'Notaio Chiliberti Avv. Giuseppe',
          traceablePayment: true,
        },
        approvedAt: new Date().toISOString(),
      };
      await apply('record.approved@1', record, handle);

      let year = await json<TaxYearDossierDto>(
        await fetch(`${base}/tax-years/${taxYear}`),
      );
      expect(year).toMatchObject({
        filingYear: taxYear + 1,
        total: 6500,
        missingPaymentCount: 1,
        missingInvoiceCount: 0,
      });
      expect(year.byMonth[5]).toBe(6500);
      expect(year.deductions.lines).toEqual([
        expect.objectContaining({ group: 'other', spent: 6500, deduction: 0 }),
      ]);
      const [expense] = year.expenses;
      // Until you describe it, the invoice's title does.
      expect(expense.description).toBe('Fattura notaio');
      expect(expense.attachments.map((a) => a.role)).toEqual(['INVOICE']);

      const candidates = await json<Tax730DocumentCandidateDto[]>(
        await fetch(`${base}/documents?forExpense=${expense.id}`),
      );
      expect(candidates[0].uploadId).toBe(transferId);
      expect(candidates.some((c) => c.uploadId === invoiceId)).toBe(false);

      // Searched by its file name, with other separators: found, and shown as
      // the invoice it already is.
      const searched = await json<Tax730DocumentCandidateDto[]>(
        await fetch(
          `${base}/documents?forExpense=${expense.id}&search=${encodeURIComponent('fattura - NOTAIO.pdf')}`,
        ),
      );
      expect(searched.map((c) => [c.uploadId, c.filedAs])).toEqual([
        [invoiceId, 'INVOICE'],
      ]);

      const filed = await json<DossierExpenseDto>(
        await fetch(`${base}/expenses/${expense.id}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uploadId: transferId, role: 'PAYMENT' }),
        }),
      );
      expect(filed.hasPaymentProof).toBe(true);

      await json(
        await fetch(`${base}/expenses/${expense.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ description: 'Atto notarile prima casa' }),
        }),
      );
      year = await json<TaxYearDossierDto>(
        await fetch(`${base}/tax-years/${taxYear}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            uploadId: certificationId,
            role: 'CERTIFICATION',
          }),
        }),
      );
      expect(year.yearDocuments.map((d) => d.document?.title)).toEqual([
        'Certificazione unica',
      ]);
      expect(year.missingPaymentCount).toBe(0);

      const xlsx = await fetch(
        `${base}/exports/deductions.xlsx?year=${taxYear}`,
      );
      expect(xlsx.headers.get('content-disposition')).toContain(
        `Riepilogo detrazioni ${taxYear}.xlsx`,
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await xlsx.arrayBuffer());
      const row = workbook.getWorksheet(`Detrazioni ${taxYear}`)?.getRow(2)
        .values as unknown[];
      expect(row.slice(3)).toEqual([
        'Notaio Chiliberti Avv. Giuseppe',
        'Atto notarile prima casa',
        6500,
        'ok',
        'ok',
        undefined,
        'Altro',
      ]);
      const summary = workbook.getWorksheet(`Riepilogo ${taxYear}`);
      expect(summary?.getRow(3).getCell(1).value).toBe('Tipologia');

      const zipResponse = await fetch(
        `${base}/tax-years/${taxYear}/export.zip`,
      );
      expect(zipResponse.headers.get('content-type')).toBe('application/zip');
      const zip = await JSZip.loadAsync(await zipResponse.arrayBuffer());
      const root = `730 ${taxYear + 1} - redditi ${taxYear}`;
      const folder = `${root}/${taxYear}-06-27 - Notaio Chiliberti Avv. Giuseppe - Atto notarile prima casa`;
      expect(
        Object.keys(zip.files)
          .filter((name) => !name.endsWith('/'))
          .sort(),
      ).toEqual([
        `${folder}/${taxYear}-06-27 - Notaio Chiliberti Avv. Giuseppe - Atto notarile prima casa - Dettaglio bonifico.pdf`,
        `${folder}/${taxYear}-07-16 - Notaio Chiliberti Avv. Giuseppe - Atto notarile prima casa - Fattura.pdf`,
        `${root}/Certificazione unica.pdf`,
        `${root}/Riepilogo detrazioni ${taxYear}.xlsx`,
      ]);
      expect(
        await zip.file(`${root}/Certificazione unica.pdf`)?.async('string'),
      ).toBe(`file ${certificationId}`);
    });

    it('shows a Certificazione Unica among the documents of its year without filing it', async () => {
      await apply(
        'upload.updated@1',
        uploaded(
          cuId,
          `CU ${cuYear + 1}`,
          {
            employer: 'ACME S.R.L.',
            income_year: cuYear,
            employment_income: 27997.47,
            net_tax: 4464.29,
          },
          ['CERTIFICAZIONE_UNICA', 'WORK'],
        ),
      );
      const year = await json<TaxYearDossierDto>(
        await fetch(`${base}/tax-years/${cuYear}`),
      );
      expect(year.yearDocuments).toEqual([
        expect.objectContaining({
          uploadId: cuId,
          role: 'CERTIFICATION',
          automatic: true,
          document: expect.objectContaining({ title: `CU ${cuYear + 1}` }),
        }),
      ]);
      expect(year.deductions.income?.certificates).toHaveLength(1);
    });

    it('pairs an invoice with the transfers that paid it, so it is counted once', async () => {
      // Before cuYear, so no other test shares the year.
      const year = 1900 + Math.floor(Math.random() * 45);
      const docs = {
        invoice: randomUUID(),
        first: randomUUID(),
        firstDetail: randomUUID(),
        second: randomUUID(),
      };
      const approve = async (
        uploadId: string,
        title: string,
        date: string,
        amount: number,
        issuer: string,
      ) => {
        await apply('upload.updated@1', uploaded(uploadId, title, {}));
        await apply(
          'record.approved@1',
          {
            recordId: randomUUID(),
            uploadId,
            category: 'tax730',
            targetKey: 'tax730.expense@1',
            payload: {
              taxYear: year,
              expenseType: 'renovation',
              date: `${year}-${date}`,
              amount,
              issuer,
            },
            approvedAt: new Date().toISOString(),
          } satisfies RecordApprovedV1,
          handle,
        );
      };
      try {
        await approve(
          docs.invoice,
          '66 Edilrenso Fattura',
          '12-16',
          55000,
          'EDILRENSO SNC',
        );
        await approve(
          docs.first,
          '66 15K Edilrenso Ricevuta bonifico',
          '12-19',
          15000,
          'Banca Widiba',
        );
        await approve(
          docs.firstDetail,
          '66 15K Edilrenso Dettaglio bonifico',
          '12-19',
          15000,
          'Edilrenso',
        );
        await approve(
          docs.second,
          '66 40K Edilrenso Ricevuta bonifico',
          '12-22',
          40000,
          'Banca Widiba',
        );

        let dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/tax-years/${year}`),
        );
        expect(dossier).toMatchObject({
          total: 55000,
          expenseCount: 1,
          pairsToReviewCount: 1,
          missingPaymentCount: 0,
        });
        const [invoice] = dossier.expenses;
        expect(invoice).toMatchObject({
          kind: 'INVOICE',
          hasInvoice: true,
          hasPaymentProof: true,
          traceablePayment: true,
        });
        expect(
          invoice.paired.map((p) => [p.amount, p.kind, p.automatic]),
        ).toEqual([
          [15000, 'PAYMENT', true],
          [15000, 'PAYMENT', true],
          [40000, 'PAYMENT', true],
        ]);
        expect(invoice.attachments.map((a) => [a.uploadId, a.role])).toEqual([
          [docs.invoice, 'INVOICE'],
          [docs.first, 'PAYMENT'],
          [docs.firstDetail, 'PAYMENT'],
          [docs.second, 'PAYMENT'],
        ]);
        expect(dossier.deductions.lines[0]).toMatchObject({
          spent: 55000,
          overCap: 0,
        });

        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${invoice.id}/pairing/confirm`, {
            method: 'POST',
          }),
        );
        expect(dossier.pairsToReviewCount).toBe(0);
        expect(dossier.expenses[0].paired.every((p) => !p.automatic)).toBe(
          true,
        );

        // Not the same: the 40.000 € transfer is counted on its own again.
        const second = dossier.expenses[0].paired[2].id;
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${second}/pairing`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pairedWith: null }),
          }),
        );
        expect(dossier.total).toBe(95000);
        expect(dossier.expenses.find((e) => e.id === second)?.pairing).toBe(
          'SEPARATE',
        );

        // Paired by hand again.
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${second}/pairing`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pairedWith: invoice.id }),
          }),
        );
        expect(dossier.total).toBe(55000);
        expect(dossier.pairsToReviewCount).toBe(0);
      } finally {
        await svc.pool.query(
          `delete from tax730.attachments where tax_year = $1`,
          [year],
        );
        await svc.pool.query(
          `delete from tax730.expenses where tax_year = $1`,
          [year],
        );
        await svc.pool.query(
          `delete from tax730.tax_years where tax_year = $1`,
          [year],
        );
        await svc.pool.query(
          `delete from tax730.documents where upload_id = any($1)`,
          [Object.values(docs)],
        );
      }
    });

    it('keeps the newest snapshot of a document and remembers deletions', async () => {
      const id = randomUUID();
      const newer = uploaded(id, 'Newer title', {});
      const older = {
        ...uploaded(id, 'Older title', {}),
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      };
      await apply('upload.updated@1', newer);
      await apply('upload.updated@1', older);
      const { rows } = await svc.pool.query(
        `select title from tax730.documents where upload_id = $1`,
        [id],
      );
      expect(rows[0].title).toBe('Newer title');
      await apply('upload.deleted@1', {
        uploadId: id,
        deletedAt: new Date().toISOString(),
      });
      const docs = await json<Tax730DocumentCandidateDto[]>(
        await fetch(`${base}/documents?search=Newer`),
      );
      expect(docs).toEqual([]);
      await svc.pool.query(
        `delete from tax730.documents where upload_id = $1`,
        [id],
      );
    });
  },
);
