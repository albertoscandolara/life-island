import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { normalizeDocument } from './normalize.js';

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

  it('passes PDFs through and reads CSV as text', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake');
    expect(await normalizeDocument(pdf, 'PDF')).toEqual({
      kind: 'pdf',
      data: pdf,
    });
    expect(await normalizeDocument(Buffer.from('a,b\n1,2'), 'CSV')).toEqual({
      kind: 'text',
      text: 'a,b\n1,2',
    });
  });
});
