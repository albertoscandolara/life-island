import { inspectFile } from './file-inspection.js';
import { safeFilename } from './uploads.service.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('inspectFile', () => {
  it('detects the real format from the bytes, whatever the name says', async () => {
    const result = await inspectFile(PNG, {
      mime: 'application/pdf',
      filename: 'bill.pdf',
    });
    expect(result).toMatchObject({ format: 'PNG', mime: 'image/png' });
    expect(result?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts text formats when the bytes are really text', async () => {
    const csv = Buffer.from('date,amount\n2026-10-01,18.90\n');
    expect(
      await inspectFile(csv, { mime: 'text/csv', filename: 'spese.csv' }),
    ).toMatchObject({
      format: 'CSV',
      mime: 'text/csv',
    });
    expect(
      await inspectFile(csv, { mime: null, filename: 'notes.txt' }),
    ).toMatchObject({ format: 'TXT' });
  });

  it('rejects binary content posing as text, and unsupported types', async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]);
    expect(
      await inspectFile(binary, { mime: 'text/plain', filename: 'a.txt' }),
    ).toBeUndefined();
    const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    expect(
      await inspectFile(gif, { mime: 'image/gif', filename: 'a.gif' }),
    ).toBeUndefined();
  });
});

describe('safeFilename', () => {
  it('keeps a readable name without paths or odd characters', () => {
    expect(safeFilename('Scontrino Esselunga (1).jpg')).toBe(
      'Scontrino-Esselunga-1-.jpg',
    );
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\me\\bolletta.pdf')).toBe('bolletta.pdf');
    expect(safeFilename('...')).toBe('file');
  });
});
