import { describe, expect, it } from 'vitest';
import type { OrganizationRow } from '../db/schema.js';
import { possibleDuplicates } from './organizations.js';

const org = (
  id: string,
  name: string,
  aliases: string[] = [],
  taxCode: string | null = null,
): OrganizationRow =>
  ({
    id,
    name,
    nameKey: name.toLowerCase(),
    aliases,
    taxCode,
    vatNumber: null,
    mergedCodes: [],
    roles: [],
    status: 'CONFIRMED',
    createdAt: new Date(0),
  }) as unknown as OrganizationRow;

describe('possibleDuplicates', () => {
  it('suggests merging two companies whose names look alike', () => {
    const found = possibleDuplicates([
      org('a', 'Elektrosystem'),
      org('b', 'Elektrosistem'),
    ]);
    expect(found.get('a')).toEqual([{ id: 'b', name: 'Elektrosistem' }]);
  });

  it('names the one name in the wrong company, never the whole company', () => {
    // The foreign ministry's name was merged into the transport ministry.
    const transport = org(
      'mit',
      'Ministero delle Infrastrutture e dei Trasporti',
      ['MINISTERO AFFARI ESTERI E COOPERAZIONE INTERNAZIONALE'],
    );
    const foreign = org(
      'maeci',
      'MINISTRO AFFARI ESTERI E COOPERAZIONE INTERNAZIONALE',
    );
    const found = possibleDuplicates([transport, foreign]);
    expect(found.get('maeci')).toEqual([
      {
        id: 'mit',
        name: transport.name,
        theirs: 'MINISTERO AFFARI ESTERI E COOPERAZIONE INTERNAZIONALE',
      },
    ]);
    expect(found.get('mit')).toEqual([
      {
        id: 'maeci',
        name: foreign.name,
        mine: 'MINISTERO AFFARI ESTERI E COOPERAZIONE INTERNAZIONALE',
      },
    ]);
  });

  it('suggests one company printed with and without spaces, codes apart', () => {
    // Wind Tre's codice fiscale is not its VAT number: one bill read each.
    const found = possibleDuplicates([
      org('w', 'Wind Tre S.p.A.', [], '02517580920'),
      org('x', 'WINDTRE', [], '13378520152'),
      org('h', 'Hera Comm S.p.A.', [], '02221101203'),
    ]);
    expect(found.get('x')).toEqual([{ id: 'w', name: 'Wind Tre S.p.A.' }]);
    expect(found.get('h')).toBeUndefined();
  });

  it('never suggests a typo apart when the codes differ', () => {
    const found = possibleDuplicates([
      org('a', 'Elektrosystem', [], '01234567890'),
      org('b', 'Elektrosistem', [], '09876543210'),
    ]);
    expect(found.size).toBe(0);
  });
});
