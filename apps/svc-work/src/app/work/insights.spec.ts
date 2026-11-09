import { describe, expect, it } from 'vitest';
import { FOI_LAST_YEAR, foiIndex } from '@life-island/contracts';
import {
  buildStats,
  buildTimeline,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';
import { buildCertificates } from './certificates.js';
import { buildEvaluationStats } from './evaluations.js';
import {
  buildBrief,
  buildCcnlComparison,
  buildGoals,
  buildInsights,
  buildRealPay,
  buildReviewsVsPay,
  buildSalaryParts,
  buildTaxes,
  buildTimeOff,
  buildWorkload,
  splitGoals,
  type InsightsInput,
} from './insights.js';
import { readWorkDocument } from './work-documents.js';

// Made-up payslips of a Metalmeccanici C3 who moves to B1 in 2026.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: {
    employerName: 'ESEMPIO LAVORI S.R.L.',
    hireDate: '2023-03-01',
    collectiveAgreement: 'Metalmeccanici Industria',
    jobTitle: 'Software developer',
  },
};

const lastDay = (period: string) =>
  new Date(+period.slice(0, 4), +period.slice(5, 7), 0).getDate();

function payslip(
  period: string,
  extra: Record<string, string | number | null> = {},
): ApprovedWorkDocument {
  return {
    uploadId: `u-${period}-${extra['payslip_kind'] ?? 'm'}`,
    title: `Payslip ${period}`,
    workplaceId: 'w1',
    reading: readWorkDocument('PAYSLIP', {
      employer: 'ESEMPIO LAVORI S.R.L.',
      employer_tax_code: '01234567890',
      pay_period: `${period}-01/${period}-${lastDay(period)}`,
      contract_type: 'Metalmeccanici Industria Impiegati',
      job_level: 'C3',
      monthly_salary: 2200,
      base_minimum: 2130.56,
      superminimum: 50,
      gross_pay: 2200,
      social_security_contributions: 202.18,
      income_tax_withheld: 330,
      taxable_income: 1997.82,
      net_pay: 1640,
      vacation_left: 80,
      leave_left: 40,
      hours_worked: 168,
      ...extra,
    }),
  };
}

const docs: ApprovedWorkDocument[] = [
  payslip('2024-06', { monthly_salary: 2100, base_minimum: 2050 }),
  payslip('2024-12', {
    payslip_kind: 'tredicesima',
    monthly_salary: 2100,
    gross_pay: 2100,
    taxable_income: 1907,
    income_tax_withheld: 440,
    net_pay: 1270,
  }),
  payslip('2025-06'),
  payslip('2025-07', {
    vacation_left: 60,
    overtime_hours: 6,
    overtime_pay: 120,
  }),
  payslip('2026-06', {
    job_level: 'B1',
    monthly_salary: 2450,
    base_minimum: 2370.33,
    superminimum: 60,
    vacation_left: 100,
    travel_days: 3,
    travel_allowance: 90,
  }),
];

const evaluation: ApprovedWorkDocument = {
  uploadId: 'e1',
  title: 'Evaluation 2025',
  workplaceId: 'w1',
  reading: readWorkDocument('PERFORMANCE_REVIEW', {
    employer: 'Esempio Lavori srl',
    review_date: '2025-06-15',
    review_cycle: '2025',
    overall_score: 84,
    goals: 'Certificazione AWS\nGuidare un progetto\nCertificazione AWS',
  }),
};

function input(today = '2026-11-09'): InsightsInput {
  const all = [...docs, evaluation];
  const timeline = buildTimeline([workplace], all, []);
  const stats = buildStats([workplace], all, timeline, today);
  return {
    workplaces: [workplace],
    documents: all,
    stats,
    evaluations: buildEvaluationStats(all, [workplace], stats.years),
    certificates: buildCertificates([workplace], all),
    today,
  };
}

describe('buildRealPay', () => {
  it('sets the average salary of each year against the FOI', () => {
    const real = buildRealPay(docs);
    expect(real.years.map((y) => [y.year, y.averageSalary])).toEqual([
      [2024, 2100],
      [2025, 2200],
      [2026, 2450],
    ]);
    // In euros of the latest year on record: that year's real salary is as paid.
    expect(real.baseYear).toBe(Math.min(2026, FOI_LAST_YEAR));
    expect(real.years[2].realSalary).toBe(2450);
    const prices = foiIndex(2026)! / foiIndex(2024)!;
    expect(real.inflationPct).toBeCloseTo((prices - 1) * 100, 0);
    expect(real.realGrowthPct).toBeCloseTo((2450 / prices / 2100 - 1) * 100, 0);
    expect(real.nominalGrowthPct).toBe(16.7);
    expect(real.partialNote).toContain('2026');
  });

  it('is empty with no monthly salary', () => {
    expect(buildRealPay([]).years).toEqual([]);
  });
});

describe('buildSalaryParts', () => {
  it('splits each monthly salary into the CCNL minimum, superminimum and the rest', () => {
    const parts = buildSalaryParts(docs);
    // The tredicesima is not a month of salary.
    expect(parts.map((p) => p.period)).toEqual([
      '2024-06',
      '2025-06',
      '2025-07',
      '2026-06',
    ]);
    expect(parts[1]).toMatchObject({
      base: 2130.56,
      superminimum: 50,
      other: 19.44,
      total: 2200,
    });
  });
});

describe('buildCcnlComparison', () => {
  it('compares the latest salary with the minimum of its level and the next', () => {
    const ccnl = buildCcnlComparison([workplace], docs, '2026-11-09');
    expect(ccnl.table?.id).toBe('metalmeccanici-industria');
    expect(ccnl.level).toBe('B1');
    expect(ccnl.minimum).toBe(2370.33);
    expect(ccnl.aboveMinimum).toBe(79.67);
    expect(ccnl.nextLevel).toBe('B2');
    expect(ccnl.nextLevelMinimum).toBe(2542.98);
    expect(ccnl.toNextLevel).toBe(-92.98);
    expect(ccnl.schedule.map((s) => s.from)).toEqual([
      '2026-06',
      '2027-06',
      '2028-06',
    ]);
    expect(ccnl.history.at(-1)).toEqual({
      period: '2026-06',
      level: 'B1',
      salary: 2450,
      minimum: 2370.33,
    });
  });

  it('says nothing for an agreement it has no table of', () => {
    const ccnl = buildCcnlComparison(
      [{ ...workplace, values: { collectiveAgreement: 'Commercio' } }],
      [],
      '2026-11-09',
    );
    expect(ccnl.table).toBeNull();
    expect(ccnl.schedule).toEqual([]);
  });
});

describe('buildTaxes', () => {
  it('adds up each year and finds its bracket on twelve months', () => {
    const { months, years } = buildTaxes(docs);
    expect(months.find((m) => m.period === '2024-12')?.incomeTax).toBe(440);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.taxable).toBe(3995.64);
    expect(y2025.yearTaxable).toBe(23973.84);
    expect(y2025.marginalRatePct).toBe(23);
    expect(y2025.toNextBracket).toBe(4026.16);
    // The tredicesima counts once, not twelve times.
    const y2024 = years.find((y) => y.year === 2024)!;
    expect(y2024.yearTaxable).toBe(1997.82 * 12 + 1907);
  });
});

describe('time off and workload', () => {
  it('tracks the balances and their change over twelve months', () => {
    const off = buildTimeOff(docs);
    expect(off.vacationLeft).toBe(100);
    expect(off.vacationChange12).toBe(20);
    expect(off.leaveChange12).toBe(0);
  });

  it('lists hours, overtime and travel by month', () => {
    const load = buildWorkload(docs);
    expect(load.find((p) => p.period === '2025-07')).toMatchObject({
      overtimeHours: 6,
      overtimePay: 120,
    });
    expect(load.find((p) => p.period === '2026-06')).toMatchObject({
      travelDays: 3,
      travelAllowance: 90,
    });
  });
});

describe('reviews, goals and the brief', () => {
  it('follows each evaluation with the salary a year later', () => {
    const data = input();
    const [row] = buildReviewsVsPay(data.documents, data.evaluations);
    expect(row).toMatchObject({
      score: 84,
      salaryAt: 2200,
      salaryAfter: 2450,
      afterPeriod: '2026-06',
      riseAfterPct: 11.4,
    });
  });

  it('lists each goal once with the status you gave it', () => {
    const data = input();
    const goals = buildGoals(data.evaluations, [
      {
        uploadId: 'e1',
        goalKey: 'certificazione aws',
        status: 'met',
        note: 'Passed in March',
        updatedAt: new Date('2026-03-10T00:00:00Z'),
      },
    ]);
    expect(goals.map((g) => [g.text, g.status])).toEqual([
      ['Certificazione AWS', 'met'],
      ['Guidare un progetto', 'open'],
    ]);
  });

  it('writes the brief from the facts', () => {
    const data = input();
    const insights = buildInsights(data);
    expect(insights.offer).toMatchObject({ monthsPaid: 13, ral: 31850 });
    const goals = buildGoals(data.evaluations, [
      {
        uploadId: 'e1',
        goalKey: 'certificazione aws',
        status: 'met',
        note: null,
        updatedAt: new Date(),
      },
    ]);
    const brief = buildBrief(data, insights, goals, {
      id: 'm1',
      role: 'Software developer',
      region: 'Verona',
      summary: '',
      ranges: [
        {
          source: 'A',
          url: 'https://a',
          description: '',
          low: 30000,
          median: 36000,
          high: 42000,
        },
        {
          source: 'B',
          url: 'https://b',
          description: '',
          low: 31000,
          median: 34000,
          high: 40000,
        },
      ],
      position: 'below',
      advice: [],
      ral: 31850,
      model: null,
      createdAt: '2026-11-01T00:00:00Z',
    });
    expect(brief.level).toBe('B1');
    expect(brief.role).toBe('Software developer');
    expect(brief.facts.map((f) => f.label)).toContain('Minimum of B2');
    expect(brief.asks[0]).toContain('B2');
    expect(brief.asks.some((a) => a.includes('36.000 €'))).toBe(true);
    expect(brief.arguments.some((a) => a.includes('Certificazione AWS'))).toBe(
      true,
    );
  });
});

describe('splitGoals', () => {
  it('reads one goal per line, semicolon, numbered item or sentence', () => {
    expect(splitGoals('- Certificazione AWS\n- Guidare un progetto')).toEqual([
      'Certificazione AWS',
      'Guidare un progetto',
    ]);
    expect(splitGoals('Certificazione AWS; guidare un progetto.')).toEqual([
      'Certificazione AWS',
      'Guidare un progetto',
    ]);
    expect(splitGoals('1) Certificazione AWS 2) Guidare un progetto')).toEqual([
      'Certificazione AWS',
      'Guidare un progetto',
    ]);
    expect(
      splitGoals(
        'Ottenere la certificazione AWS. Guidare un progetto entro il 2026.',
      ),
    ).toEqual([
      'Ottenere la certificazione AWS',
      'Guidare un progetto entro il 2026',
    ]);
    expect(splitGoals(null)).toEqual([]);
  });
});
