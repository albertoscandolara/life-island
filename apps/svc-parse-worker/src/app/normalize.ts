import type { FileFormat } from '@life-island/contracts';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import sharp from 'sharp';

/** What the parser receives: an image, a PDF, or plain text, ready for the model. */
export type NormalizedDocument =
  | { kind: 'image'; mediaType: 'image/jpeg'; data: Buffer }
  | { kind: 'pdf'; data: Buffer }
  | { kind: 'text'; text: string };

const MAX_IMAGE_SIDE = 1600;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as {
      text?: string;
      result?: unknown;
      richText?: { text: string }[];
    };
    if (cell.richText) return cell.richText.map((part) => part.text).join('');
    if (cell.result !== undefined) return escapeCell(cell.result);
    if (cell.text !== undefined) return cell.text;
  }
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function spreadsheetToMarkdown(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(escapeCell));
    });
    if (rows.length === 0) return;
    const width = Math.max(...rows.map((row) => row.length));
    const line = (cells: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    sections.push(
      [
        `## Sheet: ${sheet.name}`,
        line(rows[0]),
        line(Array(width).fill('---')),
        ...rows.slice(1).map(line),
      ].join('\n'),
    );
  });
  return sections.join('\n\n');
}

/**
 * Turns a stored file into something the model reads well: photos are
 * auto-rotated and scaled down, PDFs go as documents, spreadsheets become
 * markdown tables and Word files plain text.
 */
export async function normalizeDocument(
  bytes: Buffer,
  format: FileFormat,
): Promise<NormalizedDocument> {
  switch (format) {
    case 'JPG':
    case 'PNG':
    case 'WEBP': {
      const data = await sharp(bytes)
        .rotate()
        .resize({
          width: MAX_IMAGE_SIDE,
          height: MAX_IMAGE_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { kind: 'image', mediaType: 'image/jpeg', data };
    }
    case 'PDF':
      return { kind: 'pdf', data: bytes };
    case 'XLSX':
      return { kind: 'text', text: await spreadsheetToMarkdown(bytes) };
    case 'DOCX':
      return {
        kind: 'text',
        text: (await mammoth.extractRawText({ buffer: bytes })).value,
      };
    case 'CSV':
    case 'TXT':
      return { kind: 'text', text: bytes.toString('utf8') };
  }
}
