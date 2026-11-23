import {
  CAR_ARCHIVE_ACTION_LABELS,
  CAR_ARCHIVE_FOLDER_LABELS,
  CAR_ARCHIVE_RULES,
  CAR_ORIGINALS_ON_BOARD,
  LAID_UP_WARNING,
  type CarArchiveItemDto,
  type VehicleDto,
} from '@life-island/contracts';
import { EXCEL_TABLE_STYLE, excelMark } from '@life-island/be-common';
import ExcelJS from 'exceljs';

/** A date at midnight UTC, so Excel shows the same day everywhere. */
const day = (date: string | null) =>
  date ? new Date(`${date}T00:00:00Z`) : null;

const DATE = {
  numFmt: 'dd/mm/yyyy',
  alignment: { horizontal: 'left' },
} as const;
const CENTER = { alignment: { horizontal: 'center' } } as const;
const WRAP = { alignment: { wrapText: true, vertical: 'top' } } as const;

// The columns of "Documenti"; Excel tables need unique names.
const COLUMNS = [
  { name: 'Cartella', width: 20 },
  { name: 'Documento', width: 42, style: WRAP },
  { name: 'Data', width: 12, style: DATE },
  { name: 'Scadenza', width: 12, style: DATE },
  { name: 'In auto', width: 10, style: CENTER },
  { name: 'Da conservare', width: 15, style: CENTER },
  { name: 'Conservare fino al', width: 20, style: DATE },
  { name: 'Motivo', width: 70, style: WRAP },
] as const satisfies readonly {
  name: string;
  width: number;
  style?: Partial<ExcelJS.Style>;
}[];

function keepUntilCell(item: CarArchiveItemDto): Date | string {
  if (item.keepUntil) return day(item.keepUntil) as Date;
  if (item.action === 'discard') return '-';
  return "Finché hai l'auto";
}

/**
 * "Riepilogo documenti" of one car, styled like the 730's "Riepilogo
 * detrazioni": "Documenti", every document as an Excel table (folder, dates,
 * a green ✓ or red ✗ for in the car and to keep, until when and why), and
 * "In auto", the checklist of what has to be on board.
 */
export function buildCarDocumentsWorkbook(
  vehicle: Pick<VehicleDto, 'archive' | 'status'>,
  carName: string,
  today: string,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Life Island';
  workbook.created = new Date();
  addDocumentsSheet(workbook, vehicle.archive.items);
  addOnBoardSheet(
    workbook,
    vehicle.archive.items,
    carName,
    today,
    vehicle.status === 'laid_up',
  );
  return workbook;
}

function addDocumentsSheet(
  workbook: ExcelJS.Workbook,
  items: readonly CarArchiveItemDto[],
): void {
  const sheet = workbook.addWorksheet('Documenti', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  COLUMNS.forEach((column, i) => {
    sheet.getColumn(i + 1).width = column.width;
  });
  const rows = items.map((item) => [
    CAR_ARCHIVE_FOLDER_LABELS[item.folder].it,
    item.title,
    day(item.date),
    day(item.validUntil),
    excelMark(item.action === 'in_car').value,
    excelMark(item.action !== 'discard').value,
    keepUntilCell(item),
    CAR_ARCHIVE_RULES[item.rule].it,
  ]);
  sheet.addTable({
    name: 'Documenti',
    ref: 'A1',
    headerRow: true,
    style: EXCEL_TABLE_STYLE,
    columns: COLUMNS.map((column) => ({
      name: column.name,
      filterButton: true,
    })),
    // A table needs at least one data row.
    rows: rows.length ? rows : [COLUMNS.map(() => null)],
  });
  const dataRows = Math.max(rows.length, 1);
  COLUMNS.forEach((column, i) => {
    // Every cell at the top of its row: the reason wraps on several lines.
    for (let r = 2; r <= dataRows + 1; r++) {
      const cell = sheet.getRow(r).getCell(i + 1);
      const style: Partial<ExcelJS.Style> =
        'style' in column ? column.style : {};
      if (style.numFmt) cell.numFmt = style.numFmt;
      cell.alignment = { ...style.alignment, vertical: 'top' };
    }
  });
  items.forEach((item, i) => {
    const row = sheet.getRow(i + 2);
    row.getCell(5).font = excelMark(item.action === 'in_car').font;
    row.getCell(6).font = excelMark(item.action !== 'discard').font;
  });
}

/** "In auto": the originals and the printed pages, each with a box to tick. */
function addOnBoardSheet(
  workbook: ExcelJS.Workbook,
  items: readonly CarArchiveItemDto[],
  carName: string,
  today: string,
  laidUp: boolean,
): void {
  const sheet = workbook.addWorksheet('In auto');
  sheet.getColumn(1).width = 60;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 10;
  const title = sheet.getRow(1);
  title.getCell(1).value = `Documenti da tenere in auto: ${carName}`;
  title.font = { bold: true, size: 13 };
  sheet.getRow(2).getCell(1).value =
    `Aggiornato al ${today.split('-').reverse().join('/')}. Scarica "In auto", stampa solo i file cambiati e spunta ogni voce.`;
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF666666' } };
  if (laidUp) {
    sheet.getRow(3).getCell(1).value = `Auto ferma. ${LAID_UP_WARNING.it}`;
    sheet.getRow(3).font = { bold: true, color: { argb: 'FFC0392B' } };
  }

  const rows = [
    ...CAR_ORIGINALS_ON_BOARD.map((original) => [
      original.it,
      'Originale',
      null,
      '☐',
    ]),
    ...items
      .filter((item) => item.action === 'in_car' && item.printFiles.length)
      .map((item) => [
        item.title,
        `Stampa (${CAR_ARCHIVE_FOLDER_LABELS[item.folder].it.slice(5)})`,
        day(item.validUntil),
        '☐',
      ]),
  ];
  sheet.addTable({
    name: 'InAuto',
    ref: 'A5',
    headerRow: true,
    style: EXCEL_TABLE_STYLE,
    columns: [
      { name: 'Documento', filterButton: false },
      { name: 'Come', filterButton: false },
      { name: 'Scadenza', filterButton: false },
      { name: 'Fatto', filterButton: false },
    ],
    rows,
  });
  for (let r = 6; r < 6 + rows.length; r++) {
    sheet.getRow(r).getCell(3).numFmt = 'dd/mm/yyyy';
    sheet.getRow(r).getCell(4).alignment = { horizontal: 'center' };
  }
  const note = sheet.getRow(7 + rows.length);
  note.getCell(1).value =
    `Il bollo non va tenuto in auto: conserva le ricevute a casa (${CAR_ARCHIVE_ACTION_LABELS.keep.it.toLowerCase()} nel foglio Documenti).`;
  note.font = { italic: true, color: { argb: 'FF666666' } };
}
