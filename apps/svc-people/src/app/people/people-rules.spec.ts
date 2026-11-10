import {
  ageOn,
  buildSeries,
  expiryAlerts,
  licenceSummary,
  parseCategoryExpiries,
  personNotices,
  readIdDocument,
  type NoticeDocument,
} from './id-documents.js';
import { relationOf, storedRelation } from './people.service.js';
import {
  checkCharacter,
  checkTaxCode,
  firstNameCode,
  lastNameCode,
} from './tax-code.js';

describe('checkTaxCode', () => {
  const mario = {
    taxCode: 'RSSMRA80A01H501U',
    lastName: 'ROSSI',
    firstName: 'MARIO',
    birthDate: '1980-01-01',
    sex: 'M',
  };

  it('computes the check character of a known code', () => {
    expect(checkCharacter('RSSMRA80A01H501')).toBe('U');
  });

  it('builds the name letters as the law does', () => {
    expect(lastNameCode('Rossi')).toBe('RSS');
    expect(lastNameCode('Fo')).toBe('FOX');
    expect(lastNameCode("D'Angelo")).toBe('DNG');
    // Four consonants or more: the 1st, 3rd and 4th.
    expect(firstNameCode('Gianfranco')).toBe('GFR');
    expect(firstNameCode('Maria')).toBe('MRA');
    expect(firstNameCode('Nicolò')).toBe('NCL');
  });

  it('accepts a code that agrees with the person', () => {
    expect(checkTaxCode(mario)).toEqual({ status: 'valid', problems: [] });
  });

  it('says nothing without a code', () => {
    expect(checkTaxCode({ ...mario, taxCode: null }).status).toBe('unknown');
  });

  it('catches a misread character through the check character', () => {
    const check = checkTaxCode({ ...mario, taxCode: 'RSSMRA80A01H5O1U' });
    expect(check.status).toBe('invalid');
    const typo = checkTaxCode({ ...mario, taxCode: 'RSSMRA80A02H501U' });
    expect(typo.status).toBe('invalid');
    expect(typo.problems[0]).toMatch(/last character should be/);
  });

  it('names what disagrees: birth date, sex, names', () => {
    const check = checkTaxCode({
      ...mario,
      birthDate: '1980-02-01',
      sex: 'F',
      firstName: 'LUIGI',
    });
    expect(check.status).toBe('mismatch');
    expect(check.problems).toHaveLength(3);
  });

  it('reads a woman’s day and an omocodia code', () => {
    const code = 'BNCMRA85C55L781';
    const anna = {
      taxCode: code + checkCharacter(code),
      lastName: 'Bianchi',
      firstName: 'Maria',
      birthDate: '1985-03-15',
      sex: 'F',
    };
    expect(checkTaxCode(anna).status).toBe('valid');
    // 1 → M in the last digit of the place code.
    const omocode = 'BNCMRA85C55L78M';
    expect(
      checkTaxCode({ ...anna, taxCode: omocode + checkCharacter(omocode) })
        .status,
    ).toBe('valid');
  });
});

describe('ID document details', () => {
  it('reads the card details and the licence table', () => {
    const reading = readIdDocument({
      expiry_date: '2030-05-01',
      height_cm: '178',
      card_format: 'Electronic',
      card_access_number: '123 456',
      valid_for_travel: false,
      licence_categories: 'AM, B, C',
      category_expiries: 'C: 2027-01-31, D 01/02/2028',
      restriction_codes: '01.06, 78',
    });
    expect(reading.details).toMatchObject({
      heightCm: 178,
      cardFormat: 'electronic',
      cardAccessNumber: '123456',
      validForTravel: false,
    });
    expect(
      reading.details.licenceCategories.map((c) => [c.category, c.expiryDate]),
    ).toEqual([
      ['AM', '2030-05-01'],
      ['B', '2030-05-01'],
      ['C', '2027-01-31'],
      ['D', '2028-02-01'],
    ]);
    expect(reading.details.restrictionCodes).toEqual([
      { code: '01.06', meaning: 'Must wear glasses or contact lenses' },
      { code: '78', meaning: 'Automatic transmission only' },
    ]);
  });

  it('ignores what is not a category date', () => {
    expect([...parseCategoryExpiries('nothing here, B: soon')]).toEqual([]);
  });
});

const today = '2026-11-10';

function licence(
  expiryDate: string,
  categories: { category: string; expiryDate: string | null }[],
): NoticeDocument {
  return {
    uploadId: 'lic',
    type: 'DRIVING_LICENCE',
    issueDate: '2020-01-01',
    expiryDate,
    uploadedAt: '2020-01-02T00:00:00.000Z',
    markedStatus: null,
    validForTravel: null,
    categories: categories.map((c) => ({ ...c, meaning: null })),
  };
}

describe('licence categories', () => {
  const person = { id: 'p', firstName: 'A', lastName: 'B' };

  it('warns for a category that expires before the licence', () => {
    const series = buildSeries(
      [
        licence('2032-01-01', [
          { category: 'B', expiryDate: '2032-01-01' },
          { category: 'C', expiryDate: '2027-01-01' },
        ]),
      ],
      today,
    );
    expect(
      expiryAlerts(person, series, today).map((a) => [a.category, a.daysLeft]),
    ).toEqual([['C', 52]]);
    expect(licenceSummary(series, today)).toMatchObject({
      status: 'valid',
      categories: ['B', 'C'],
    });
  });

  it('drops expired categories from what you may drive', () => {
    const series = buildSeries(
      [
        licence('2026-12-01', [
          { category: 'B', expiryDate: '2026-12-01' },
          { category: 'C', expiryDate: '2026-01-01' },
        ]),
      ],
      today,
    );
    expect(licenceSummary(series, today)).toMatchObject({
      status: 'expiring',
      daysLeft: 21,
      categories: ['B'],
    });
    expect(licenceSummary([], today)).toBeNull();
  });
});

describe('personNotices', () => {
  const card = (validForTravel: boolean | null): NoticeDocument => ({
    uploadId: 'cie',
    type: 'IDENTITY_CARD',
    issueDate: '2020-01-01',
    expiryDate: '2030-01-01',
    uploadedAt: '2020-01-02T00:00:00.000Z',
    markedStatus: null,
    validForTravel,
  });

  it('warns about an identity card not valid for travel', () => {
    const notices = personNotices(
      { birthDate: '1990-01-01' },
      buildSeries([card(false)], today),
      today,
    );
    expect(notices.map((n) => n.level)).toEqual(['warning', 'info']);
    expect(notices[0].text).toMatch(/not valid for travel/);
  });

  it('explains a minor’s rules and a coming 18th birthday', () => {
    const notices = personNotices(
      { birthDate: '2009-01-20' },
      buildSeries([card(true)], today),
      today,
    );
    expect(notices.map((n) => n.text)).toEqual([
      expect.stringMatching(/health card/),
      expect.stringMatching(/^Under 18/),
      expect.stringMatching(/^Turns 18 in 71 days/),
    ]);
  });

  it('computes ages', () => {
    expect(ageOn('2009-01-20', today)).toBe(17);
    expect(ageOn('2009-11-10', today)).toBe(17);
    expect(ageOn(null, today)).toBeNull();
  });
});

describe('relations', () => {
  it('stores a pair once and reads it from both sides', () => {
    const row = storedRelation('kid', { personId: 'mum', kind: 'parent' });
    expect(row).toEqual({ personId: 'mum', relatedId: 'kid', kind: 'parent' });
    expect(relationOf(row, 'kid')).toEqual({ personId: 'mum', kind: 'parent' });
    expect(relationOf(row, 'mum')).toEqual({ personId: 'kid', kind: 'child' });
    expect(relationOf(row, 'other')).toBeNull();
    const partners = storedRelation('b', { personId: 'a', kind: 'partner' });
    expect(partners).toEqual({
      personId: 'a',
      relatedId: 'b',
      kind: 'partner',
    });
    expect(relationOf(partners, 'b')).toEqual({
      personId: 'a',
      kind: 'partner',
    });
  });
});
