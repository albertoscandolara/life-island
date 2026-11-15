import { describe, expect, it } from 'vitest';
import type { ApprovedWorkDocument } from './career.js';
import {
  buildPension,
  matchFund,
  pensionDeadlines,
  readStatement,
  type PensionFundRowInput,
  type PensionInput,
} from './pension.js';
import { readWorkDocument } from './work-documents.js';

// Made-up payslips and fund, nothing real.
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
      gross_pay: 2500,
      taxable_income: 2300,
      pension_fund_employee: 30,
      pension_fund_employer: 50,
      tfr_to_fund: 185,
      ...extra,
    }),
  };
}

function cu(
  year: number,
  fields: Record<string, string | number | null>,
): ApprovedWorkDocument {
  return {
    uploadId: `cu-${year}`,
    title: `CU ${year}`,
    workplaceId: 'w1',
    reading: readWorkDocument('CERTIFICAZIONE_UNICA', {
      employer: 'ESEMPIO LAVORI S.R.L.',
      income_year: year,
      employment_income: 30000,
      ...fields,
    }),
  };
}

const fund: PensionFundRowInput = {
  id: 'f1',
  name: 'Fondo Cometa',
  kind: 'negotiated',
  memberSince: '2016-03-01',
  investmentLine: 'Monetario Plus',
  employeePct: 1.2,
  employerPct: 2,
  tfrPct: 100,
  firstJob: false,
  memberCode: null,
  url: null,
  notes: null,
  status: 'active',
  createdAt: new Date('2026-01-10T00:00:00Z'),
};

const months = (year: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    payslip(`${year}-${String(i + 1).padStart(2, '0')}`),
  );

const base = (over: Partial<PensionInput> = {}): PensionInput => ({
  funds: [fund],
  statements: [],
  payments: [],
  notices: [],
  approved: [],
  statementDocuments: [],
  dismissed: new Set(),
  today: '2026-11-15',
  ...over,
});

describe('buildPension', () => {
  it('adds the payslip lines year by year, the TFR outside the limit', () => {
    const p = buildPension(base({ approved: months(2025, 12) }));
    const y2025 = p.years.find((y) => y.year === 2025)!;
    expect(y2025).toMatchObject({
      payslips: 12,
      employee: 360,
      employer: 600,
      tfr: 2220,
      counted: 960,
      limit: 5164.57,
      room: 4204.57,
      over: 0,
      running: false,
      e27Deducted: 960,
      e27NotDeducted: 0,
      noticeDue: null,
      marginalRatePct: 23,
    });
    expect(y2025.taxSaved).toBe(220.8);
    expect(p.onPayslips).toBe(true);
  });

  it('projects the running year to December and tells what is left to deduct', () => {
    const p = buildPension(
      base({
        approved: months(2026, 10),
        payments: [
          {
            id: 'p1',
            fundId: 'f1',
            date: '2026-06-20',
            amount: 500,
            kind: 'direct',
            note: null,
          },
        ],
      }),
    );
    const now = p.years[0];
    expect(now.year).toBe(2026);
    expect(now.running).toBe(true);
    expect(now.counted).toBe(1300);
    // Ten months of 80 €, and November and December to come.
    expect(now.projected).toBe(1460);
    expect(now.limit).toBe(5300);
    expect(p.thisYear).toMatchObject({
      year: 2026,
      room: 3840,
      deadline: '2026-12-31',
    });
    expect(p.thisYear?.saving).toBe(883.2);
    expect(now.e27NotDeducted).toBe(500);
  });

  it('takes the CU over the payslips, and flags what is over the limit', () => {
    const p = buildPension(
      base({
        approved: [
          ...months(2025, 12),
          cu(2025, {
            pension_fund_deducted: '5.164,57',
            pension_fund_not_deducted: 400,
          }),
        ],
        notices: [],
      }),
    );
    const y = p.years.find((x) => x.year === 2025)!;
    expect(y).toMatchObject({
      cuDeducted: 5164.57,
      cuNotDeducted: 400,
      over: 400,
      e27Deducted: 5164.57,
      e27NotDeducted: 400,
      noticeDue: '2026-12-31',
      noticeSentAt: null,
    });
    expect(p.documents.some((d) => d.kind === 'certificate')).toBe(true);
    const dates = pensionDeadlines(p, { from: '2026-01-01', to: '2027-12-31' });
    expect(dates.map((d) => d.kind).sort()).toEqual([
      'pension_notice',
      'pension_topup',
    ]);
  });

  it('values the fund from its latest statement, with the exit tax for the years in it', () => {
    const p = buildPension(
      base({
        statements: [
          {
            id: 's1',
            fundId: 'f1',
            date: '2024-12-31',
            value: 20000,
            paidIn: 19000,
            employee: null,
            employer: null,
            tfr: null,
            returnPct: null,
            sourceUploadId: null,
            notes: null,
          },
          {
            id: 's2',
            fundId: 'f1',
            date: '2025-12-31',
            value: 24500,
            paidIn: 22000,
            employee: 360,
            employer: 600,
            tfr: 2220,
            returnPct: 4.1,
            sourceUploadId: null,
            notes: null,
          },
        ],
      }),
    );
    expect(p.funds[0]).toMatchObject({
      value: 24500,
      valueDate: '2025-12-31',
      paidIn: 22000,
      paidInSource: 'statement',
      gain: 2500,
      yearsMember: 10,
      exitTaxPct: 15,
    });
    expect(p.statements[0].gain).toBe(2500);
    expect(p.totalValue).toBe(24500);
  });

  it('puts statement documents up for review until confirmed or dismissed', () => {
    const doc = {
      uploadId: 'd1',
      title: 'Comunicazione periodica 2025',
      uploadedAt: new Date('2026-04-01T00:00:00Z'),
      fields: {
        fund_name: 'COMETA',
        statement_year: 2025,
        position_value: '24.500,00',
        total_paid_in: 22000,
        investment_line: 'Monetario Plus',
      },
    };
    const waiting = buildPension(base({ statementDocuments: [doc] }));
    expect(waiting.pending).toHaveLength(1);
    expect(waiting.pending[0]).toMatchObject({
      fundId: 'f1',
      date: '2025-12-31',
      value: 24500,
      missing: [],
    });
    const dismissed = buildPension(
      base({ statementDocuments: [doc], dismissed: new Set(['d1']) }),
    );
    expect(dismissed.pending).toHaveLength(0);
  });
});

describe('statements and funds', () => {
  it('reads what a statement prints', () => {
    expect(
      readStatement({
        uploadId: 'd',
        title: 't',
        uploadedAt: new Date(),
        fields: { statement_date: '2026-03-31', position_value: 'abc' },
      }),
    ).toMatchObject({ date: '2026-03-31', value: null, fundName: null });
  });

  it('matches a fund by its name, with or without "Fondo pensione"', () => {
    const funds = [
      { id: 'a', name: 'Fondo Cometa' },
      { id: 'b', name: 'Amundi SecondaPensione' },
    ];
    expect(matchFund('COMETA', funds)?.id).toBe('a');
    expect(matchFund('Fondo pensione Cometa', funds)?.id).toBe('a');
    expect(matchFund('Secondapensione', funds)?.id).toBe('b');
    expect(matchFund('Fon.Te.', funds)).toBe(null);
  });
});
