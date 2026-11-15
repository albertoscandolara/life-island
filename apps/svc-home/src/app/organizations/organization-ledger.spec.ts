import {
  issuedByBank,
  issuedByInsurer,
  looksLikeBank,
  looksLikeInsurer,
} from './organization-ledger.js';

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

describe('insurers', () => {
  it('knows an insurer by its name', () => {
    for (const name of [
      'Generali Italia S.p.A.',
      'UnipolSai Assicurazioni',
      'Allianz Direct',
      'AXA Assicurazioni',
      'Reale Mutua',
      'Prima Assicurazioni',
      'Zurich Insurance',
      'Genertel',
    ])
      expect(looksLikeInsurer(name)).toBe(true);
    for (const name of ['Arcoda', 'Banca Widiba', 'Edilnord', 'Luce Verde'])
      expect(looksLikeInsurer(name)).toBe(false);
  });

  it('knows a policy, car or house, also filed under a subcategory', () => {
    const parentOf = new Map([['RCA_2026', 'CAR_INSURANCE']]);
    expect(issuedByInsurer({ categories: ['HOME_INSURANCE'] }, parentOf)).toBe(
      true,
    );
    expect(issuedByInsurer({ categories: ['RCA_2026'] }, parentOf)).toBe(true);
    expect(issuedByInsurer({ categories: ['INVOICE'] }, parentOf)).toBe(false);
  });
});
