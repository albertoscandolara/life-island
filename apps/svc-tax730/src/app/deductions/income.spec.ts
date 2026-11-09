import { describe, expect, it } from 'vitest';
import { estimateDeductions } from './deduction-estimate.js';
import { certificatesOf, type CertificateSource } from './income.js';

// Made-up employers and amounts.
const cu = (
  uploadId: string,
  fields: Record<string, string | number | null>,
  uploadedAt = '2025-03-10',
): CertificateSource => ({
  uploadId,
  title: `CU ${uploadId}`,
  categories: ['CERTIFICAZIONE_UNICA'],
  fields: {
    employer: 'ESEMPIO LAVORI S.R.L.',
    employer_tax_code: '01234567890',
    income_year: 2025,
    employment_income: '30.000,00',
    irpef_withheld: 5000,
    net_tax: 5000,
    ...fields,
  },
  uploadedAt: new Date(uploadedAt),
});

const expense = (expenseType: string, amount: number) => ({
  taxYear: 2025,
  expenseType,
  amount,
  traceablePayment: true,
  beneficiaryFiscalCode: null,
});

describe('certificatesOf', () => {
  it('keeps the CUs of the year, the later one of each employer', () => {
    const certificates = certificatesOf(2025, [
      cu('first', { net_tax: 4000 }),
      cu('corrected', { net_tax: 4100 }, '2025-04-01'),
      cu('other-year', { income_year: '2024' }),
      cu('second-job', {
        employer: 'Altro Datore S.p.A.',
        employer_tax_code: '09876543210',
        employment_income: 5000,
        net_tax: 200,
      }),
      { ...cu('not-a-cu', {}), categories: ['PAYSLIP'] },
    ]);
    expect(certificates.map((c) => c.uploadId).sort()).toEqual([
      'corrected',
      'second-job',
    ]);
    expect(certificates.find((c) => c.uploadId === 'corrected')).toMatchObject({
      income: 30000,
      netTax: 4100,
    });
  });
});

describe('estimateDeductions with the income', () => {
  it('gives no income without a CU', () => {
    expect(estimateDeductions(2025, [expense('medical', 1000)]).income).toBe(
      null,
    );
  });

  it('caps the tax back at the net tax (capienza)', () => {
    const certificates = certificatesOf(2025, [
      cu('cu', { employment_income: 9000, net_tax: 100 }),
    ]);
    const result = estimateDeductions(
      2025,
      [expense('medical', 2129.11)],
      certificates,
    );
    expect(result.thisYear).toBe(380);
    expect(result.income).toMatchObject({
      income: 9000,
      netTax: 100,
      band: 'normal',
      refund: 100,
      lost: 280,
    });
    expect(result.income?.notes[0]).toContain('only 100,00 € comes back');
  });

  it('warns above €75,000 and €120,000', () => {
    const over75 = estimateDeductions(
      2025,
      [expense('medical', 1000)],
      certificatesOf(2025, [
        cu('cu', { employment_income: 80000, net_tax: 20000 }),
      ]),
    ).income;
    expect(over75?.band).toBe('over_75k');
    expect(over75?.refund).toBe(165.47);
    expect(over75?.notes.join(' ')).toContain('above 75.000,00 €');
    const over120 = estimateDeductions(
      2025,
      [],
      certificatesOf(2025, [
        cu('cu', { employment_income: 130000, net_tax: 40000 }),
      ]),
    ).income;
    expect(over120?.band).toBe('over_120k');
    expect(over120?.notes.join(' ')).toContain('above 120.000,00 €');
  });
});
