import {
  italianAmount,
  readPayslipText,
  readExtraMonth,
  readTfrMonth,
  readWelfareCredits,
} from './payslip-reader.js';

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
      welfare_credits: null,
      payslip_kind: null,
      severance_accrued: null,
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

describe('readWelfareCredits', () => {
  it('sums every welfare line of the month, art. 100 and CCNL alike', () => {
    const text = [
      '001 Retribuzione  2.450,00',
      '333 Welfare convers. benefit art.100 (no netto) 888,56',
      '370 WELFARE CCNL NO FRINGE 250,00',
    ].join('\n');
    expect(readWelfareCredits(text)).toBe(1138.56);
  });

  it('takes the amount, not the year printed on the line', () => {
    expect(
      readWelfareCredits(
        '337 Welfare convers. benefit art.51 c.3 (no netto) 2026 983,15 * *',
      ),
    ).toBe(983.15);
  });

  it('counts a line repeated on a second page once, and skips deductions', () => {
    const line = '370 WELFARE CCNL NO FRINGE 250,00';
    const text = [line, 'Trattenuta conversione welfare 500,00', line].join(
      '\n',
    );
    expect(readWelfareCredits(text)).toBe(250);
  });

  it('is null on a payslip without welfare', () => {
    expect(readWelfareCredits('001 Retribuzione  2.450,00')).toBeNull();
  });
});

describe('readExtraMonth', () => {
  it('reads a tredicesima printed as Mens.supplementare 12', () => {
    expect(
      readExtraMonth('ARCODA  8306794997  Mens.supplementare 12/2025'),
    ).toBe('thirteenth');
    expect(readExtraMonth('MENS. SUPPLEMENTARE 6/2025')).toBe('fourteenth');
  });

  it('leaves a monthly payslip alone, even when it pays the 13th', () => {
    expect(
      readExtraMonth("DICEMBRE 2025\n250 13.ma mensilita'  2.248,10"),
    ).toBeNull();
  });
});

describe('readTfrMonth', () => {
  it('picks TFR MESE, not the 0.5% contribution next to it', () => {
    const text = [
      'RETRIBUZIONE UTILE TFR  CONTR. AGG. TFR  TFR MESE  TFR ANNUO PROGR.  F.DO TFR 31/12 AP',
      'T',
      '2.248,10  11,24  155,29  2.015,95  10.614,90  12.630,85',
    ].join('\n');
    expect(readTfrMonth(text)).toBe(155.29);
    expect(readTfrMonth('2.649,07  13,25  182,98  1.694,19')).toBe(182.98);
  });

  it('is null when no three amounts add up that way', () => {
    expect(readTfrMonth('TFR MESE 155,29')).toBeNull();
  });
});
