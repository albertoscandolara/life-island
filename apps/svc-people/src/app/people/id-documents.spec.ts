import type { PersonValues } from '@life-island/contracts';
import {
  buildSeries,
  daysUntil,
  expiryAlerts,
  idDocumentType,
  isOutdated,
  matchPerson,
  proposeChanges,
  readIdDocument,
  type ApprovedDocument,
  type KnownPerson,
  mergedValues,
} from './id-documents.js';

const parentOf = new Map<string, string | null>([
  ['ID_DOCUMENT', null],
  ['PASSPORT', 'ID_DOCUMENT'],
  ['IDENTITY_CARD', 'ID_DOCUMENT'],
  ['MY_CIE', 'IDENTITY_CARD'],
  ['BILL', null],
]);

const empty: PersonValues = {
  lastName: null,
  firstName: null,
  taxCode: null,
  birthDate: null,
  birthPlace: null,
  sex: null,
  citizenship: null,
  residenceAddress: null,
};

const alberto: KnownPerson = {
  ...empty,
  id: 'p1',
  lastName: 'SCANDOLARA',
  firstName: 'ALBERTO',
  taxCode: 'SCNLRT92M21I775E',
  birthDate: '1992-08-21',
  birthPlace: 'SOAVE (VR)',
  residenceAddress: 'VIA DEI BANDI 10, TREGNAGO',
};

describe('idDocumentType', () => {
  it('finds the type through subcategories', () => {
    expect(idDocumentType(['MY_CIE'], parentOf)).toEqual({
      isId: true,
      type: 'IDENTITY_CARD',
    });
  });

  it('knows a document filed only under the root is an ID document', () => {
    expect(idDocumentType(['ID_DOCUMENT'], parentOf)).toEqual({
      isId: true,
      type: null,
    });
  });

  it('recognises a type moved to the top level', () => {
    expect(idDocumentType(['DRIVING_LICENCE'], new Map())).toEqual({
      isId: true,
      type: 'DRIVING_LICENCE',
    });
  });

  it('ignores other documents', () => {
    expect(idDocumentType(['BILL'], parentOf).isId).toBe(false);
  });
});

describe('readIdDocument', () => {
  it('reads the shared keys of every ID template', () => {
    const reading = readIdDocument({
      last_name: ' Scandolara ',
      first_name: 'Alberto',
      tax_code: 'scnlrt92m21i775e',
      birth_date: '1992-08-21',
      sex: 'M',
      document_number: 'CA 00000 AA',
      issue_date: '2020-01-10',
      expiry_date: '2030-08-21',
      issuer: '',
    });
    expect(reading.holder).toMatchObject({
      lastName: 'Scandolara',
      firstName: 'Alberto',
      taxCode: 'SCNLRT92M21I775E',
      birthDate: '1992-08-21',
      sex: 'M',
      citizenship: null,
    });
    expect(reading.documentNumber).toBe('CA00000AA');
    expect(reading.issuer).toBeNull();
    expect(reading.expiryDate).toBe('2030-08-21');
  });
});

describe('matchPerson', () => {
  it('matches by tax code first', () => {
    expect(
      matchPerson(
        { ...empty, taxCode: 'scnlrt92m21i775e', lastName: 'OTHER' },
        [alberto],
      ),
    ).toEqual({ person: alberto, match: 'tax_code' });
  });

  it('matches a document with no tax code by name and birth date', () => {
    expect(
      matchPerson(
        {
          ...empty,
          lastName: 'Scandolara',
          firstName: 'alberto',
          birthDate: '1992-08-21',
        },
        [alberto],
      ),
    ).toEqual({ person: alberto, match: 'name_and_birth_date' });
  });

  it('treats another tax code as another person', () => {
    expect(
      matchPerson(
        {
          ...empty,
          lastName: 'SCANDOLARA',
          firstName: 'ALBERTO',
          birthDate: '1992-08-21',
          taxCode: 'XXXXXX00X00X000X',
        },
        [alberto],
      ).match,
    ).toBe('none');
  });
});

describe('proposeChanges', () => {
  it('proposes every printed value for a new person', () => {
    const changes = proposeChanges(
      { ...empty, lastName: 'ROSSI', firstName: 'MARIA' },
      null,
      false,
    );
    expect(changes.map((c) => [c.field, c.kind, c.suggestion])).toEqual([
      ['lastName', 'new_value', 'accept'],
      ['firstName', 'new_value', 'accept'],
    ]);
  });

  it('skips equal values, takes new ones, checks the ones that never change', () => {
    const changes = proposeChanges(
      {
        ...alberto,
        lastName: 'Scandolara',
        citizenship: 'IT',
        birthDate: '1992-08-12',
        residenceAddress: 'VIA PONZILOVO 9, RONCO',
      },
      alberto,
      false,
    );
    expect(
      changes.map((c) => [c.field, c.kind, c.suggestion, c.current]),
    ).toEqual([
      ['birthDate', 'different_value', 'check', '1992-08-21'],
      ['citizenship', 'new_value', 'accept', null],
      [
        'residenceAddress',
        'different_value',
        'accept',
        'VIA DEI BANDI 10, TREGNAGO',
      ],
    ]);
  });

  it('suggests keeping your data when the document is outdated', () => {
    const changes = proposeChanges(
      { ...alberto, residenceAddress: 'OLD ADDRESS', citizenship: 'IT' },
      alberto,
      true,
    );
    expect(changes.map((c) => [c.field, c.suggestion])).toEqual([
      ['citizenship', 'keep_current'],
      ['residenceAddress', 'keep_current'],
    ]);
  });
});

const doc = (
  uploadId: string,
  type: ApprovedDocument['type'],
  issueDate: string | null,
  expiryDate: string | null,
  markedStatus: ApprovedDocument['markedStatus'] = null,
): ApprovedDocument => ({
  uploadId,
  type,
  issueDate,
  expiryDate,
  uploadedAt: '2026-11-01T00:00:00.000Z',
  markedStatus,
});

describe('buildSeries', () => {
  it('numbers versions from the oldest and marks the older ones superseded', () => {
    const [series] = buildSeries(
      [
        doc('new', 'PASSPORT', '2024-05-01', '2034-05-01'),
        doc('old', 'PASSPORT', '2014-05-01', '2024-05-01'),
      ],
      '2026-11-06',
    );
    expect(
      series.versions.map((v) => [v.document.uploadId, v.version, v.status]),
    ).toEqual([
      ['new', 2, 'current'],
      ['old', 1, 'superseded'],
    ]);
  });

  it('marks the latest expired once past its date, and keeps your marks', () => {
    const series = buildSeries(
      [
        doc('cie', 'IDENTITY_CARD', '2015-01-01', '2025-01-01'),
        doc('lic', 'DRIVING_LICENCE', '2020-01-01', '2030-01-01', 'lost'),
      ],
      '2026-11-06',
    );
    expect(series.map((s) => [s.type, s.versions[0].status])).toEqual([
      ['IDENTITY_CARD', 'expired'],
      ['DRIVING_LICENCE', 'lost'],
    ]);
  });
});

describe('expiryAlerts', () => {
  const person = { id: 'p1', firstName: 'ALBERTO', lastName: 'SCANDOLARA' };
  const today = '2026-11-06';

  it('warns about the latest version only, within each type window', () => {
    const series = buildSeries(
      [
        // Old passport, expired, but replaced: no warning.
        doc('p-old', 'PASSPORT', '2014-01-01', '2024-01-01'),
        // 170 days left: within a passport's 180.
        doc('p-new', 'PASSPORT', '2017-04-25', '2027-04-25'),
        // 120 days left: outside an identity card's 90.
        doc('cie', 'IDENTITY_CARD', '2017-03-06', '2027-03-06'),
        // Expired three days ago.
        doc('ts', 'HEALTH_CARD', '2020-11-03', '2026-11-03'),
      ],
      today,
    );
    expect(
      expiryAlerts(person, series, today).map((a) => [
        a.uploadId,
        a.level,
        a.daysLeft,
      ]),
    ).toEqual([
      ['ts', 'expired', -3],
      ['p-new', 'expiring', 170],
    ]);
  });

  it('never warns about a document you marked lost or one with no expiry date', () => {
    const series = buildSeries(
      [
        doc('lost', 'PASSPORT', '2017-01-01', '2026-12-01', 'lost'),
        doc('nodate', 'HEALTH_CARD', '2020-01-01', null),
      ],
      today,
    );
    expect(expiryAlerts(person, series, today)).toEqual([]);
  });
});

describe('isOutdated', () => {
  it('is outdated when expired or older than the version you have', () => {
    const have = [doc('p', 'PASSPORT', '2024-05-01', '2034-05-01')];
    expect(
      isOutdated(
        { issueDate: '2014-05-01', expiryDate: '2027-01-01' },
        'PASSPORT',
        have,
        '2026-11-06',
      ),
    ).toBe(true);
    expect(
      isOutdated(
        { issueDate: '2025-01-01', expiryDate: '2026-01-01' },
        'IDENTITY_CARD',
        [],
        '2026-11-06',
      ),
    ).toBe(true);
    expect(
      isOutdated(
        { issueDate: '2025-01-01', expiryDate: '2035-01-01' },
        'PASSPORT',
        have,
        '2026-11-06',
      ),
    ).toBe(false);
  });

  it('counts days across months', () => {
    expect(daysUntil('2027-04-25', '2026-11-06')).toBe(170);
  });
});

describe('mergedValues', () => {
  it('keeps the person merged into and takes only what they do not know', () => {
    const into = { ...empty, lastName: 'ROSSI', firstName: 'MARIA' };
    const from = {
      ...empty,
      lastName: 'ROSSI',
      firstName: 'MARIA GRAZIA',
      birthPlace: 'VERONA',
    };
    expect(mergedValues(into, from)).toEqual({
      values: { ...into, birthPlace: 'VERONA' },
      taken: ['birthPlace'],
    });
  });

  it('never merges two different tax codes', () => {
    expect(
      mergedValues(
        { ...empty, taxCode: 'RSSMRA80A41L781X' },
        { ...empty, taxCode: 'BNCLRA85B50F205Y' },
      ),
    ).toEqual({ conflict: 'taxCode' });
    expect(
      mergedValues({ ...empty }, { ...empty, taxCode: 'BNCLRA85B50F205Y' }),
    ).toMatchObject({ taken: ['taxCode'] });
  });
});
