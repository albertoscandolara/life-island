import type {
  DossierExpenseDto,
  TaxYearDossierDto,
} from '@life-island/contracts';
import { describe, expect, it } from 'vitest';
import { estimateDeductions } from '../deductions/deduction-estimate.js';
import { buildDeductionsWorkbook } from './deductions-workbook.js';

const expense = (
  overrides: Partial<DossierExpenseDto> = {},
): DossierExpenseDto => ({
  id: 'e1',
  sourceStagingId: 's1',
  uploadId: 'u1',
  taxYear: 2025,
  expenseType: 'renovation',
  frame730: null,
  date: '2025-07-01',
  amount: 1000,
  beneficiaryFiscalCode: null,
  traceablePayment: true,
  issuer: 'Impresa Edile Srl',
  documentNumber: '10/25',
  description: 'Rifacimento bagno',
  notes: null,
  attachments: [],
  hasInvoice: true,
  hasPaymentProof: false,
  ...overrides,
});

function dossier(expenses: DossierExpenseDto[]): TaxYearDossierDto {
  return {
    taxYear: 2025,
    filingYear: 2026,
    total: expenses.reduce((sum, e) => sum + e.amount, 0),
    expenseCount: expenses.length,
    byType: [],
    untraceableCount: 0,
    missingInvoiceCount: 0,
    missingPaymentCount: 0,
    deductions: estimateDeductions(2025, expenses),
    byMonth: Array(12).fill(0),
    expenses,
    yearDocuments: [],
  };
}

describe('buildDeductionsWorkbook', () => {
  it("lays out the year like the commercialista's sheet, with a summary next to it", () => {
    const workbook = buildDeductionsWorkbook([
      dossier([
        expense(),
        expense({
          id: 'e2',
          expenseType: 'medical',
          date: '2025-09-10',
          amount: 329.11,
          issuer: 'Studio Medico',
          documentNumber: null,
          hasPaymentProof: true,
        }),
      ]),
    ]);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Detrazioni 2025',
      'Riepilogo 2025',
    ]);

    const sheet = workbook.getWorksheet('Detrazioni 2025');
    if (!sheet) throw new Error('no sheet');
    expect(sheet.getRow(1).values).toEqual([
      undefined,
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
    const row = sheet.getRow(2);
    expect(row.getCell(2).value).toBe('10/25');
    expect(row.getCell(5).value).toBe(1000);
    expect(row.getCell(7).value).toBe('ko');
    expect(row.getCell(9).value).toBe('Ristrutturazione e bonus casa');
    expect(sheet.getRow(3).getCell(2).value).toBe('-');

    const summary = workbook.getWorksheet('Riepilogo 2025');
    if (!summary) throw new Error('no summary');
    const types = summary
      .getColumn(1)
      .values.filter((v): v is string => typeof v === 'string');
    expect(types).toContain('Spese sanitarie');
    expect(types).toContain('Ristrutturazione edilizia (bonus casa)');
    const total = summary.getRow(summary.rowCount - 1);
    expect(total.getCell(1).value).toBe('Totale stimato nel 730');
    // Renovation: 1000 * 50% / 10; health: (329.11 - 129.11) * 19%.
    expect(total.getCell(12).value).toBe(88);
  });
});
