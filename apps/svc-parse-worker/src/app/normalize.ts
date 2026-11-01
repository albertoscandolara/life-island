import type { FileFormat } from '@life-island/contracts';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { getDocumentProxy } from 'unpdf';

/** What the parser receives: an image, a PDF, or plain text, ready for the model. */
export type NormalizedDocument =
  | { kind: 'image'; mediaType: 'image/jpeg'; data: Buffer }
  /** `text` is the PDF's text layer, line by line; empty for a scan. */
  | { kind: 'pdf'; data: Buffer; text: string }
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

interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Rebuilds the lines of a page from positioned text: items whose baselines
 * are within half a point belong to one line, read left to right. Forms such
 * as payslips print each value in its own box, so reading in drawing order
 * would separate a label from its value.
 */
export function linesFromItems(items: PositionedText[]): string[] {
  const rows: { y: number; items: PositionedText[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 0.5);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let end = -Infinity;
      for (const item of sorted) {
        if (line && item.x - end > 1) line += '  ';
        line += item.str;
        end = item.x + item.width;
      }
      return line.replace(/\s+$/, '');
    });
}

/**
 * The text layer of a PDF, page by page. It is what the offline parser reads
 * and what gets searched; the AI gets the PDF itself. A PDF that cannot be
 * read as text (a scan, a damaged file) gives an empty string, never an error:
 * the AI can still read it.
 */
export async function pdfText(bytes: Buffer): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const items = content.items.flatMap((item) =>
        'str' in item
          ? [
              {
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
              },
            ]
          : [],
      );
      pages.push(linesFromItems(items).join('\n'));
    }
    return pages.join('\n\n').trim();
  } catch {
    return '';
  } finally {
    await pdf?.loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Turns a stored file into something the model reads well: photos are
 * auto-rotated and scaled down, PDFs go as documents (with their text layer), spreadsheets become
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
      return { kind: 'pdf', data: bytes, text: await pdfText(bytes) };
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
