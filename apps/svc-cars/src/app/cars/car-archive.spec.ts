import type {
  CarDocumentSeriesDto,
  CarDocumentStatus,
  CarDocumentType,
  CarDocumentVersionDto,
  CarFineDto,
  RenewalDto,
} from '@life-island/contracts';
import { describe, expect, it } from 'vitest';
import {
  carArchive,
  laidUp,
  roadTaxKeepUntil,
  type ArchiveInput,
} from './car-archive.js';

const TODAY = '2026-11-23';

let next = 0;
function version(
  type: CarDocumentType,
  status: CarDocumentStatus,
  overrides: Partial<CarDocumentVersionDto> = {},
): CarDocumentVersionDto {
  const uploadId = `u${++next}`;
  return {
    uploadId,
    title: `${type} ${next}`,
    type,
    version: 1,
    status,
    number: null,
    issuer: null,
    validFrom: null,
    validUntil: null,
    amount: null,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    documents: [
      {
        uploadId,
        title: `${type} ${next}`,
        role: null,
        amount: null,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        reviewedAt: '2026-01-01T00:00:00.000Z',
        linkedByHand: false,
      },
    ],
    ...overrides,
  };
}

const series = (
  type: CarDocumentType,
  versions: CarDocumentVersionDto[],
): CarDocumentSeriesDto => ({ type, versions });

const input = (overrides: Partial<ArchiveInput> = {}): ArchiveInput => ({
  status: 'active',
  series: [],
  expenses: [],
  fines: [],
  ...overrides,
});

describe('roadTaxKeepUntil', () => {
  it('lasts until 31 December of the 3rd year after the year it was due', () => {
    expect(
      roadTaxKeepUntil({
        validFrom: '2023-02-01',
        issuer: 'Regione Lombardia',
        uploadedAt: '2023-02-10T00:00:00Z',
      }),
    ).toBe('2026-12-31');
  });

  it('gives Piemonte 5 years', () => {
    expect(
      roadTaxKeepUntil({
        validFrom: '2023-02-01',
        issuer: 'REGIONE PIEMONTE',
        uploadedAt: '2023-02-10T00:00:00Z',
      }),
    ).toBe('2028-12-31');
  });

  it('falls back to the upload date', () => {
    expect(
      roadTaxKeepUntil({
        validFrom: null,
        issuer: null,
        uploadedAt: '2021-05-10T00:00:00Z',
      }),
    ).toBe('2024-12-31');
  });
});

describe('carArchive', () => {
  it('carries the certificate of the current policy, lets the old ones go', () => {
    const current = version('CAR_INSURANCE', 'current', {
      validUntil: '2027-03-01',
      documents: [
        {
          uploadId: 'policy',
          title: 'Polizza',
          role: 'policy',
          amount: 500,
          uploadedAt: '2026-03-01T00:00:00Z',
          reviewedAt: '2026-03-01T00:00:00Z',
          linkedByHand: false,
        },
        {
          uploadId: 'cert',
          title: 'Certificato',
          role: 'certificate',
          amount: null,
          uploadedAt: '2026-03-01T00:00:00Z',
          reviewedAt: '2026-03-01T00:00:00Z',
          linkedByHand: false,
        },
      ],
    });
    const old = version('CAR_INSURANCE', 'superseded');
    const archive = carArchive(
      input({ series: [series('CAR_INSURANCE', [current, old])] }),
      TODAY,
    );
    expect(archive.items.map((i) => [i.action, i.rule])).toEqual([
      ['in_car', 'insurance_current'],
      ['discard', 'insurance_old'],
    ]);
    expect(archive.items[0].printFiles).toEqual([
      { uploadId: 'cert', title: 'Certificato' },
    ]);
    expect(archive.items[0].files).toHaveLength(2);
    expect(archive).toMatchObject({ inCar: 1, keep: 0, discard: 1 });
  });

  it('prints the whole policy when it has no separate certificate', () => {
    const current = version('CAR_INSURANCE', 'current');
    const archive = carArchive(
      input({ series: [series('CAR_INSURANCE', [current])] }),
      TODAY,
    );
    expect(archive.items[0].printFiles).toEqual(archive.items[0].files);
  });

  it('keeps carrying a policy in its 15 days of grace, not after', () => {
    const inGrace = version('CAR_INSURANCE', 'expired', {
      validUntil: '2026-11-15',
    });
    const lapsed = version('CAR_INSURANCE', 'expired', {
      validUntil: '2026-10-01',
    });
    expect(
      carArchive(input({ series: [series('CAR_INSURANCE', [inGrace])] }), TODAY)
        .items[0].action,
    ).toBe('in_car');
    expect(
      carArchive(input({ series: [series('CAR_INSURANCE', [lapsed])] }), TODAY)
        .items[0],
    ).toMatchObject({ action: 'keep', rule: 'insurance_latest' });
  });

  it('skips a cancelled policy when looking for the latest', () => {
    const cancelled = version('CAR_INSURANCE', 'cancelled');
    const previous = version('CAR_INSURANCE', 'expired', {
      validUntil: '2026-01-01',
    });
    expect(
      carArchive(
        input({ series: [series('CAR_INSURANCE', [cancelled, previous])] }),
        TODAY,
      ).items.map((i) => i.rule),
    ).toEqual(['insurance_old', 'insurance_latest']);
  });

  it('keeps bollo receipts at home until they can no longer be claimed', () => {
    const versions = [2026, 2025, 2024, 2023, 2022].map((year) =>
      version('ROAD_TAX', year === 2026 ? 'current' : 'superseded', {
        validFrom: `${year}-02-01`,
        issuer: 'Regione Lombardia',
      }),
    );
    const items = carArchive(
      input({ series: [series('ROAD_TAX', versions)] }),
      TODAY,
    ).items;
    expect(items.map((i) => [i.date, i.action, i.keepUntil])).toEqual([
      ['2026-02-01', 'keep', '2029-12-31'],
      ['2025-02-01', 'keep', '2028-12-31'],
      ['2024-02-01', 'keep', '2027-12-31'],
      ['2023-02-01', 'keep', '2026-12-31'],
      ['2022-02-01', 'discard', '2025-12-31'],
    ]);
    expect(items.some((i) => i.action === 'in_car')).toBe(false);
  });

  it('always keeps the latest bollo, however old', () => {
    const only = version('ROAD_TAX', 'expired', { validFrom: '2019-02-01' });
    expect(
      carArchive(input({ series: [series('ROAD_TAX', [only])] }), TODAY)
        .items[0].action,
    ).toBe('keep');
  });

  it('carries the latest revisione and the libretto', () => {
    const archive = carArchive(
      input({
        series: [
          series('VEHICLE_REGISTRATION', [
            version('VEHICLE_REGISTRATION', 'current'),
            version('VEHICLE_REGISTRATION', 'superseded'),
          ]),
          series('VEHICLE_INSPECTION', [
            version('VEHICLE_INSPECTION', 'current'),
            version('VEHICLE_INSPECTION', 'superseded'),
          ]),
        ],
      }),
      TODAY,
    );
    expect(archive.items.map((i) => [i.folder, i.action])).toEqual([
      ['registration', 'in_car'],
      ['registration', 'discard'],
      ['inspection', 'in_car'],
      ['inspection', 'discard'],
    ]);
    // The libretto must be the original: nothing of it is printed.
    expect(archive.items[0].printFiles).toEqual([]);
    expect(archive.items[2].printFiles).toHaveLength(1);
  });

  it('keeps the service history and a fine until it can no longer be collected', () => {
    const fine = (overrides: Partial<CarFineDto>): CarFineDto =>
      ({
        uploadId: 'f',
        stage: 'paid',
        violationDate: '2022-06-01',
        notifiedOn: null,
        ...overrides,
      }) as CarFineDto;
    const archive = carArchive(
      input({
        expenses: [
          {
            uploadId: 's',
            title: 'Tagliando',
            kind: 'scheduled_service',
            date: '2019-01-10',
            cancelled: false,
          },
          {
            uploadId: 'r',
            title: 'Frizione',
            kind: 'repair',
            date: '2024-05-10',
            cancelled: false,
          },
          {
            uploadId: 'fuel',
            title: 'Pieno',
            kind: 'fuel',
            date: '2026-11-01',
            cancelled: false,
          },
          {
            uploadId: 'acc',
            title: 'Catene',
            kind: 'accessories',
            date: '2025-12-01',
            cancelled: false,
          },
          {
            uploadId: 'f1',
            title: 'Multa pagata',
            kind: 'fine',
            date: '2022-06-01',
            cancelled: false,
          },
          {
            uploadId: 'f2',
            title: 'Multa vecchia',
            kind: 'fine',
            date: '2020-06-01',
            cancelled: false,
          },
          {
            uploadId: 'f3',
            title: 'Multa aperta',
            kind: 'fine',
            date: '2026-10-01',
            cancelled: false,
          },
          {
            uploadId: 'x',
            title: 'Annullata',
            kind: 'repair',
            date: '2026-01-01',
            cancelled: true,
          },
        ],
        fines: [
          fine({ uploadId: 'f1' }),
          fine({ uploadId: 'f2', violationDate: '2020-06-01' }),
          fine({ uploadId: 'f3', stage: 'due', violationDate: '2026-10-01' }),
        ],
      }),
      TODAY,
    );
    const byId = new Map(archive.items.map((i) => [i.uploadId, i]));
    expect(byId.get('s')).toMatchObject({
      folder: 'maintenance',
      action: 'keep',
      keepUntil: null,
    });
    expect(byId.get('r')?.action).toBe('keep');
    expect(byId.get('fuel')).toMatchObject({
      action: 'discard',
      rule: 'running_cost',
    });
    expect(byId.get('acc')).toMatchObject({
      action: 'keep',
      rule: 'warranty',
      keepUntil: '2027-12-01',
    });
    expect(byId.get('f1')).toMatchObject({
      action: 'keep',
      rule: 'fine_paid',
      keepUntil: '2027-06-01',
    });
    expect(byId.get('f2')).toMatchObject({
      action: 'discard',
      rule: 'fine_old',
    });
    expect(byId.get('f3')).toMatchObject({ action: 'keep', rule: 'fine_open' });
    expect(byId.has('x')).toBe(false);
  });

  it('puts nothing in a sold car, and keeps the suspended policy of a laid-up one', () => {
    const docs = [
      series('CAR_INSURANCE', [version('CAR_INSURANCE', 'current')]),
      series('VEHICLE_REGISTRATION', [
        version('VEHICLE_REGISTRATION', 'current'),
      ]),
    ];
    const sold = carArchive(input({ status: 'sold', series: docs }), TODAY);
    expect(sold.inCar).toBe(0);
    const parked = carArchive(
      input({ status: 'laid_up', series: docs }),
      TODAY,
    );
    expect(parked.items.map((i) => [i.folder, i.action, i.rule])).toEqual([
      ['registration', 'in_car', 'registration_current'],
      ['insurance', 'keep', 'insurance_suspended'],
    ]);
  });
});

describe('laidUp', () => {
  const renewal = (kind: RenewalDto['kind']): RenewalDto => ({
    kind,
    subject: null,
    level: 'expiring',
    dueDate: '2026-12-01',
    daysLeft: 8,
    graceUntil: null,
    uploadId: null,
    basis: 'End of the policy',
    dueOdometerKm: null,
  });

  it('turns the insurance of a laid-up car into a do-not-use warning', () => {
    const [insurance, roadTax] = laidUp('laid_up', [
      renewal('insurance'),
      renewal('road_tax'),
    ]);
    expect(insurance).toMatchObject({ level: 'suspended', dueDate: null });
    expect(insurance.basis).toMatch(/Do not use it/);
    expect(roadTax.level).toBe('expiring');
  });

  it('leaves a car in use as it is', () => {
    const renewals = [renewal('insurance')];
    expect(laidUp('active', renewals)).toBe(renewals);
  });
});
