import { describe, expect, it } from 'vitest';
import type { CareerWorkplace, ApprovedWorkDocument } from './career.js';
import {
  buildAudit,
  buildJobSearchStats,
  buildNetChanges,
  buildTfr,
  jobApplicationDto,
  type JobApplicationRow,
} from './checks.js';
import { readWorkDocument } from './work-documents.js';

// Made-up payslips of a Metalmeccanici C3 hired in March 2021.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: {
    employerName: 'ESEMPIO LAVORI S.R.L.',
    hireDate: '2021-03-01',
    collectiveAgreement: 'Metalmeccanici Industria',
  },
};

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
      pay_period: `${period}-01/${period}-28`,
      contract_type: 'Metalmeccanici Industria Impiegati',
      job_level: 'C3',
      monthly_salary: 2250,
      base_minimum: 2158.26,
      superminimum: 32.98,
      seniority_increments: 2,
      gross_pay: 2250,
      social_security_contributions: 206.78,
      income_tax_withheld: 380,
      net_pay: 1663.22,
      severance_accrued: 166.67,
      vacation_left: 120,
      leave_left: 60,
      ...extra,
    }),
  };
}

describe('buildAudit', () => {
  it('finds a renewal paid late, and passes the months paid right', () => {
    const audit = buildAudit(
      [workplace],
      [
        payslip('2025-05', { base_minimum: 2130.56, monthly_salary: 2222.3 }),
        // June 2025 still pays the old minimum.
        payslip('2025-06', { base_minimum: 2130.56, monthly_salary: 2222.3 }),
        payslip('2025-07'),
      ],
      '2025-08-10',
    );
    expect(audit.rulesKnown).toBe(true);
    const late = audit.findings.find((f) => f.kind === 'below_minimum')!;
    expect(late).toMatchObject({
      severity: 'problem',
      period: '2025-06',
      amount: 27.7,
    });
    expect(late.detail).toContain('renewal was not applied');
  });

  it('counts the seniority increments and says when the next one comes', () => {
    const audit = buildAudit(
      [workplace],
      [payslip('2026-10', { seniority_increments: 1 })],
      '2026-11-10',
    );
    // Hired March 2021: two increments by March 2025, the third in March 2027.
    const count = audit.findings.find((f) => f.kind === 'seniority_count')!;
    expect(count.title).toBe('1 seniority increment, 2 expected');
    expect(count.amount).toBe(29.64);
    const next = audit.findings.find((f) => f.kind === 'next_increment')!;
    expect(next.period).toBe('2027-03');
  });

  it('flags increments that the salary does not pay', () => {
    // 2 × 29.64 = 59.28 owed, but the salary leaves 2250 − 2158.26 − 80 = 11.74.
    const audit = buildAudit(
      [workplace],
      [payslip('2026-10', { superminimum: 80 })],
      '2026-11-10',
    );
    const f = audit.findings.find((x) => x.kind === 'seniority_amount')!;
    expect(f.amount).toBe(47.54);
  });

  it('tells a superminimum absorbed by a renewal from one taken too far', () => {
    const fair = buildAudit(
      [workplace],
      [
        payslip('2025-05', { base_minimum: 2130.56, superminimum: 60 }),
        payslip('2025-06', { base_minimum: 2158.26, superminimum: 40 }),
      ],
      '2025-07-01',
    ).findings.find((f) => f.kind === 'superminimum_absorbed')!;
    expect(fair).toMatchObject({ severity: 'info', amount: 20 });
    const unfair = buildAudit(
      [workplace],
      [
        payslip('2025-05', { base_minimum: 2130.56, superminimum: 60 }),
        payslip('2025-06', { base_minimum: 2158.26, superminimum: 10 }),
      ],
      '2025-07-01',
    ).findings.find((f) => f.kind === 'superminimum_absorbed')!;
    expect(unfair.severity).toBe('problem');
  });

  it('warns about vacation piling up and a short tredicesima', () => {
    const audit = buildAudit(
      [workplace],
      [
        payslip('2025-11', { vacation_left: 190 }),
        payslip('2025-12', {
          payslip_kind: 'tredicesima',
          gross_pay: 2000,
        }),
      ],
      '2026-01-10',
    );
    expect(
      audit.findings.find((f) => f.kind === 'vacation_backlog')?.amount,
    ).toBe(30);
    expect(
      audit.findings.find((f) => f.kind === 'thirteenth_amount')?.amount,
    ).toBe(250);
  });

  it('knows no rules for another CCNL', () => {
    const audit = buildAudit(
      [{ ...workplace, values: { collectiveAgreement: 'Commercio' } }],
      [payslip('2025-06', { contract_type: 'Commercio' })],
      '2025-07-01',
    );
    expect(audit.rulesKnown).toBe(false);
    expect(audit.findings.filter((f) => f.kind === 'below_minimum')).toEqual(
      [],
    );
  });
});

describe('buildNetChanges', () => {
  it('explains a net change by its parts, which add up', () => {
    const [change] = buildNetChanges([
      payslip('2026-01'),
      payslip('2026-02', {
        overtime_pay: 120,
        gross_pay: 2370,
        social_security_contributions: 217.8,
        income_tax_withheld: 420,
        regional_surtax: 40,
        net_pay: 1692.2,
      }),
    ]);
    expect(change.change).toBe(28.98);
    expect(change.parts[0]).toEqual({ label: 'Overtime', amount: 120 });
    const total = change.parts.reduce((s, p) => s + p.amount, 0);
    expect(total).toBeCloseTo(28.98, 2);
    expect(change.parts.map((p) => p.label)).toContain(
      'Regional and municipal surtaxes',
    );
  });
});

describe('buildTfr', () => {
  it('adds each year and revalues what the company holds', () => {
    const docs = [
      ...[
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
      ].map((m) => payslip(`2024-${m}`)),
      payslip('2025-01', { tfr_to_fund: 66.67 }),
    ];
    const tfr = buildTfr([workplace], docs, 29250, '2025-06-01');
    const [y2025, y2024] = tfr.years;
    expect(y2024.accrued).toBe(2000.04);
    expect(y2024.revaluation).toBe(0);
    // 2025 is still running: no revaluation yet; 166.67 accrued, 66.67 to the fund.
    expect(y2025.companyFund).toBe(2100.04);
    expect(tfr.inFund).toBe(true);
    expect(tfr.fundTotal).toBe(66.67);
  });

  it('revalues a past year with its official coefficient, less 17%', () => {
    const docs = ['2024-12', '2025-12'].map((p) =>
      payslip(p, { severance_accrued: 1000 }),
    );
    const tfr = buildTfr([workplace], docs, null, '2026-03-01');
    const y2025 = tfr.years[0];
    // 1000 at the end of 2024, revalued 2.311148% in 2025.
    expect(y2025.revaluation).toBe(23.11);
    expect(y2025.revaluationTax).toBe(3.93);
    expect(y2025.companyFund).toBe(2019.18);
  });
});

describe('job search', () => {
  const row = (change: Partial<JobApplicationRow>): JobApplicationRow => ({
    id: 'a',
    company: 'Nuova Srl',
    role: 'Developer',
    source: null,
    url: null,
    location: null,
    status: 'applied',
    appliedAt: '2026-10-01',
    nextStep: null,
    nextStepAt: null,
    ralMin: null,
    ralMax: null,
    offerRal: null,
    offerMonths: null,
    offerWelfare: null,
    offerBonus: null,
    notes: null,
    history: [{ status: 'applied', at: '2026-10-01' }],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...change,
  });

  it('marks an application with no news as stale', () => {
    expect(jobApplicationDto(row({}), '2026-11-10').stale).toBe(true);
    expect(
      jobApplicationDto(row({ nextStepAt: '2026-11-15' }), '2026-11-10').stale,
    ).toBe(false);
  });

  it('counts answers, interviews and offers', () => {
    const today = '2026-11-10';
    const stats = buildJobSearchStats([
      jobApplicationDto(row({}), today),
      jobApplicationDto(
        row({
          id: 'b',
          status: 'interview',
          history: [
            { status: 'applied', at: '2026-10-01' },
            { status: 'screening', at: '2026-10-11' },
            { status: 'interview', at: '2026-10-20' },
          ],
        }),
        today,
      ),
      jobApplicationDto(
        row({
          id: 'c',
          status: 'rejected',
          history: [
            { status: 'applied', at: '2026-10-01' },
            { status: 'rejected', at: '2026-10-21' },
          ],
        }),
        today,
      ),
      jobApplicationDto(
        row({ id: 'd', status: 'saved', appliedAt: null, history: [] }),
        today,
      ),
    ]);
    expect(stats).toMatchObject({
      total: 4,
      sent: 3,
      answered: 2,
      responseRatePct: 67,
      interviews: 1,
      offers: 0,
      averageDaysToAnswer: 15,
      stale: 2,
    });
  });
});
