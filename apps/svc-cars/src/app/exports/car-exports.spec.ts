import type { CarArchiveItemDto, VehicleDto } from '@life-island/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCarDocumentsWorkbook } from './car-documents-workbook.js';
import { archivePath, inCarPath } from './car-exports.service.js';

const item = (overrides: Partial<CarArchiveItemDto>): CarArchiveItemDto => ({
  uploadId: 'u1',
  title: 'Documento',
  folder: 'insurance',
  action: 'keep',
  rule: 'insurance_latest',
  date: '2026-03-01',
  validUntil: null,
  keepUntil: null,
  files: [{ uploadId: 'u1', title: 'Documento' }],
  printFiles: [],
  ...overrides,
});

const vehicle = (
  items: CarArchiveItemDto[],
  status: VehicleDto['status'] = 'active',
): Pick<VehicleDto, 'archive' | 'renewals' | 'status'> => ({
  status,
  renewals: [
    {
      kind: 'insurance',
      subject: null,
      level: 'ok',
      dueDate: '2027-03-01',
      daysLeft: 98,
      graceUntil: null,
      uploadId: 'cert',
      basis: 'End of the policy',
      dueOdometerKm: null,
    },
  ],
  archive: {
    items,
    inCar: items.filter((i) => i.action === 'in_car').length,
    keep: items.filter((i) => i.action === 'keep').length,
    discard: items.filter((i) => i.action === 'discard').length,
  },
});

const ITEMS = [
  item({
    uploadId: 'cert',
    title: 'Certificato RCA 2026',
    action: 'in_car',
    rule: 'insurance_current',
    validUntil: '2027-03-01',
    printFiles: [{ uploadId: 'cert', title: 'Certificato RCA 2026' }],
  }),
  item({
    uploadId: 'bollo',
    title: 'Bollo 2026',
    folder: 'road_tax',
    rule: 'road_tax_claimable',
    keepUntil: '2029-12-31',
  }),
  item({
    uploadId: 'fuel',
    title: 'Pieno',
    folder: 'other',
    action: 'discard',
    rule: 'running_cost',
  }),
];

describe('buildCarDocumentsWorkbook', () => {
  it('lists every document as a table with ✓ and ✗, and what goes in the car', async () => {
    const workbook = buildCarDocumentsWorkbook(
      vehicle(ITEMS),
      'Panda · AB123CD',
      '2026-11-23',
    );
    // Round trip, as Excel would open it.
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(
      (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const sheet = read.getWorksheet('Documenti');
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      'Cartella',
      'Documento',
      'Data',
      'Scadenza',
      'In auto',
      'Da conservare',
      'Conservare fino al',
      'Motivo',
    ]);
    const row = (r: number) =>
      [1, 2, 5, 6].map((c) => sheet?.getRow(r).getCell(c).value);
    expect(row(2)).toEqual([
      '01 - Assicurazione',
      'Certificato RCA 2026',
      '✓',
      '✓',
    ]);
    expect(row(3)).toEqual(['02 - Bollo', 'Bollo 2026', '✗', '✓']);
    expect(row(4)).toEqual(['06 - Altre spese', 'Pieno', '✗', '✗']);
    expect(sheet?.getRow(3).getCell(7).value).toEqual(
      new Date('2029-12-31T00:00:00Z'),
    );
    expect(sheet?.getRow(4).getCell(5).font?.color?.argb).toBe('FFC0392B');
    expect(sheet?.getRow(2).getCell(5).font?.color?.argb).toBe('FF1E8449');

    const onBoard = read.getWorksheet('In auto');
    const documents = [6, 7, 8].map((r) => onBoard?.getRow(r).getCell(1).value);
    expect(documents).toEqual([
      'Carta di circolazione o Documento Unico, in originale',
      'Patente di chi guida',
      'Certificato RCA 2026',
    ]);
  });

  it('warns on a laid-up car', async () => {
    const workbook = buildCarDocumentsWorkbook(
      vehicle([], 'laid_up'),
      'Panda',
      '2026-11-23',
    );
    expect(
      String(workbook.getWorksheet('In auto')?.getRow(3).getCell(1).value),
    ).toMatch(/^Auto ferma\. Da non usare/);
  });
});

describe('helpers', () => {
  it('files each document under its folder, by date and title', () => {
    expect(
      archivePath(
        'Documenti auto - Panda',
        { folder: 'road_tax', date: '2026-02-01' },
        'Bollo: 2026?',
        'scan.PDF',
      ),
    ).toBe('Documenti auto - Panda/02 - Bollo/2026-02-01 - Bollo 2026.pdf');
  });

  it('names the files for the car by kind, date and title', () => {
    expect(
      inCarPath(
        'Documenti in auto - Panda',
        { folder: 'insurance', date: '2026-03-01' },
        'Certificato RCA',
        'cert.pdf',
      ),
    ).toBe(
      'Documenti in auto - Panda/Assicurazione - 2026-03-01 - Certificato RCA.pdf',
    );
  });
});
