import { italianAmount, readPayslipText } from './payslip-reader.js';

// Anonymized: the text layer of a two-page LUL as normalize.ts rebuilds it,
// with made-up names, codes and amounts.
const PAGE = (totals: string) =>
  [
    'POS. INPS  MESE DI RETRIBUZIONE',
    'GIUGNO 2026',
    'ESEMPIO LAVORI S.R.L.',
    'C.F.:  01234567890',
    'P.IVA:  01234567890',
    'COD.DIP.',
    'COGNOME E NOME  CODICE FISCALE  NATO A',
    '12345  IL',
    'ROSSI MARIO  RSSMRA80A01H501U  ROMA (RM)  01/01/1980',
    'ASSUNZIONE  ANZ. CONV.  SCADENZA CONTR.  FINE RAPPORTO  CENTRO DI COSTO  SEDE DI LAVORO',
    'ANNI  MESI',
    '1/03/2020  1/03/2020  100  DIPENDENTI  1  VIA ROMA 1',
    "MODALITA' DI PAGAMENTO  RIFERIMENTI BANCARI  MANSIONE  SCATTI ANZIANITA'  LIVELLO  % PART TIME",
    'DATA',
    'BONIFICO BANCARIO  IT00 X000 0000 0000 0000 0000 000  N.',
    '2  1/08/2026  C3',
    'RETRIBUZIONE ORARIA  RETRIBUZIONE GIORNALIERA  RETRIBUZIONE MENSILE',
    '14,00000  95,00000  2.450,00',
    '* = C - Imponibile contributivo ; N - Considerato nel netto in busta',
    'A  TABELLA  N.COMPON.  TOTALE COMPETENZE  TOTALE TRATTENUTE  ARR. PRECED.  ARR. ATTUALE  NETTO IN BUSTA',
    'T',
    totals,
  ].join('\n');

describe('readPayslipText', () => {
  it('reads the boxes of a payslip under their headers, totals from the last page', () => {
    const text = `${PAGE('SEGUE')}\n\n${PAGE('F  2.600,10  650,05  1.950,05')}`;
    expect(readPayslipText(text)).toEqual({
      employer_tax_code: '01234567890',
      employee_code: '12345',
      hire_date: '2020-03-01',
      job_level: 'C3',
      monthly_salary: 2450,
      gross_pay: 2600.1,
      total_deductions: 650.05,
      net_pay: 1950.05,
    });
  });

  it('leaves what it cannot find as null', () => {
    expect(readPayslipText('Busta paga di marzo')).toMatchObject({
      employer_tax_code: null,
      job_level: null,
      net_pay: null,
    });
  });

  it('reads Italian amounts, rounding five decimals to cents', () => {
    expect(italianAmount('2.313,34000')).toBe(2313.34);
    expect(italianAmount('64,86')).toBe(64.86);
  });
});
