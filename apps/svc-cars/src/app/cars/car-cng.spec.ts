import { carArchive } from './car-archive.js';
import { cngOf, cngRenewals } from './car-cng.js';
import {
  buildSeries,
  costsOf,
  monthOf,
  readCarDocument,
  type ApprovedCarDocument,
} from './car-documents.js';

type Fields = Record<string, string | number | boolean | null>;

/**
 * A label of the Comitato Fondo Bombole Metano as the model reads it: two
 * cylinders, the month applied, a due month per row (demo data, in the shape
 * of real labels of 2015, 2019 and 2023).
 */
function label(applied: string, due: string, serials: [string, string]) {
  return {
    registration_number: 'AB 123 CD',
    applied_month: applied,
    workshop: 'Autofficina Demo',
    label_number: `L-${applied}`,
    approval: 'ECE R 110',
    cylinder_1_litres: '66',
    cylinder_1_make: 'FABER',
    cylinder_1_serial: serials[0],
    cylinder_1_due_month: due,
    cylinder_2_litres: '18,1',
    cylinder_2_make: 'FABER',
    cylinder_2_serial: serials[1],
    cylinder_2_due_month: due,
    total_litres: '84,1',
  } satisfies Fields;
}

function approved(
  uploadId: string,
  type: ApprovedCarDocument['type'],
  fields: Fields,
  markedStatus: ApprovedCarDocument['markedStatus'] = null,
) {
  return {
    uploadId,
    title: uploadId,
    type,
    groupKey: null,
    reading: readCarDocument(type, fields, [uploadId]),
    uploadedAt: '2026-01-01T00:00:00.000Z',
    markedStatus,
  };
}

const cngCar = {
  'engine.fuelKey': 'petrol_cng',
  firstRegistrationDate: '2011-07-12',
} as const;
const labels = [
  approved(
    'cng-2015',
    'CNG_CYLINDER_INSPECTION',
    label('2015-07', '07/2019', ['09/4321/011', '09/8765/022']),
  ),
  approved(
    'cng-2019',
    'CNG_CYLINDER_INSPECTION',
    label('luglio 2019', '07-2023', ['14-1234-033', '14-5678-044']),
  ),
  approved(
    'cng-2023',
    'CNG_CYLINDER_INSPECTION',
    label('2023-07', '2027-07', ['12/3456/055', '16/7890/066']),
  ),
];

describe('CNG cylinders', () => {
  it('reads months the way labels print them', () => {
    expect(monthOf('07/2027')).toBe('2027-07');
    expect(monthOf('7-2027')).toBe('2027-07');
    expect(monthOf('2027-07')).toBe('2027-07');
    expect(monthOf('LUGLIO 2023')).toBe('2023-07');
    expect(monthOf('Lug. 2023')).toBe('2023-07');
    expect(monthOf('2023-07-15')).toBe('2023-07');
    expect(monthOf('13/2023')).toBeNull();
    expect(monthOf('soon')).toBeNull();
  });

  it('reads a label: cylinders, litres, approval and the month they are due', () => {
    const { reading } = labels[2];
    expect(reading.validFrom).toBe('2023-07-01');
    expect(reading.validUntil).toBe('2027-07-31');
    expect(reading.number).toBe('L-2023-07');
    expect(reading.issuer).toBe('Autofficina Demo');
    expect(reading.registrationNumber).toBe('AB123CD');
    expect(reading.cng).toMatchObject({
      appliedMonth: '2023-07',
      approval: 'r110',
      totalLitres: 84.1,
      dueMonth: '2027-07',
      duePrinted: true,
      cylinders: [
        { litres: 66, make: 'FABER', serialNumber: '12/3456/055' },
        { litres: 18.1, make: 'FABER', serialNumber: '16/7890/066' },
      ],
    });
  });

  it('takes the earliest due month when the cylinders differ', () => {
    const { reading } = approved('x', 'CNG_CYLINDER_INSPECTION', {
      ...label('2023-07', '07/2027', ['A1', 'B2']),
      cylinder_2_due_month: '03/2026',
    });
    expect(reading.validUntil).toBe('2026-03-31');
  });

  it('without a printed month, counts 4 years (R110) or 5 (national) from the label', () => {
    const r110 = approved('r', 'CNG_CYLINDER_INSPECTION', {
      applied_month: '2023-07',
      approval: 'r110',
    });
    expect(r110.reading.validUntil).toBe('2027-07-31');
    expect(r110.reading.cng?.duePrinted).toBe(false);
    const national = approved('n', 'CNG_CYLINDER_INSPECTION', {
      applied_month: '2023-07',
      approval: 'DGM',
    });
    expect(national.reading.cng?.approval).toBe('national');
    expect(national.reading.validUntil).toBe('2028-07-31');
  });

  it('follows the latest label, keeps the history and sees exchanged cylinders', () => {
    const today = '2026-11-23';
    const cng = cngOf(cngCar, buildSeries(labels, today), today);
    expect(cng).toMatchObject({
      approval: 'r110',
      totalLitres: 84.1,
      dueDate: '2027-07-31',
      level: 'ok',
      basis: 'The month printed on the cylinder label',
    });
    expect(cng?.history.map((h) => [h.month, h.replaced])).toEqual([
      ['2023-07', true],
      ['2019-07', true],
      ['2015-07', false],
    ]);
    expect(cngRenewals(cng)).toEqual([
      expect.objectContaining({
        kind: 'cng_cylinders',
        level: 'ok',
        dueDate: '2027-07-31',
        uploadId: 'cng-2023',
      }),
    ]);
  });

  it('warns 60 days before and once past', () => {
    const series = (today: string) => buildSeries(labels, today);
    expect(cngOf(cngCar, series('2027-06-15'), '2027-06-15')?.level).toBe(
      'expiring',
    );
    expect(cngOf(cngCar, series('2027-08-01'), '2027-08-01')?.level).toBe(
      'expired',
    );
  });

  it('applies to every car that runs on CNG, with or without a label', () => {
    const today = '2026-11-23';
    const none = buildSeries([], today);
    // Petrol only, no label: nothing to requalify.
    expect(cngOf({ 'engine.fuelKey': 'petrol' }, none, today)).toBeNull();
    // A new methane car: estimated from its first registration.
    expect(
      cngOf(
        { 'engine.fuelKey': 'cng', firstRegistrationDate: '2025-02-10' },
        none,
        today,
      ),
    ).toMatchObject({ dueDate: '2029-02-28', level: 'ok', history: [] });
    // An older one with no label on file: missing, and says since when.
    const old = cngOf(cngCar, none, today);
    expect(old?.level).toBe('missing');
    expect(old?.basis).toContain('2015-07-31');
    // A label on a car whose fuel is not set yet still counts.
    expect(cngOf({}, buildSeries(labels, today), today)?.dueDate).toBe(
      '2027-07-31',
    );
  });

  it('warns for the end of life when it comes before the next requalification', () => {
    const today = '2026-11-23';
    const ending = approved('eol', 'CNG_CYLINDER_INSPECTION', {
      ...label('2023-07', '07/2027', ['A1', 'B2']),
      manufacture_month: '2006-03',
    });
    const cng = cngOf(cngCar, buildSeries([ending], today), today);
    expect(cng?.endOfLife).toBe('2026-03-31');
    expect(cng?.dueDate).toBe('2026-03-31');
    expect(cng?.level).toBe('expired');
    expect(cng?.basis).toMatch(/End of life/);
  });

  it('ignores a cancelled label', () => {
    const today = '2026-11-23';
    const docs = [
      labels[1],
      { ...labels[2], markedStatus: 'cancelled' as const },
    ];
    expect(cngOf(cngCar, buildSeries(docs, today), today)?.dueDate).toBe(
      '2023-07-31',
    );
  });

  it('keeps the latest label at home and lets the older ones go: none in the car', () => {
    const today = '2026-11-23';
    const series = buildSeries(labels, today).map(({ type, versions }) => ({
      type,
      versions: versions.map(({ document, version, status }) => ({
        uploadId: document.uploadId,
        title: document.uploadId,
        type,
        version,
        status,
        number: document.reading.number,
        issuer: document.reading.issuer,
        validFrom: document.reading.validFrom,
        validUntil: document.reading.validUntil,
        amount: null,
        uploadedAt: document.uploadedAt,
        reviewedAt: document.uploadedAt,
        documents: [],
      })),
    }));
    const archive = carArchive(
      { status: 'active', series, expenses: [], fines: [] },
      today,
    );
    expect(
      archive.items.map((i) => [i.uploadId, i.folder, i.action, i.rule]),
    ).toEqual([
      ['cng-2023', 'cng_cylinders', 'keep', 'cng_current'],
      ['cng-2019', 'cng_cylinders', 'discard', 'cng_old'],
      ['cng-2015', 'cng_cylinders', 'discard', 'cng_old'],
    ]);
    expect(archive.inCar).toBe(0);
  });

  it('counts what a requalification cost, when its invoice says', () => {
    const paid = approved('paid', 'CNG_CYLINDER_INSPECTION', {
      ...label('2023-07', '07/2027', ['A1', 'B2']),
      total_amount: '45,00',
    });
    expect(costsOf([paid]).map((c) => [c.kind, c.amount, c.date])).toEqual([
      ['cng_cylinders', 45, '2023-07-01'],
    ]);
  });
});
