import { issuedByBank, looksLikeBank } from './organization-ledger.js';

describe('banks', () => {
  it('knows a bank by its name', () => {
    for (const name of [
      'Banca Widiba',
      'BANCA WIDIBA S.P.A.',
      'Banco BPM',
      'FinecoBank',
      'ING Bank N.V.',
      'BCC di Roma',
      'Cassa di Risparmio di Asti',
      'Credito Emiliano',
      'Poste Italiane - BancoPosta',
    ])
      expect(looksLikeBank(name)).toBe(true);
    for (const name of ['Arcoda', 'Bancone Arredi', 'Edilnord', 'Banksy Art'])
      expect(looksLikeBank(name)).toBe(false);
  });

  it('knows a bank statement, also filed under a subcategory', () => {
    const parentOf = new Map([['WIDIBA_STATEMENT', 'BANK_STATEMENT']]);
    expect(issuedByBank({ categories: ['ESTRATTO_CONTO'] }, parentOf)).toBe(
      true,
    );
    expect(issuedByBank({ categories: ['WIDIBA_STATEMENT'] }, parentOf)).toBe(
      true,
    );
    expect(issuedByBank({ categories: ['INVOICE'] }, parentOf)).toBe(false);
  });
});
