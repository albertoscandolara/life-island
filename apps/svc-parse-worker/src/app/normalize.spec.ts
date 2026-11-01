import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { linesFromItems, normalizeDocument } from './normalize.js';

describe('normalizeDocument', () => {
  it('scales photos down to 1600 px and re-encodes them as JPEG', async () => {
    const png = await sharp({
      create: { width: 3200, height: 800, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const result = await normalizeDocument(png, 'PNG');
    expect(result.kind).toBe('image');
    if (result.kind !== 'image') return;
    expect(result.mediaType).toBe('image/jpeg');
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(400);
  });

  it('does not enlarge small images', async () => {
    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const result = await normalizeDocument(png, 'PNG');
    if (result.kind !== 'image') throw new Error('expected an image');
    expect((await sharp(result.data).metadata()).width).toBe(200);
  });

  it('turns every sheet of a workbook into a markdown table', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Spesa');
    sheet.addRow(['Item', 'Price', 'Date']);
    sheet.addRow(['Milk | 1L', 1.29, new Date('2026-10-01T00:00:00Z')]);
    sheet.addRow(['Bread', { formula: '1+1', result: 2 }]);
    workbook.addWorksheet('Empty');
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await normalizeDocument(bytes, 'XLSX');
    expect(result).toEqual({
      kind: 'text',
      text: [
        '## Sheet: Spesa',
        '| Item | Price | Date |',
        '| --- | --- | --- |',
        '| Milk \\| 1L | 1.29 | 2026-10-01 |',
        '| Bread | 2 |  |',
      ].join('\n'),
    });
  });

  it('passes PDFs through with their text layer, line by line', async () => {
    // Drawn as a form is: the value below first, then the labels, then the
    // value beside its label. Lines come back top to bottom, left to right.
    const pdf = pdfWithText([
      [72, 700, 'ARCODA S.R.L.'],
      [72, 760, 'NETTO IN BUSTA'],
      [300, 760, '2.077,33'],
      [72, 730, 'GENNAIO 2026'],
    ]);
    const result = await normalizeDocument(pdf, 'PDF');
    expect(result).toEqual({
      kind: 'pdf',
      data: pdf,
      text: 'NETTO IN BUSTA  2.077,33\nGENNAIO 2026\nARCODA S.R.L.',
    });
  });

  it('gives an unreadable PDF an empty text layer instead of failing', async () => {
    const pdf = Buffer.from('%PDF-1.7 not really');
    expect(await normalizeDocument(pdf, 'PDF')).toEqual({
      kind: 'pdf',
      data: pdf,
      text: '',
    });
  });

  it('reads CSV as text', async () => {
    expect(await normalizeDocument(Buffer.from('a,b\n1,2'), 'CSV')).toEqual({
      kind: 'text',
      text: 'a,b\n1,2',
    });
  });
});

describe('linesFromItems', () => {
  it('joins items on one baseline and keeps touching items together', () => {
    expect(
      linesFromItems([
        { str: 'B', x: 50, y: 10, width: 5 },
        { str: 'A', x: 0, y: 10.2, width: 50 },
        { str: ' ', x: 60, y: 10, width: 2 },
        { str: 'top', x: 0, y: 20, width: 10 },
      ]),
    ).toEqual(['top', 'AB']);
  });
});

/** A one-page PDF with Helvetica text at the given positions. */
function pdfWithText(items: [number, number, string][]): Buffer {
  const stream = items
    .map(([x, y, text]) => `BT /F1 12 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}
