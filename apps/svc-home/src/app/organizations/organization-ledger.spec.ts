import {
  issuedByBank,
  issuedByInsurer,
  looksLikeBank,
  looksLikeInsurer,
  looksLikeProfessional,
  looksLikePublicBody,
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

describe('public bodies', () => {
  it('knows a public body by its name', () => {
    for (const name of [
      'Ministero delle Infrastrutture e dei Trasporti',
      'MINISTRO AFFARI ESTERI E COOPERAZIONE INTERNAZIONALE',
      'Comune di Verona',
      'Agenzia delle Entrate',
      'INPS',
      'Regione del Veneto',
      'Azienda Sanitaria Locale',
      'Motorizzazione Civile di Verona',
    ])
      expect(looksLikePublicBody(name)).toBe(true);
    for (const name of [
      'Arcoda',
      'Banca Widiba',
      'Agenzia Immobiliare Rossi',
      'Pizzeria Comune',
      'Allianz Direct',
    ])
      expect(looksLikePublicBody(name)).toBe(false);
  });
});

describe('professional services', () => {
  it('knows a professional service by its name', () => {
    for (const name of [
      'Notaio Chiliberti Avv. Giuseppe',
      'Studio Legale Rossi & Associati',
      'Avv. Maria Bianchi',
      'Dott. Commercialista Luca Verdi',
      'Studio Commerciale Neri',
      'Agenzia Immobiliare Il Portico',
      'Tecnocasa Verona Borgo Trento',
      'RE/MAX Prestige',
      'Geom. Paolo Gialli',
      'Acme Consulting S.r.l.',
    ])
      expect(looksLikeProfessional(name)).toBe(true);
    for (const name of [
      'Arcoda',
      'ING Bank',
      'Banca Widiba',
      'Ministero delle Infrastrutture e dei Trasporti',
      'Leso Elettrodomestici',
      'Unitycasa di Romio Eddy',
    ])
      expect(looksLikeProfessional(name)).toBe(false);
  });
});
