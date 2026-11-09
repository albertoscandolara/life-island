import {
  buildStats,
  buildTimeline,
  countedPayslips,
  documentIdentity,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';
import { buildCertificates } from './certificates.js';
import { payslipKindOf, readWorkDocument } from './work-documents.js';

// Anonymized, made-up amounts.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: { employerName: 'ESEMPIO LAVORI S.R.L.', hireDate: '2024-03-01' },
};

const payslip = (
  id: string,
  month: string,
  extra: Record<string, string | number | null> = {},
): ApprovedWorkDocument => ({
  uploadId: id,
  title: `Payslip ${id}`,
  workplaceId: 'w1',
  reading: readWorkDocument('PAYSLIP', {
    employer: 'ESEMPIO LAVORI S.R.L.',
    pay_period: `2024-${month}`,
    gross_pay: 2000,
    net_pay: 1500,
    taxable_income: 1800,
    income_tax_withheld: 300,
    monthly_salary: 2000,
    ...extra,
  }),
});

const certificate = (
  id: string,
  extra: Record<string, string | number | null> = {},
): ApprovedWorkDocument => ({
  uploadId: id,
  title: `CU ${id}`,
  workplaceId: 'w1',
  reading: readWorkDocument('CERTIFICAZIONE_UNICA', {
    employer: 'ESEMPIO LAVORI S.R.L.',
    income_year: 2024,
    employment_income: '20.000,00',
    irpef_withheld: 3500,
    regional_surtax: 300,
    municipal_surtax: 100,
    gross_tax: 4800,
    total_deductions: 1300,
    net_tax: 3500,
    ...extra,
  }),
});

const months = ['03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const year = months.map((m) => payslip(`u-${m}`, m));
const tredicesima = payslip('u-13', '12', {
  payslip_kind: 'thirteenth',
  gross_pay: 1700,
  net_pay: 1200,
  taxable_income: 1550,
  income_tax_withheld: 350,
  monthly_salary: 2000,
});

describe('payslip kind', () => {
  it('reads the kind, and the words a model may write instead', () => {
    expect(payslipKindOf('thirteenth')).toBe('thirteenth');
    expect(payslipKindOf("13.MA MENSILITA'")).toBe('thirteenth');
    expect(payslipKindOf('Tredicesima')).toBe('thirteenth');
    expect(payslipKindOf('quattordicesima')).toBe('fourteenth');
    expect(payslipKindOf('Premio')).toBe('other');
    expect(payslipKindOf(null)).toBe('regular');
    expect(tredicesima.reading.facts).toContainEqual({
      label: 'Kind',
      value: 'Tredicesima (13th month)',
    });
  });
});

describe('copies of a payslip', () => {
  it('counts a renamed copy once, and a tredicesima apart from December', () => {
    const copy = { ...year[9], uploadId: 'copy', title: 'renamed.pdf' };
    const counted = countedPayslips([...year, copy, tredicesima]);
    expect(counted).toHaveLength(11);
    expect(counted.map((d) => d.uploadId)).not.toContain('copy');
    expect(counted.map((d) => d.uploadId)).toContain('u-13');
  });

  it('tells what a document is the one of', () => {
    expect(documentIdentity('w1', year[9].reading)?.what).toBe(
      'the payslip for Dec 2024',
    );
    expect(documentIdentity('w1', tredicesima.reading)?.what).toBe(
      'the tredicesima (13th month) for Dec 2024',
    );
    expect(documentIdentity('w1', year[9].reading)?.key).not.toBe(
      documentIdentity('w1', tredicesima.reading)?.key,
    );
    expect(documentIdentity('w1', certificate('c').reading)?.what).toBe(
      'the Certificazione Unica for 2024',
    );
  });

  it('keeps the tredicesima out of the monthly chart and in the extra pay', () => {
    const copy = { ...year[0], uploadId: 'copy' };
    const stats = buildStats(
      [workplace],
      [...year, copy, tredicesima],
      [],
      '2025-01-15',
    );
    expect(stats.payslips).toBe(11);
    expect(stats.monthly).toHaveLength(10);
    expect(stats.missingMonths).toEqual([]);
    expect(stats.years[0]).toMatchObject({
      year: 2024,
      payslips: 11,
      gross: 21700,
      extraPay: 1700,
    });
  });

  it('keeps the tredicesima off the timeline, and is no salary change', () => {
    const timeline = buildTimeline([workplace], [...year, tredicesima], []);
    expect(timeline.map((e) => e.kind)).toEqual(['hired']);
  });
});

describe('Certificazione Unica', () => {
  it('reads the CU', () => {
    const cu = certificate('c').reading;
    expect(cu.certificate).toEqual({
      year: 2024,
      income: 20000,
      days: null,
      irpefWithheld: 3500,
      regionalSurtax: 300,
      municipalSurtax: 100,
      grossTax: 4800,
      totalDeductions: 1300,
      netTax: 3500,
    });
    expect(cu.values).toEqual({ employerName: 'ESEMPIO LAVORI S.R.L.' });
  });

  it('compares the CU with the payslips of the year', () => {
    const [cu] = buildCertificates(
      [workplace],
      [...year, tredicesima, certificate('c'), certificate('copy')],
    );
    expect(cu).toMatchObject({
      year: 2024,
      payslips: 11,
      missingMonths: [],
      payslipIncome: 19550,
      payslipIncomeKind: 'taxable',
      incomeGap: 450,
      payslipIncomeTax: 3350,
      taxGap: 150,
      surtaxes: 400,
    });
  });

  it('names the months without a payslip', () => {
    const certificates = buildCertificates(
      [workplace],
      [...year.filter((p) => p.reading.period !== '2024-07'), certificate('c')],
    );
    expect(certificates).toHaveLength(1);
    expect(certificates[0].missingMonths).toEqual(['2024-07']);
  });
});

describe('level changes on the timeline', () => {
  it('shows a promotion, not a level change that is neither higher nor better paid', () => {
    const down = buildTimeline(
      [workplace],
      [
        payslip('a', '03', { job_level: 'B1' }),
        payslip('b', '04', { job_level: 'C3' }),
      ],
      [],
    );
    expect(down.map((e) => e.kind)).toEqual(['hired']);
    const up = buildTimeline(
      [workplace],
      [
        payslip('a', '03', { job_level: 'C3' }),
        payslip('b', '04', { job_level: 'B1' }),
      ],
      [],
    );
    expect(up.map((e) => e.kind)).toEqual(['promotion', 'hired']);
  });
});
