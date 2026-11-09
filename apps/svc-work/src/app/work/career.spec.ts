import {
  buildStats,
  buildTimeline,
  levelRank,
  monthsBetween,
  payslipChecks,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';
import { offlineFeedback, careerDossier } from './career-feedback.js';
import { buildEvaluationStats } from './evaluations.js';
import { readWorkDocument } from './work-documents.js';

// The same anonymized payslip fields as work-documents.spec.ts.
const payslipFields = (
  month: string,
  extra: Record<string, string | number | null> = {},
) => ({
  employer: 'ESEMPIO LAVORI S.R.L.',
  employer_tax_code: '01234567890',
  employee_code: '12345',
  hire_date: '2020-03-01',
  pay_period: `2026-${month}-01/2026-${month}-28`,
  gross_pay: 2350,
  total_deductions: '610,00',
  net_pay: '1.740,00',
  job_level: 'B1',
  contract_type: 'Metalmeccanici Industria Impiegati',
  qualification: 'IMPIEGATI',
  monthly_salary: '2.350,00',
  base_minimum: 2290,
  seniority_increments: 2,
  vacation_left: 60,
  ...extra,
});

// Anonymized: a level change in February and a CCNL rise with a
// superminimum in June, with made-up amounts.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: {
    employerName: 'ESEMPIO LAVORI S.R.L.',
    hireDate: '2020-03-01',
    level: 'B1',
    monthlySalary: 2480,
  },
};

function payslip(
  month: string,
  extra: Record<string, string | number | null> = {},
): ApprovedWorkDocument {
  return {
    uploadId: `u-${month}`,
    title: `Payslip ${month}`,
    workplaceId: 'w1',
    reading: readWorkDocument('PAYSLIP', payslipFields(month, extra)),
  };
}

const docs = [
  payslip('01', {
    job_level: 'C3',
    monthly_salary: 2200,
    gross_pay: 2800,
    net_pay: 2050,
  }),
  payslip('02'),
  payslip('03'),
  payslip('05'),
  payslip('06', {
    monthly_salary: 2480,
    base_minimum: 2340,
    superminimum: 75,
    gross_pay: 2600,
    net_pay: 1930,
    welfare_credits: 900,
    seniority_increments: 3,
  }),
];

describe('levelRank', () => {
  it('orders letter levels and leaves bare numbers alone', () => {
    expect(levelRank('B1')!).toBeGreaterThan(levelRank('C3')!);
    expect(levelRank('A1')!).toBeGreaterThan(levelRank('B3')!);
    expect(levelRank('Quadro')!).toBeGreaterThan(levelRank('A1')!);
    expect(levelRank('5')).toBeNull();
  });

  it('counts whole months', () => {
    expect(monthsBetween('2020-03-01', '2026-11-08')).toBe(80);
    expect(monthsBetween('2026-01', '2026-06')).toBe(5);
  });
});

describe('buildTimeline', () => {
  const timeline = buildTimeline([workplace], docs, [
    {
      id: 'm1',
      date: '2026-04-15',
      kind: 'certification',
      title: 'Cloud certification',
      detail: null,
      workplaceId: null,
      amount: null,
    },
  ]);
  const kinds = timeline.map((e) => `${e.date} ${e.kind}`);

  it('reads the promotion, the rise and the increment, newest first (no extra pay, role or CCNL events)', () => {
    expect(kinds).toEqual([
      '2026-06-01 salary_rise',
      '2026-06-01 seniority_increment',
      '2026-04-15 certification',
      '2026-02-01 promotion',
      '2020-03-01 hired',
    ]);
  });

  it('explains where a rise comes from', () => {
    const rise = timeline.find((e) => e.kind === 'salary_rise')!;
    expect(rise.changePct).toBe(5.5);
    expect(rise.detail).toContain('CCNL minimum');
    expect(rise.detail).toContain('a superminimum');
    const promotion = timeline.find((e) => e.kind === 'promotion')!;
    expect(promotion.title).toBe('Level C3 → B1');
    expect(promotion.notable).toBe(true);
  });
});

describe('buildStats', () => {
  const timeline = buildTimeline([workplace], docs, []);
  const stats = buildStats([workplace], docs, timeline, '2026-11-08');

  it('sums each year and finds the months with no payslip', () => {
    expect(stats.payslips).toBe(5);
    expect(stats.years[0]).toMatchObject({
      year: 2026,
      payslips: 5,
      net: 2050 + 1740 * 3 + 1930,
      welfare: 900,
    });
    expect(stats.missingMonths).toEqual(['2026-04']);
  });

  it('measures growth, tenure and the time since the last rise', () => {
    expect(stats.currentMonthlySalary).toBe(2480);
    expect(stats.salaryGrowthPct).toBe(12.7);
    expect(stats.annualGrowthPct).toBeNull(); // less than a year of payslips
    expect(stats.tenureMonths).toBe(80);
    expect(stats.monthsSinceLastRise).toBe(5);
  });

  it('writes an offline feedback from the same data, with no personal codes in the dossier', () => {
    const input = {
      workplaces: [workplace],
      documents: docs,
      timeline,
      stats,
      evaluations: buildEvaluationStats(docs, [workplace], stats.years),
      platforms: [],
      today: '2026-11-08',
    };
    const feedback = offlineFeedback(input, null);
    expect(feedback.summary).toContain('Esempio Lavori');
    expect(feedback.strengths.join(' ')).toContain('12.7%');
    expect(feedback.suggestions.map((s) => s.title)).toContain(
      'Ask for a written evaluation',
    );
    expect(feedback.suggestions.map((s) => s.title)).toContain(
      'Sign up to one or two hiring platforms',
    );
    const dossier = careerDossier(input);
    expect(dossier).not.toContain('01234567890');
    expect(dossier).not.toContain('12345');
    expect(dossier).toContain('Level C3 → B1');
  });
});

describe('payslips the AI read with gaps', () => {
  it('compares a salary with the latest one read, across a month not read', () => {
    const events = buildTimeline(
      [workplace],
      [
        payslip('02', { monthly_salary: 2350 }),
        payslip('03', { monthly_salary: null }),
        payslip('04', { monthly_salary: 2480 }),
      ],
      [],
    );
    const rise = events.find((e) => e.kind === 'salary_rise');
    expect(rise?.uploadId).toBe('u-04');
    expect(rise?.changePct).toBe(5.5);
  });

  it('reads a level printed with a prefix as its code, not as a change', () => {
    const events = buildTimeline(
      [workplace],
      [
        payslip('02', { job_level: 'IMP.LIV.C3 L. 56/87' }),
        payslip('03', { job_level: 'C3' }),
        payslip('04', { job_level: 'IMP.LIV.C3' }),
        payslip('05', { job_level: 'B1' }),
      ],
      [],
    );
    expect(events.filter((e) => e.kind === 'promotion')).toEqual([
      expect.objectContaining({ title: 'Level C3 → B1', uploadId: 'u-05' }),
    ]);
  });

  it('lists payslips with no month, values not read, or a clashing twin', () => {
    const checks = payslipChecks([
      payslip('01'),
      payslip('02', { pay_period: null, gross_pay: null }),
      payslip('03', { gross_pay: null, monthly_salary: null }),
      payslip('04', { monthly_salary: null }),
      {
        ...payslip('04', { net_pay: '2.700,00' }),
        uploadId: 'u-04b',
        title: 'Dicembre',
      },
      // A copy with the same amounts is no check.
      { ...payslip('01'), uploadId: 'u-01b' },
    ]);
    expect(checks.map((c) => [c.uploadId, c.kind, c.missing])).toEqual([
      ['u-02', 'no_month', []],
      ['u-03', 'missing_values', ['gross pay', 'monthly salary']],
      ['u-04', 'missing_values', ['monthly salary']],
      ['u-04b', 'same_month', []],
    ]);
    expect(checks[1].message).toContain('counts as 0 in the year totals');
    expect(checks[3].message).toContain('different net');
  });

  it('puts the checks in the statistics', () => {
    const stats = buildStats(
      [workplace],
      [payslip('01'), payslip('02', { net_pay: null })],
      [],
      '2026-07-15',
    );
    expect(stats.checks).toEqual([
      expect.objectContaining({ uploadId: 'u-02', missing: ['net pay'] }),
    ]);
  });
});
