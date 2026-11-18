import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  paymentEventHandler,
  processOnce,
  recordApprovedHandler,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  DeadlineDto,
  DossierExpenseDto,
  EventEnvelope,
  PayableDto,
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
    const returnId = randomUUID();
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
        [[invoiceId, transferId, certificationId, cuId, returnId]],
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

    it('reads the return of the year: certain figures, compared with the forecast, deadline done', async () => {
      await apply(
        'upload.updated@1',
        uploaded(
          returnId,
          `Redditi PF ${cuYear + 1}`,
          {
            form_type: 'redditi_pf',
            tax_year: cuYear,
            filed_on: `${cuYear + 1}-09-11`,
            total_income: 27997,
            taxable_income: 27997,
            irpef_withheld: 4464,
            net_tax: 4868,
            irpef_due: 404,
          },
          ['TAX_RETURN'],
        ),
      );
      const year = await json<TaxYearDossierDto>(
        await fetch(`${base}/tax-years/${cuYear}`),
      );
      expect(year.taxReturn).toMatchObject({
        form: 'redditi_pf',
        status: 'filed',
        filed: { uploadId: returnId, irpefDue: 404, result: 404 },
      });
      // The CU of the year (the test above) gives the forecast to compare.
      expect(
        year.taxReturn.comparison?.lines.find((l) => l.key === 'income'),
      ).toMatchObject({ filed: 27997, forecast: 27997.47, matches: true });
      expect(year.yearDocuments).toContainEqual(
        expect.objectContaining({
          uploadId: returnId,
          role: 'RETURN',
          automatic: true,
        }),
      );

      const deadlines = await json<DeadlineDto[]>(
        await fetch(
          `${base}/deadlines?from=${cuYear + 1}-01-01&to=${cuYear + 2}-12-31`,
        ),
      );
      expect(deadlines.find((d) => d.id === `return-${cuYear}`)).toMatchObject({
        done: true,
        kind: 'tax-return',
      });
      expect(
        deadlines.find((d) => d.id === `return-${cuYear + 1}`),
      ).toMatchObject({ title: `Redditi PF deadline (${cuYear + 1} income)` });
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

        // The invoice taken out of its expense is found and free to file again.
        await fetch(
          `${base}/expenses/${invoice.id}/attachments/${docs.invoice}`,
          { method: 'DELETE' },
        );
        const found = await json<Tax730DocumentCandidateDto[]>(
          await fetch(
            `${base}/documents?forExpense=${invoice.id}&search=${encodeURIComponent('66 - Edilrenso - Fattura.pdf')}`,
          ),
        );
        expect(found.map((c) => [c.uploadId, c.filedAs])).toContainEqual([
          docs.invoice,
          null,
        ]);

        // Filed back as its invoice, whose description says how to pay it:
        // still shown as its invoice.
        await apply('upload.updated@1', {
          ...uploaded(docs.invoice, '66 Edilrenso Fattura', {}),
          description: 'Fattura n. 66, da pagare con bonifico',
        });
        await json(
          await fetch(`${base}/expenses/${invoice.id}/attachments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uploadId: docs.invoice, role: 'INVOICE' }),
          }),
        );
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/tax-years/${year}`),
        );
        expect(
          dossier.expenses[0].attachments.find(
            (a) => a.uploadId === docs.invoice,
          )?.role,
        ).toBe('INVOICE');

        // Removed: its payments count on their own again.
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${invoice.id}`, { method: 'DELETE' }),
        );
        expect(dossier.expenses.map((e) => e.amount)).toEqual([15000, 40000]);
        expect(dossier.expenses.every((e) => e.pairing === null)).toBe(true);

        // A bank receipt is not who was paid: its transfer's other receipt
        // names the supplier, and so does an invoice filed with it.
        expect(dossier.expenses.map((e) => e.issuer)).toEqual([
          'Edilrenso',
          'Banca Widiba',
        ]);
        const transfer = dossier.expenses[1];
        await apply(
          'upload.updated@1',
          uploaded(docs.invoice, '66 Edilrenso Fattura', {
            issuer: 'EDILRENSO SNC',
          }),
        );
        const withInvoice = await json<DossierExpenseDto>(
          await fetch(`${base}/expenses/${transfer.id}/attachments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uploadId: docs.invoice, role: 'INVOICE' }),
          }),
        );
        expect(withInvoice.issuer).toBe('EDILRENSO SNC');

        // Every field can be corrected.
        const patch = (body: unknown) =>
          fetch(`${base}/expenses/${transfer.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        const edited = await json<DossierExpenseDto>(
          await patch({
            issuer: 'Edilrenso',
            documentNumber: '66',
            date: `${year}-12-23`,
            amount: 40000.5,
            expenseType: 'energy_efficiency',
            frame730: 'E1 - rigo E8-E10 codice 9',
            traceablePayment: false,
            beneficiaryFiscalCode: 'rssmra 80a01 h501u',
          }),
        );
        expect(edited).toMatchObject({
          issuer: 'Edilrenso',
          documentNumber: '66',
          date: `${year}-12-23`,
          amount: 40000.5,
          expenseType: 'energy_efficiency',
          frame730: 'E1 - rigo E8-E10 codice 9',
          traceablePayment: false,
          beneficiaryFiscalCode: 'RSSMRA80A01H501U',
        });
        expect((await patch({ date: `${year + 1}-01-02` })).status).toBe(400);
        expect((await patch({ beneficiaryFiscalCode: 'ABC' })).status).toBe(
          400,
        );
        expect((await patch({ amount: 0 })).status).toBe(400);
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

    it('shows one transfer that paid several invoices with each of them', async () => {
      // Before every other test's years, so none shares it.
      const year = 1800 + Math.floor(Math.random() * 90);
      const docs = {
        fridge: randomUUID(),
        washer: randomUUID(),
        transfer: randomUUID(),
        oven: randomUUID(),
        ovenTransfer: randomUUID(),
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
              expenseType: 'furniture',
              date: `${year}-${date}`,
              amount,
              issuer,
            },
            approvedAt: new Date().toISOString(),
          } satisfies RecordApprovedV1,
          handle,
        );
      };
      const LESO = 'LESO ELETTRODOMESTICI S.R.L.';
      try {
        await approve(
          docs.fridge,
          '0117 000319 LESO Frigo Ponzilovo Fattura',
          '05-06',
          550,
          LESO,
        );
        await approve(
          docs.washer,
          '0117 000292 LESO Lavatrice Ponzilovo Fattura',
          '05-25',
          304,
          LESO,
        );
        // The transfer is an archived document, not an expense: you file it
        // with the washer, and the fridge is offered it too.
        await apply(
          'upload.updated@1',
          uploaded(docs.transfer, 'LESO Lavatrice e Frigo Ponzilovo', {
            total_amount: 854,
          }),
        );
        let dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/tax-years/${year}`),
        );
        const [fridge, washer] = dossier.expenses;
        await json(
          await fetch(`${base}/expenses/${washer.id}/attachments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uploadId: docs.transfer, role: 'PAYMENT' }),
          }),
        );
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/tax-years/${year}`),
        );
        expect(dossier).toMatchObject({
          total: 854,
          expenseCount: 2,
          missingPaymentCount: 0,
          pairsToReviewCount: 1,
        });
        const shownWithFridge = dossier.expenses[0].attachments.find(
          (a) => a.uploadId === docs.transfer,
        );
        expect(shownWithFridge).toMatchObject({
          role: 'PAYMENT',
          automatic: true,
        });
        expect(shownWithFridge?.paysToo?.map((e) => e.id)).toEqual([washer.id]);
        expect(
          dossier.expenses[1].paidTogetherWith.map((e) => e.amount),
        ).toEqual([550]);

        // Confirmed: it is filed with the fridge too.
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${fridge.id}/pairing/confirm`, {
            method: 'POST',
          }),
        );
        expect(dossier.pairsToReviewCount).toBe(0);
        const filedWithFridge = dossier.expenses[0].attachments.find(
          (a) => a.uploadId === docs.transfer,
        );
        expect(filedWithFridge?.automatic).toBeUndefined();
        expect(filedWithFridge?.paysToo?.map((e) => e.id)).toEqual([washer.id]);

        // A bank receipt read as an expense: paired with both invoices it
        // adds up to, counted through them only.
        await approve(
          docs.oven,
          '0117 000256 LESO Forno induzione Fattura',
          '06-14',
          400,
          LESO,
        );
        await approve(
          docs.ovenTransfer,
          'LESO Forno e Lavastoviglie Bonifico',
          '06-15',
          900,
          'Banca Widiba',
        );
        const dishwasher = randomUUID();
        Object.assign(docs, { dishwasher });
        await approve(
          dishwasher,
          '0117 000257 LESO Lavastoviglie Fattura',
          '06-14',
          500,
          LESO,
        );
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/tax-years/${year}`),
        );
        expect(dossier.total).toBe(1754);
        const oven = dossier.expenses.find((e) => e.amount === 400)!;
        const dish = dossier.expenses.find((e) => e.amount === 500)!;
        expect(oven.hasPaymentProof && dish.hasPaymentProof).toBe(true);
        expect(oven.paired.map((p) => p.amount)).toEqual([900]);
        expect(oven.paired[0].paysToo.map((e) => e.id)).toEqual([dish.id]);
        expect(dish.paidTogetherWith.map((e) => e.id)).toEqual([oven.id]);

        // Confirming it from one invoice keeps it paying the other.
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${dish.id}/pairing/confirm`, {
            method: 'POST',
          }),
        );
        const confirmed = dossier.expenses.find((e) => e.id === oven.id)!;
        expect(confirmed.paired.map((p) => [p.amount, p.automatic])).toEqual([
          [900, false],
        ]);
        expect(dossier.total).toBe(1754);
        expect(dossier.pairsToReviewCount).toBe(0);

        // The dishwasher removed: the transfer still pays the oven.
        dossier = await json<TaxYearDossierDto>(
          await fetch(`${base}/expenses/${dish.id}`, { method: 'DELETE' }),
        );
        const left = dossier.expenses.find((e) => e.id === oven.id)!;
        expect(left.paired.map((p) => [p.amount, p.automatic])).toEqual([
          [900, false],
        ]);
        expect(left.paired[0].paysToo).toEqual([]);
        expect(dossier.total).toBe(1254);
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

    it('lists its expenses for Money; a matched bank payment makes one traceable, the receipt still asked', async () => {
      const year = 1900 + Math.floor(Math.random() * 40);
      const uploadId = randomUUID();
      await apply(
        'upload.updated@1',
        uploaded(uploadId, 'Fattura dentista', {
          total_amount: 350,
          issue_date: `${year}-06-01`,
        }),
      );
      await apply(
        'record.approved@1',
        {
          recordId: randomUUID(),
          uploadId,
          category: 'tax730',
          targetKey: 'tax730.expense@1',
          payload: {
            taxYear: year,
            expenseType: 'medical',
            date: `${year}-06-01`,
            amount: 350,
            issuer: 'Studio Dentistico Rossi',
          },
          approvedAt: new Date().toISOString(),
        } satisfies RecordApprovedV1,
        handle,
      );
      try {
        const payables = await json<PayableDto[]>(
          await fetch(`${base}/payables?from=${year}-06-05&to=${year}-06-05`),
        );
        const [mine] = payables.filter((p) =>
          p.payees.includes('Studio Dentistico Rossi'),
        );
        expect(mine).toMatchObject({
          module: 'taxes',
          kind: 'expense',
          amount: 350,
          direction: 'out',
          date: `${year}-06-01`,
          window: { from: `${year}-05-02`, to: `${year}-08-30` },
          path: '/taxes/730',
        });
        expect(mine.key).toMatch(/^taxes:expense:[0-9a-f-]{36}$/);

        const expenseOf = async () =>
          (
            await json<TaxYearDossierDto>(
              await fetch(`${base}/tax-years/${year}`),
            )
          ).expenses[0];
        expect(await expenseOf()).toMatchObject({
          bankPayment: null,
          hasPaymentProof: false,
        });

        const deliver = (type: string, payload: unknown) =>
          apply(type, payload, paymentEventHandler('tax730', 'taxes'));
        const linkId = randomUUID();
        await deliver('money.payment_linked@1', {
          linkId,
          payableKey: mine.key,
          module: 'taxes',
          movementId: randomUUID(),
          date: `${year}-06-05`,
          amount: 350,
          accountName: 'Conto corrente',
          description: 'BONIFICO A FAVORE DI STUDIO DENTISTICO ROSSI',
          linkedAt: new Date().toISOString(),
        });
        // Paid traceably, from the bank; the payment proof is still asked for.
        expect(await expenseOf()).toMatchObject({
          traceablePayment: true,
          hasPaymentProof: false,
          bankPayment: {
            paid: 350,
            full: true,
            lastDate: `${year}-06-05`,
            accounts: ['Conto corrente'],
          },
        });

        await deliver('money.payment_unlinked@1', {
          linkId,
          payableKey: mine.key,
          module: 'taxes',
          reason: 'undone',
          unlinkedAt: new Date().toISOString(),
        });
        expect((await expenseOf()).bankPayment).toBeNull();
      } finally {
        await svc.pool.query(
          `delete from tax730.payments where payable_key in
             (select 'taxes:expense:' || id from tax730.expenses where tax_year = $1)`,
          [year],
        );
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
          `delete from tax730.documents where upload_id = $1`,
          [uploadId],
        );
      }
    });
  },
);
