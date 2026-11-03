import {
  TAX730_EXPENSE_TYPE_LABELS,
  type Tax730ExpenseType,
  type TaxYearDossierDto,
} from '@life-island/contracts';
import ExcelJS from 'exceljs';

const EURO = '#,##0.00 [$€-410]';

/**
 * The commercialista's summary ("Riepilogo detrazioni"): one sheet per tax
 * year, oldest first, one row per deductible expense with whether its invoice
 * and its payment proof are filed (ok/ko), and the total at the bottom.
 */
export function buildDeductionsWorkbook(
  dossiers: TaxYearDossierDto[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Life Island';
  workbook.created = new Date();
  for (const dossier of [...dossiers].sort((a, b) => a.taxYear - b.taxYear)) {
    const sheet = workbook.addWorksheet(`Detrazioni ${dossier.taxYear}`, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      {
        header: 'Data',
        key: 'date',
        width: 12,
        style: { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'left' } },
      },
      {
        header: 'Fattura',
        key: 'number',
        width: 14,
        style: { numFmt: '@', alignment: { horizontal: 'left' } },
      },
      { header: 'Fornitore', key: 'issuer', width: 28 },
      {
        header: 'Descrizione',
        key: 'description',
        width: 60,
        style: { alignment: { wrapText: true, vertical: 'top' } },
      },
      { header: 'Tipologia', key: 'type', width: 26 },
      { header: 'Importo', key: 'amount', width: 16, style: { numFmt: EURO } },
      {
        header: 'Fattura',
        key: 'invoice',
        width: 10,
        style: { alignment: { horizontal: 'center' } },
      },
      {
        header: 'Dettaglio bonifico',
        key: 'payment',
        width: 18,
        style: { alignment: { horizontal: 'center' } },
      },
      {
        header: 'Note',
        key: 'notes',
        width: 40,
        style: { alignment: { wrapText: true, vertical: 'top' } },
      },
    ];
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { horizontal: 'left' };

    for (const expense of dossier.expenses) {
      const row = sheet.addRow({
        // A date at midnight UTC, so Excel shows the same day everywhere.
        date: new Date(`${expense.date}T00:00:00Z`),
        number: expense.documentNumber ?? '-',
        issuer: expense.issuer,
        description: expense.description ?? null,
        type:
          TAX730_EXPENSE_TYPE_LABELS[expense.expenseType as Tax730ExpenseType]
            ?.it ?? expense.expenseType,
        amount: expense.amount,
        invoice: expense.hasInvoice ? 'ok' : 'ko',
        payment: expense.hasPaymentProof ? 'ok' : 'ko',
        notes: expense.notes ?? null,
      });
      for (const key of ['invoice', 'payment']) {
        const cell = row.getCell(key);
        if (cell.value === 'ko')
          cell.font = { bold: true, color: { argb: 'FFC0392B' } };
      }
    }

    const first = 2;
    const last = sheet.rowCount;
    const total = sheet.addRow({
      amount: {
        formula: last >= first ? `SUM(F${first}:F${last})` : '0',
        result: dossier.total,
      },
    });
    total.getCell('amount').font = { bold: true };
    total.getCell('type').value = 'Totale';
    total.getCell('type').font = { bold: true };
    if (last >= first)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: last, column: 9 },
      };
  }
  if (!workbook.worksheets.length) workbook.addWorksheet('Detrazioni');
  return workbook;
}
