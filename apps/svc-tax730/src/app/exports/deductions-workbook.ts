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
 * and its payment proof are filed (ok/ko), and the total at the bottom. The
 * columns follow the commercialista's own sheet; the type comes last. Each
 * year also gets "Riepilogo {year}": the spending of every kind against its
 * cap, franchigia and rate, the instalments carried from earlier years and
 * the estimated tax back.
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
      // Not in the commercialista's own sheet, last so the rest lines up with it.
      { header: 'Tipologia', key: 'type', width: 30 },
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
        formula: last >= first ? `SUM(E${first}:E${last})` : '0',
        result: dossier.total,
      },
    });
    total.getCell('amount').font = { bold: true };
    total.getCell('description').value = 'Totale';
    total.getCell('description').font = { bold: true };
    total.getCell('description').alignment = { horizontal: 'right' };
    if (last >= first)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: last, column: 9 },
      };
    addSummarySheet(workbook, dossier);
  }
  if (!workbook.worksheets.length) workbook.addWorksheet('Detrazioni');
  return workbook;
}

const PERCENT = '0%';

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  dossier: TaxYearDossierDto,
): void {
  const sheet = workbook.addWorksheet(`Riepilogo ${dossier.taxYear}`, {
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  sheet.columns = [
    { key: 'type', width: 36 },
    { key: 'row', width: 20 },
    { key: 'count', width: 8 },
    { key: 'spent', width: 15, style: { numFmt: EURO } },
    { key: 'excluded', width: 15, style: { numFmt: EURO } },
    { key: 'cap', width: 15, style: { numFmt: EURO } },
    { key: 'franchigia', width: 12, style: { numFmt: EURO } },
    { key: 'eligible', width: 15, style: { numFmt: EURO } },
    { key: 'rate', width: 10, style: { numFmt: PERCENT } },
    { key: 'instalments', width: 8 },
    { key: 'total', width: 17, style: { numFmt: EURO } },
    { key: 'deduction', width: 17, style: { numFmt: EURO } },
  ];
  const title = sheet.getRow(1);
  title.getCell(1).value =
    `730/${dossier.filingYear}, spese ${dossier.taxYear}: stima delle detrazioni`;
  title.font = { bold: true, size: 13 };
  sheet.getRow(2).getCell(1).value =
    'Stima indicativa: aliquote e limiti per tipologia, prima casa per i bonus edilizi; da verificare con il commercialista.';
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF666666' } };
  const header = sheet.getRow(3);
  header.values = [
    'Tipologia',
    'Rigo 730',
    'Spese',
    'Speso',
    'Escluso (contanti)',
    'Limite',
    'Franchigia',
    'Ammesso',
    'Aliquota',
    'Rate',
    'Detrazione totale',
    'Detrazione nel 730',
  ];
  header.font = { bold: true };

  const { lines, carried } = dossier.deductions;
  for (const line of lines) {
    const row = sheet.addRow({
      type: line.labelIt,
      row: line.row730,
      count: line.expenseCount,
      spent: line.spent,
      excluded: line.excluded || null,
      cap:
        line.effectiveCap ??
        (line.capScope === 'intervention' ? 'per intervento' : 'nessuno'),
      franchigia: line.franchigia,
      eligible: line.eligible,
      rate: line.rate,
      instalments: line.instalments,
      total: line.totalDeduction,
      deduction: line.deduction,
    });
    if (line.overCap > 0)
      row.getCell('eligible').note =
        `Oltre il limite: ${line.overCap.toFixed(2)} €`;
  }
  for (const item of carried) {
    sheet.addRow({
      type: `${item.labelIt}: rata ${item.instalment}/${item.of} delle spese ${item.fromYear}`,
      instalments: item.of,
      deduction: item.amount,
    });
  }
  const totalRow = sheet.addRow({
    type: 'Totale stimato nel 730',
    deduction: dossier.deductions.thisYear,
  });
  totalRow.font = { bold: true };
  if (dossier.deductions.futureYears > 0) {
    sheet.addRow({
      type: 'Rate ancora da detrarre negli anni successivi',
      deduction: dossier.deductions.futureYears,
    });
  }
}
