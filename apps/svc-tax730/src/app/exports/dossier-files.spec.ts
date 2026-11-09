import type {
  DossierExpenseDto,
  Tax730DocumentDto,
  TaxYearDossierDto,
} from '@life-island/contracts';
import ExcelJS from 'exceljs';
import { buildDeductionsWorkbook } from './deductions-workbook.js';
import {
  dossierFiles,
  dossierRoot,
  expenseFolder,
  safeName,
} from './dossier-files.js';

const doc = (
  overrides: Partial<Tax730DocumentDto> = {},
): Tax730DocumentDto => ({
  uploadId: crypto.randomUUID(),
  title: 'Fattura',
  originalFilename: 'scan.PDF',
  fileFormat: 'PDF',
  categories: [],
  date: null,
  amount: null,
  uploadedAt: '2026-02-06T19:15:00.000Z',
  deleted: false,
  ...overrides,
});

const expense = (
  overrides: Partial<DossierExpenseDto> = {},
): DossierExpenseDto => ({
  id: crypto.randomUUID(),
  sourceStagingId: crypto.randomUUID(),
  uploadId: crypto.randomUUID(),
  taxYear: 2025,
  expenseType: 'renovation',
  frame730: null,
  date: '2025-07-01',
  amount: 3200,
  beneficiaryFiscalCode: null,
  traceablePayment: true,
  issuer: 'Unitycasa di Romio Eddy',
  documentNumber: '10/25',
  description: 'Compenso mediazione prima casa',
  notes: null,
  attachments: [],
  hasInvoice: false,
  hasPaymentProof: false,
  ...overrides,
});

const dossier = (expenses: DossierExpenseDto[]): TaxYearDossierDto => ({
  taxYear: 2025,
  filingYear: 2026,
  total: expenses.reduce((sum, e) => sum + e.amount, 0),
  expenseCount: expenses.length,
  byType: [],
  untraceableCount: 0,
  missingInvoiceCount: 0,
  missingPaymentCount: 0,
  deductions: {
    lines: [],
    carried: [],
    thisYear: 0,
    futureYears: 0,
    income: null,
  },
  byMonth: Array(12).fill(0),
  expenses,
  yearDocuments: [],
});

describe('the commercialista folder', () => {
  it('names a folder per expense like "date - number - supplier - description"', () => {
    expect(expenseFolder(expense())).toBe(
      '2025-07-01 - 10-25 - Unitycasa di Romio Eddy - Compenso mediazione prima casa',
    );
    expect(
      expenseFolder(expense({ documentNumber: null, description: null })),
    ).toBe('2025-07-01 - Unitycasa di Romio Eddy');
  });

  it('puts the invoice and the payment proof in the folder, each with its own date', () => {
    const invoice = doc({ date: '2025-07-16' });
    const payment = doc({ originalFilename: 'bonifico.pdf' });
    const result = dossierFiles(
      dossier([
        expense({
          hasInvoice: true,
          hasPaymentProof: true,
          attachments: [
            { uploadId: invoice.uploadId, role: 'INVOICE', document: invoice },
            { uploadId: payment.uploadId, role: 'PAYMENT', document: payment },
          ],
        }),
      ]),
      '730 2026 - redditi 2025',
    );
    const folder =
      '730 2026 - redditi 2025/2025-07-01 - 10-25 - Unitycasa di Romio Eddy - Compenso mediazione prima casa';
    expect(result.files.map((file) => file.path)).toEqual([
      `${folder}/2025-07-16 - Unitycasa di Romio Eddy - Compenso mediazione prima casa - Fattura.pdf`,
      `${folder}/2026-02-06 - Unitycasa di Romio Eddy - Compenso mediazione prima casa - Dettaglio bonifico.pdf`,
    ]);
    expect(result.missing).toEqual([]);
  });

  it('lists what is missing and keeps names unique', () => {
    const cu = doc({ title: 'Certificazione unica' });
    const cu2 = doc({ title: 'Certificazione unica' });
    const data = dossier([expense()]);
    data.yearDocuments = [
      { uploadId: cu.uploadId, role: 'CERTIFICATION', document: cu },
      { uploadId: cu2.uploadId, role: 'CERTIFICATION', document: cu2 },
    ];
    const result = dossierFiles(data, dossierRoot(data));
    expect(result.files.map((file) => file.path)).toEqual([
      '730 2026 - redditi 2025/Certificazione unica.pdf',
      '730 2026 - redditi 2025/Certificazione unica (2).pdf',
    ]);
    expect(result.missing).toHaveLength(2);
  });

  it('makes names safe for every file system', () => {
    expect(safeName('a/b\\c: "d"? <e>|*  ')).toBe('a-b-c d e');
    expect(safeName('...')).toBe('documento');
  });
});

describe('the Riepilogo detrazioni workbook', () => {
  it('has one sheet per year with ok/ko columns and a SUM row', async () => {
    const workbook = buildDeductionsWorkbook([
      dossier([
        expense({ hasInvoice: true, hasPaymentProof: true }),
        expense({ amount: 550, hasInvoice: true, notes: 'In arrivo' }),
      ]),
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer);
    const sheet = read.getWorksheet('Detrazioni 2025');
    expect(sheet).toBeDefined();
    const values = (row: number) =>
      (sheet?.getRow(row).values as unknown[]).slice(1);
    expect(values(1)).toEqual([
      'Data',
      'Fattura',
      'Fornitore',
      'Descrizione',
      'Importo',
      'Fattura',
      'Dettaglio bonifico',
      'Note',
      'Tipologia',
    ]);
    expect(values(3).slice(4, 8)).toEqual([550, 'ok', 'ko', 'In arrivo']);
    expect(sheet?.getCell('E4').value).toEqual({
      formula: 'SUM(E2:E3)',
      result: 3750,
    });
  });
});
