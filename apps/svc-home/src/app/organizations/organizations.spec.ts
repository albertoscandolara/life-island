import { describe, expect, it } from 'vitest';
import type { OrganizationRow } from '../db/schema.js';
import { possibleDuplicates } from './organizations.js';

const org = (
  id: string,
  name: string,
  aliases: string[] = [],
): OrganizationRow =>
  ({
    id,
    name,
    nameKey: name.toLowerCase(),
    aliases,
    taxCode: null,
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
});
