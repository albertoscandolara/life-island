import { parseBankCsv, readAmount, readDate } from './bank-csv';

describe('parseBankCsv', () => {
  it('reads an Italian export with a title, Dare and Avere', () => {
    const csv = [
      'Estratto conto;;;;',
      'Data;Data valuta;Dare;Avere;Descrizione',
      '31/01/2026;31/01/2026;;2.150,00;"Stipendio; gennaio"',
      '02/02/2026;02/02/2026;12,99;;NETFLIX.COM',
      ';;;;',
    ].join('\n');
    const read = parseBankCsv(csv);
    expect(read.error).toBeNull();
    expect(read.rows).toEqual([
      { date: '2026-01-31', amount: 2150, description: 'Stipendio; gennaio' },
      { date: '2026-02-02', amount: -12.99, description: 'NETFLIX.COM' },
    ]);
  });

  it('reads an English export with one signed amount', () => {
    const read = parseBankCsv('Date,Description,Amount\n2026-03-01,Coffee,-1.20\n2026-03-02,Refund,"1,000.50"');
    expect(read.rows.map((r) => r.amount)).toEqual([-1.2, 1000.5]);
  });

  it('says what is missing', () => {
    expect(parseBankCsv('Foo,Bar\n1,2').error).toMatch(/header/);
  });

  it('reads amounts and dates', () => {
    expect(readAmount('-1.234,56 €')).toBe(-1234.56);
    expect(readAmount('abc')).toBeNull();
    expect(readDate('5/3/26')).toBe('2026-03-05');
    expect(readDate('31/13/2026')).toBeNull();
  });
});
