import { likelySamePerson } from './duplicates.js';

const person = (
  id: string,
  firstName: string,
  lastName: string,
  extra: { birthDate?: string; taxCode?: string } = {},
) => ({
  id,
  firstName,
  lastName,
  birthDate: extra.birthDate ?? null,
  taxCode: extra.taxCode ?? null,
});

describe('likelySamePerson', () => {
  it('sees the same name printed differently', () => {
    const a = person('a', 'Nicolò', "D'Angelo", { birthDate: '1990-01-01' });
    expect(likelySamePerson(a, person('b', 'NICOLO', 'DANGELO'))).toBe(true);
    expect(likelySamePerson(a, person('c', 'DANGELO', 'NICOLO'))).toBe(true);
  });

  it('tells people apart by birth date or tax code', () => {
    const a = person('a', 'Mario', 'Rossi', { birthDate: '1990-01-01' });
    expect(
      likelySamePerson(
        a,
        person('b', 'Mario', 'Rossi', { birthDate: '1960-05-05' }),
      ),
    ).toBe(false);
    expect(
      likelySamePerson(
        person('c', 'Mario', 'Rossi', { taxCode: 'RSSMRA90A01L781X' }),
        person('d', 'Mario', 'Rossi', { taxCode: 'RSSMRA60E05L781Y' }),
      ),
    ).toBe(false);
    expect(likelySamePerson(a, person('e', 'Maria', 'Bianchi'))).toBe(false);
  });
});
