import {
  ACCEPTED_FILE_TYPES,
  createUploadRequestSchema,
  fileFormatFromFilename,
  fileFormatFromMime,
  listRecordsQuerySchema,
} from './documents.js';

describe('file formats', () => {
  it('maps MIME types, ignoring parameters and case', () => {
    expect(fileFormatFromMime('image/jpeg')).toBe('JPG');
    expect(fileFormatFromMime('TEXT/CSV; charset=utf-8')).toBe('CSV');
    expect(
      fileFormatFromMime(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('XLSX');
    expect(fileFormatFromMime('application/x-msdownload')).toBeUndefined();
  });

  it('maps file extensions', () => {
    expect(fileFormatFromFilename('Scontrino.JPEG')).toBe('JPG');
    expect(fileFormatFromFilename('spese.xlsx')).toBe('XLSX');
    expect(fileFormatFromFilename('virus.exe')).toBeUndefined();
    expect(fileFormatFromFilename('no-extension')).toBeUndefined();
  });

  it('lists every format in the accept attribute', () => {
    for (const token of ['.pdf', '.xlsx', 'image/png', '.docx', '.csv']) {
      expect(ACCEPTED_FILE_TYPES.split(',')).toContain(token);
    }
  });
});

describe('create upload request', () => {
  const base = {
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
  };

  it('trims text and drops empty optional fields', () => {
    expect(
      createUploadRequestSchema.parse({
        ...base,
        title: '  Bill ',
        description: '   ',
      }),
    ).toEqual({
      ...base,
      title: 'Bill',
      description: undefined,
    });
  });

  it('rejects a description over 255 characters and files over 25 MB', () => {
    expect(
      createUploadRequestSchema.safeParse({
        ...base,
        description: 'x'.repeat(256),
      }).success,
    ).toBe(false);
    expect(
      createUploadRequestSchema.safeParse({
        ...base,
        sizeBytes: 26 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });
});

describe('list records query', () => {
  it('coerces query-string numbers and applies defaults', () => {
    expect(
      listRecordsQuerySchema.parse({ limit: '5', offset: '10' }),
    ).toMatchObject({
      limit: 5,
      offset: 10,
      sort: 'uploadedAt',
      order: 'desc',
    });
  });

  it('rejects unknown statuses and malformed dates', () => {
    expect(listRecordsQuerySchema.safeParse({ status: 'DONE' }).success).toBe(
      false,
    );
    expect(
      listRecordsQuerySchema.safeParse({ uploadedFrom: '23/10/2026' }).success,
    ).toBe(false);
  });
});
