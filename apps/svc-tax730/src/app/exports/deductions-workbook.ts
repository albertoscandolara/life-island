import {
  TAX730_EXPENSE_TYPE_LABELS,
  type Tax730ExpenseType,
  type TaxYearDossierDto,
} from '@life-island/contracts';
import ExcelJS from 'exceljs';

const EURO = '#,##0.00 [$€-410]';

// Whether the invoice / payment proof is filed: a green tick or a red cross.
const FILED = { value: '✓', font: { bold: true, color: { argb: 'FF1E8449' } } };
const MISSING = {
  value: '✗',
  font: { bold: true, color: { argb: 'FFC0392B' } },
};

/**
 * The commercialista's summary ("Riepilogo detrazioni"): one sheet per tax
 * year, oldest first, one row per deductible expense with whether its invoice
 * and its payment proof are filed (a green ✓ or a red ✗), and the total at
 * the bottom, as an Excel table styled like the commercialista's own. Each
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
    addExpensesSheet(workbook, dossier);
    addSummarySheet(workbook, dossier);
  }
  if (!workbook.worksheets.length) workbook.addWorksheet('Detrazioni');
  return workbook;
}

// The columns of the commercialista's own sheet; the type comes last so the
// rest lines up with it. An Excel table needs unique column names, so the
// document number is "N. fattura" and "Fattura" says whether it is filed.
const EXPENSE_COLUMNS = [
  {
    name: 'Data',
    width: 12,
    style: { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'left' } },
  },
  {
    name: 'N. fattura',
    width: 14,
    style: { numFmt: '@', alignment: { horizontal: 'left' } },
  },
  { name: 'Fornitore', width: 28 },
  {
    name: 'Descrizione',
    width: 60,
    style: { alignment: { wrapText: true, vertical: 'top' } },
  },
  { name: 'Importo', width: 16, style: { numFmt: EURO } },
  {
    name: 'Fattura',
    width: 10,
    style: { alignment: { horizontal: 'center' } },
  },
  {
    name: 'Dettaglio bonifico',
    width: 18,
    style: { alignment: { horizontal: 'center' } },
  },
  {
    name: 'Note',
    width: 40,
    style: { alignment: { wrapText: true, vertical: 'top' } },
  },
  { name: 'Tipologia', width: 30 },
] as const satisfies readonly {
  name: string;
  width: number;
  style?: Partial<ExcelJS.Style>;
}[];

/**
 * "Detrazioni {year}": the expenses as an Excel table in the commercialista's
 * style (blue header, banded rows, filters, a totals row summing Importo).
 */
function addExpensesSheet(
  workbook: ExcelJS.Workbook,
  dossier: TaxYearDossierDto,
): void {
  const sheet = workbook.addWorksheet(`Detrazioni ${dossier.taxYear}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  EXPENSE_COLUMNS.forEach((column, i) => {
    sheet.getColumn(i + 1).width = column.width;
  });
  const rows = dossier.expenses.map((expense) => [
    // A date at midnight UTC, so Excel shows the same day everywhere.
    new Date(`${expense.date}T00:00:00Z`),
    expense.documentNumber ?? '-',
    expense.issuer,
    expense.description ?? null,
    expense.amount,
    (expense.hasInvoice ? FILED : MISSING).value,
    (expense.hasPaymentProof ? FILED : MISSING).value,
    expense.notes ?? null,
    TAX730_EXPENSE_TYPE_LABELS[expense.expenseType as Tax730ExpenseType]?.it ??
      expense.expenseType,
  ]);
  sheet.addTable({
    name: `Detrazioni${dossier.taxYear}`,
    ref: 'A1',
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: EXPENSE_COLUMNS.map((column) => ({
      name: column.name,
      filterButton: true,
      // ExcelJS writes only the first column's label into the cell: Data has
      // none and "Totale" is filled in under Descrizione below.
      totalsRowLabel:
        column.name === 'Data'
          ? ''
          : column.name === 'Descrizione'
            ? 'Totale'
            : undefined,
      // SUBTOTAL(109, …): the total follows the rows left by the filters.
      ...(column.name === 'Importo'
        ? { totalsRowFunction: 'sum' as const, totalsRowResult: dossier.total }
        : {}),
    })),
    // A table needs at least one data row.
    rows: rows.length ? rows : [EXPENSE_COLUMNS.map(() => null)],
  });

  // Formats for the data rows and the totals row (the header keeps the table's).
  const dataRows = Math.max(rows.length, 1);
  EXPENSE_COLUMNS.forEach((column, i) => {
    if (!('style' in column)) return;
    for (let r = 2; r <= dataRows + 2; r++) {
      const cell = sheet.getRow(r).getCell(i + 1);
      if ('numFmt' in column.style) cell.numFmt = column.style.numFmt;
      if ('alignment' in column.style) cell.alignment = column.style.alignment;
    }
  });
  dossier.expenses.forEach((expense, i) => {
    const row = sheet.getRow(i + 2);
    row.getCell(6).font = (expense.hasInvoice ? FILED : MISSING).font;
    row.getCell(7).font = (expense.hasPaymentProof ? FILED : MISSING).font;
  });
  const total = sheet.getRow(dataRows + 2);
  total.font = { bold: true };
  total.getCell(4).value = 'Totale';
  total.getCell(4).alignment = { horizontal: 'right' };
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
