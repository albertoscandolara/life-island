import { carArchive } from './car-archive.js';
import {
  buildSeries,
  costsOf,
  ownershipKindOf,
  praOffice,
  readCarDocument,
  readOwnership,
  type ApprovedCarDocument,
} from './car-documents.js';
import { nameKey, ownershipOf } from './car-ownership.js';

type Fields = Record<string, string | number | boolean | null>;

/**
 * A paper certificato di proprietà as the model reads it, in the shape of a
 * real one of 2017 (demo data): plate and VIN, the owner, one owner before,
 * the sale noted under Gravami ipoteche annotazioni, the ID CDPD and what the
 * change of owner cost.
 */
const certificate = {
  registration_number: 'AB 123 CD',
  vin: 'ZFA19900000000001',
  make: 'FIAT',
  first_registration_date: '2011-06-30',
  document_kind: 'certificate',
  document_number: '17/A000001P',
  issue_date: '2017-05-16',
  pra_office: 'UFFICIO PROV. DI VERONA',
  owner_name: 'ROSSI ANNA',
  owner_tax_code: 'RSSNNA90A41L781X',
  previous_owners: '2',
  sale_date: '2017-05-16',
  liens: 'Non risultano iscritte ipoteche',
  access_code: 'aBcD-eFgH-1234',
  total_amount: '319,00',
} satisfies Fields;

function approved(
  uploadId: string,
  fields: Fields,
  options: Partial<ApprovedCarDocument> = {},
) {
  return {
    uploadId,
    title: uploadId,
    type: 'VEHICLE_OWNERSHIP' as const,
    groupKey: null,
    reading: readCarDocument('VEHICLE_OWNERSHIP', fields, [uploadId]),
    uploadedAt: '2026-01-01T00:00:00.000Z',
    markedStatus: null,
    ...options,
  };
}

const car = {
  registrationNumber: 'AB123CD',
  firstRegistrationDate: '2011-06-30',
  'parties.holder.name': 'Anna Rossi',
} as const;

describe('readCarDocument: ownership', () => {
  it('reads a certificato di proprietà: the car, its owner, the sale and no lien', () => {
    const reading = readCarDocument('VEHICLE_OWNERSHIP', certificate);
    expect(reading.registrationNumber).toBe('AB123CD');
    expect(reading.values.firstRegistrationDate).toBe('2011-06-30');
    expect(reading.number).toBe('17/A000001P');
    expect(reading.issuer).toBe('Verona');
    expect(reading.validFrom).toBe('2017-05-16');
    expect(reading.validUntil).toBeNull();
    expect(reading.amount).toBe(319);
    expect(reading.ownership).toEqual({
      kind: 'certificate',
      owners: ['ROSSI ANNA'],
      previousOwners: 2,
      saleDate: '2017-05-16',
      seller: null,
      liens: null,
      noLiens: true,
      accessCode: 'aBcD-eFgH-1234',
    });
    expect(reading.facts.map((f) => f.label)).toEqual([
      'Document',
      'Owner',
      'Owner since',
      'Previous owners',
      'Liens',
      'Number',
      'Issued',
      'PRA office',
      'Access code',
      'Amount',
    ]);
    expect(reading.facts.find((f) => f.label === 'Liens')?.value).toBe('None');
  });

  it('keeps a lien as printed, and several owners apart', () => {
    const o = readOwnership({
      owner_name: 'ROSSI ANNA; BIANCHI LUCA',
      liens: 'Fermo amministrativo del 03/02/2024',
    });
    expect(o.owners).toEqual(['ROSSI ANNA', 'BIANCHI LUCA']);
    expect(o.liens).toBe('Fermo amministrativo del 03/02/2024');
    expect(o.noLiens).toBe(false);
  });

  it('tells the kind from the file name when it was not read', () => {
    expect(ownershipKindOf(null, ['Atto di vendita Punto.pdf'])).toBe('sale');
    expect(ownershipKindOf(null, ['Passaggio di proprietà.pdf'])).toBe(
      'transfer',
    );
    expect(ownershipKindOf(null, ['AB123CD Certificato di proprietà'])).toBe(
      'certificate',
    );
    expect(ownershipKindOf('transfer', ['Certificato di proprietà'])).toBe(
      'transfer',
    );
    expect(ownershipKindOf(null, ['scan.pdf'])).toBeNull();
  });

  it('names the PRA office by its town', () => {
    expect(praOffice('UFFICIO PROV. DI VERONA')).toBe('Verona');
    expect(praOffice('PRA di Reggio Emilia')).toBe('Reggio Emilia');
    expect(praOffice('verona')).toBe('Verona');
    expect(praOffice(null)).toBeNull();
  });

  it('counts the change of owner among the car costs', () => {
    const [cost] = costsOf([approved('cdp', certificate)]);
    expect(cost).toMatchObject({
      kind: 'ownership',
      amount: 319,
      date: '2017-05-16',
    });
  });
});

describe('ownershipOf', () => {
  it('is null without an ownership document', () => {
    expect(ownershipOf(car, buildSeries([], '2026-11-25'))).toBeNull();
  });

  it('names the owner, since when, and starts the history at the first registration', () => {
    const series = buildSeries([approved('cdp', certificate)], '2026-11-25');
    const ownership = ownershipOf(car, series);
    expect(ownership).toEqual({
      owners: ['ROSSI ANNA'],
      since: '2017-05-16',
      previousOwners: 2,
      liens: null,
      noLiens: true,
      certificateNumber: '17/A000001P',
      accessCode: 'aBcD-eFgH-1234',
      // The libretto's "Anna Rossi" is the same person.
      holderDiffers: null,
      events: [
        {
          date: '2011-06-30',
          kind: 'registered',
          owners: [],
          seller: null,
          uploadId: null,
        },
        {
          date: '2017-05-16',
          kind: 'certificate',
          owners: ['ROSSI ANNA'],
          seller: null,
          uploadId: 'cdp',
        },
      ],
    });
  });

  it('records a later sale as a change of owner, and the libretto that has to follow', () => {
    const sale = approved(
      'sale',
      {
        registration_number: 'AB123CD',
        document_kind: 'sale',
        sale_date: '2026-10-02',
        owner_name: 'VERDI PAOLO',
        seller_name: 'ROSSI ANNA',
        total_amount: '402,00',
      },
      { uploadedAt: '2026-10-05T00:00:00.000Z' },
    );
    const series = buildSeries(
      [approved('cdp', certificate), sale],
      '2026-11-25',
    );
    const ownership = ownershipOf(car, series);
    expect(ownership?.owners).toEqual(['VERDI PAOLO']);
    expect(ownership?.since).toBe('2026-10-02');
    expect(ownership?.events.map((e) => [e.kind, e.date, e.seller])).toEqual([
      ['registered', '2011-06-30', null],
      ['certificate', '2017-05-16', null],
      ['sale', '2026-10-02', 'ROSSI ANNA'],
    ]);
    // The seller's certificate says nothing about the new owner.
    expect(ownership?.certificateNumber).toBeNull();
    expect(ownership?.accessCode).toBeNull();
    expect(ownership?.previousOwners).toBeNull();
    expect(ownership?.holderDiffers).toBe('Anna Rossi');
  });

  it('does not count a reissued certificate of the same owner as a change', () => {
    const reissued = approved(
      'cdp-2024',
      {
        ...certificate,
        document_number: '24/A000002P',
        issue_date: '2024-03-01',
        sale_date: null,
        liens: 'Fermo amministrativo del 01/02/2024',
      },
      { uploadedAt: '2024-03-02T00:00:00.000Z' },
    );
    const series = buildSeries(
      [approved('cdp', certificate), reissued],
      '2026-11-25',
    );
    const ownership = ownershipOf(car, series);
    expect(ownership?.events).toHaveLength(2);
    expect(ownership?.since).toBe('2017-05-16');
    expect(ownership?.liens).toBe('Fermo amministrativo del 01/02/2024');
    expect(ownership?.certificateNumber).toBe('24/A000002P');
  });

  it('compares names whatever their order, case and accents', () => {
    expect(nameKey('Rossi Mario')).toBe(nameKey('MARIO ROSSI'));
    expect(nameKey("D'Amico Niccolò")).toBe(nameKey('NICCOLO D AMICO'));
  });
});

describe('carArchive: ownership', () => {
  it('keeps every ownership document at home, the latest as proof of who owns the car', () => {
    const sale = approved(
      'sale',
      {
        registration_number: 'AB123CD',
        document_kind: 'sale',
        sale_date: '2026-10-02',
        owner_name: 'VERDI PAOLO',
      },
      { uploadedAt: '2026-10-05T00:00:00.000Z' },
    );
    const series = buildSeries(
      [approved('cdp', certificate), sale],
      '2026-11-25',
    );
    const archive = carArchive(
      {
        status: 'active',
        series: series.map(({ type, versions }) => ({
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
            amount: document.reading.amount,
            facts: [],
            uploadedAt: document.uploadedAt,
            reviewedAt: document.uploadedAt,
            documents: [
              {
                uploadId: document.uploadId,
                title: document.uploadId,
                role: null,
                amount: null,
                uploadedAt: document.uploadedAt,
                reviewedAt: document.uploadedAt,
                linkedByHand: false,
              },
            ],
          })),
        })),
        expenses: [],
        fines: [],
      },
      '2026-11-25',
    );
    expect(
      archive.items.map((i) => [i.uploadId, i.folder, i.action, i.rule]),
    ).toEqual([
      ['sale', 'ownership', 'keep', 'ownership_current'],
      ['cdp', 'ownership', 'keep', 'ownership_history'],
    ]);
    expect(archive.inCar).toBe(0);
  });
});
