import {
  taxReturnDeadline,
  type Tax730CertificateDto,
  type Tax730DeductionsDto,
} from '@life-island/contracts';
import type { CertificateSource } from './income.js';
import {
  compareReturn,
  deadlinesOf,
  employmentCredits,
  expectedForm,
  forecastOf,
  grossIrpef,
  payslipsOf,
  readReturn,
  returnsOf,
  taxReturnOf,
} from './returns.js';

const doc = (
  fields: CertificateSource['fields'],
  over: Partial<CertificateSource> = {},
): CertificateSource => ({
  uploadId: '00000000-0000-4000-8000-000000000001',
  title: 'Redditi PF 2026',
  categories: ['TAX_RETURN'],
  fields,
  uploadedAt: new Date('2026-11-16T10:00:00Z'),
  ...over,
});

/** The Redditi PF 2026 (2025 income) as the AI reads it from quadri RN, RV and RX. */
const pf2026 = doc({
  form_type: 'redditi_pf',
  tax_year: 2025,
  filed_on: '2026-09-18',
  filing_id: '15360769297 - 0000004',
  employment_income: '26416',
  total_income: 26948,
  main_home_deduction: 532,
  deductible_expenses: 0,
  taxable_income: 26416,
  gross_tax: 6076,
  work_family_deductions: 2338,
  expense_deductions_19: 190,
  renovation_deductions: 4286,
  other_home_deductions: 14,
  total_deductions: 6828,
  net_tax: 0,
  irpef_withheld: 3274,
  advances_paid: 404,
  irpef_due: 0,
  irpef_credit: 3678,
  regional_surtax_credit: 325,
  municipal_surtax_credit: 211,
  next_advance_first: 0,
  next_advance_second: 0,
});

/** The Redditi PF 2025 (2024 income): 404 € to pay, and advances for 2025. */
const pf2025 = doc(
  {
    form_type: 'Redditi PF',
    tax_year: '2024',
    filed_on: '11/9/2025',
    total_income: 27997,
    taxable_income: 27997,
    gross_tax: 6439,
    work_family_deductions: 1477,
    expense_deductions_19: 94,
    total_deductions: 1571,
    net_tax: 4868,
    irpef_withheld: 4464,
    irpef_due: 404,
    regional_surtax_due: 0,
    next_advance_first: 161.6,
    next_advance_second: 242.4,
  },
  {
    uploadId: '00000000-0000-4000-8000-000000000002',
    title: 'Redditi PF 2025',
  },
);

const cu2025: Tax730CertificateDto = {
  uploadId: 'cu',
  title: 'CU 2026',
  employer: 'ACME SPA',
  income: 26416,
  irpefWithheld: 3274,
  netTax: 4567,
  pensionFundDeducted: null,
  pensionFundNotDeducted: null,
  workDeductions: 2338,
  familyDeductions: 0,
};

const line = (
  group: Tax730DeductionsDto['lines'][number]['group'],
  deduction: number,
) => ({ group, deduction }) as unknown as Tax730DeductionsDto['lines'][number];

describe('reading a filed return', () => {
  it('reads the Redditi PF figures and what is left to do', () => {
    const filed = readReturn(pf2026);
    expect(filed).toMatchObject({
      form: 'redditi_pf',
      formLabel: 'Redditi PF',
      taxYear: 2025,
      filedOn: '2026-09-18',
      irpefCredit: 3678,
      surtaxCredit: 536,
      result: -4214,
    });
    expect(filed?.figures).toEqual({
      income: 26416,
      deductibleExpenses: 0,
      taxableIncome: 26416,
      grossTax: 6076,
      workDeductions: 2338,
      expenseDeductions: 4490,
      netTax: 0,
      irpefWithheld: 3274,
      advancesPaid: 404,
      balance: -3678,
    });
    expect(filed?.notes.join(' ')).toMatch(/use it in an F24/);
  });

  it('reads Italian dates and a written form name', () => {
    const filed = readReturn(pf2025);
    expect(filed).toMatchObject({ form: 'redditi_pf', filedOn: '2025-09-11' });
    expect(filed?.notes.join(' ')).toMatch(/404,00 € to pay with F24/);
  });

  it('keeps the later filing of a year (a correction)', () => {
    const correction = doc(
      { ...pf2026.fields, filed_on: '2026-10-20', irpef_credit: 3600 },
      { uploadId: '00000000-0000-4000-8000-000000000003' },
    );
    const returns = returnsOf([correction, pf2026, pf2025]);
    expect([...returns.keys()].sort()).toEqual([2024, 2025]);
    expect(returns.get(2025)?.irpefCredit).toBe(3600);
  });

  it('skips a document with no tax year, or of another type', () => {
    expect(
      returnsOf([
        doc({ form_type: '730' }),
        doc(pf2026.fields, { categories: ['CERTIFICAZIONE_UNICA'] }),
      ]).size,
    ).toBe(0);
  });
});

describe('the filing deadline', () => {
  it('follows the form and moves off weekends and holidays', () => {
    expect(taxReturnDeadline(2025, '730')).toBe('2026-09-30');
    // 31 October 2026 is a Saturday.
    expect(taxReturnDeadline(2025, 'redditi_pf')).toBe('2026-11-02');
    // Until 2023 Redditi PF was due on 30 November.
    expect(taxReturnDeadline(2022, 'redditi_pf')).toBe('2023-11-30');
    // 31 October 2027 is a Sunday and 1 November a holiday.
    expect(taxReturnDeadline(2026, 'redditi_pf')).toBe('2027-11-02');
  });

  it('expects the form of your last return', () => {
    const returns = returnsOf([pf2026]);
    expect(expectedForm(2026, returns)).toBe('redditi_pf');
    expect(expectedForm(2020, returns)).toBe('730');
  });

  it('is done in the agenda once the return is uploaded', () => {
    const returns = returnsOf([pf2026, pf2025]);
    const deadlines = deadlinesOf(
      { from: '2025-09-17', to: '2027-12-31' },
      returns,
    );
    expect(
      deadlines.map((d) => [d.id, d.date, d.done ?? false, d.amount]),
    ).toEqual([
      ['return-2024', '2025-10-31', true, null],
      ['advance-2025', '2025-12-01', false, 242.4],
      ['return-2025', '2026-11-02', true, null],
      ['return-2026', '2027-11-02', false, null],
    ]);
    expect(deadlines[3].title).toBe('Redditi PF deadline (2026 income)');
  });
});

describe('the forecast', () => {
  it('computes IRPEF by the brackets of the year', () => {
    expect(grossIrpef(26416, 2025)).toBe(6075.68);
    expect(grossIrpef(27777, 2022)).toBe(6644.25);
    expect(grossIrpef(40000, 2026)).toBe(6440 + 3960);
  });

  it('estimates employment tax credits without a CU', () => {
    // The 2026 return: 1.509 € plus the ulteriore detrazione of 829 €, on 33.371 €.
    // The return rounds each to the euro.
    expect(
      Math.abs(employmentCredits(33371, 2025) - (1509 + 829)),
    ).toBeLessThan(1);
  });

  const deductions = {
    lines: [
      line('health', 190),
      line('renovation', 4285.65),
      line('furniture', 14),
    ],
    carried: [],
  };

  it('matches the return when every document is there', () => {
    const forecast = forecastOf({
      taxYear: 2025,
      currentYear: 2026,
      certificates: [cu2025],
      payslips: [],
      deductions,
      expenseCount: 3,
      previousReturn: readReturn(pf2025),
    });
    expect(forecast?.figures).toMatchObject({
      income: 26416,
      taxableIncome: 26416,
      grossTax: 6075.68,
      workDeductions: 2338,
      netTax: 0,
      advancesPaid: 404,
      balance: -3678,
    });
    const filed = readReturn(pf2026);
    if (!filed || !forecast) throw new Error('missing');
    const comparison = compareReturn(filed, forecast, {
      hasCertificates: true,
      payslipOnly: false,
    });
    expect(comparison.matches).toBe(true);
    expect(comparison.causes).toEqual([]);
  });

  it('says which documents are missing when it does not', () => {
    const forecast = forecastOf({
      taxYear: 2025,
      currentYear: 2026,
      certificates: [cu2025],
      payslips: [],
      deductions: { lines: [line('health', 190)], carried: [] },
      expenseCount: 1,
      previousReturn: null,
    });
    const filed = readReturn(pf2026);
    if (!filed || !forecast) throw new Error('missing');
    const comparison = compareReturn(filed, forecast, {
      hasCertificates: true,
      payslipOnly: false,
    });
    expect(comparison.matches).toBe(false);
    const causes = comparison.causes.join('\n');
    expect(causes).toMatch(/building bonus instalments in the return \(RN14/);
    expect(causes).toMatch(/furniture/);
    expect(causes).toMatch(/upload your return for 2024/);
    expect(comparison.lines.find((l) => l.key === 'income')?.matches).toBe(
      true,
    );
  });

  it('projects a year still running from its payslips', () => {
    const payslip = (month: string, taxable: number, tax: number) =>
      doc(
        {
          employer: 'ACME SPA',
          pay_period: `${month}-01/${month}-28`,
          taxable_income: taxable,
          income_tax_withheld: tax,
        },
        {
          categories: ['PAYSLIP'],
          uploadId: `00000000-0000-4000-8000-0000000001${month.slice(5)}`,
        },
      );
    const payslips = payslipsOf(2026, [
      payslip('2026-01', 2000, 300),
      payslip('2026-02', 2200, 340),
      payslip('2026-02', 2200, 340), // the same payslip again
      payslip('2025-12', 9999, 999), // another year
    ]);
    expect(payslips).toHaveLength(2);
    const forecast = forecastOf({
      taxYear: 2026,
      currentYear: 2026,
      certificates: [],
      payslips,
      deductions: { lines: [], carried: [] },
      expenseCount: 0,
      previousReturn: readReturn(pf2026),
    });
    expect(forecast).toMatchObject({
      projected: true,
      figures: { income: 25200, irpefWithheld: 3840, advancesPaid: 0 },
    });
    expect(forecast?.missing.join(' ')).toMatch(/Certificazione Unica of 2026/);
  });

  it('has nothing to go on without income or expenses', () => {
    expect(
      forecastOf({
        taxYear: 2026,
        currentYear: 2026,
        certificates: [],
        payslips: [],
        deductions: { lines: [], carried: [] },
        expenseCount: 0,
        previousReturn: null,
      }),
    ).toBeNull();
  });
});

describe("the year's return", () => {
  it('is late when the deadline passed with no return uploaded', () => {
    const returns = returnsOf([pf2025]);
    const year = taxReturnOf({
      taxYear: 2025,
      today: '2026-11-16',
      returns,
      forecast: null,
      hasCertificates: false,
      payslipOnly: false,
    });
    expect(year).toMatchObject({
      form: 'redditi_pf',
      deadline: '2026-11-02',
      status: 'late',
      filed: null,
    });
    expect(
      taxReturnOf({
        taxYear: 2025,
        today: '2026-11-16',
        returns: returnsOf([pf2025, pf2026]),
        forecast: null,
        hasCertificates: false,
        payslipOnly: false,
      }).status,
    ).toBe('filed');
  });
});
