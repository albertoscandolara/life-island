import { describe, expect, it } from 'vitest';
import type {
  CareerDocumentDto,
  TaxCertificateDto,
  WorkplaceDto,
} from './work.js';
import {
  periodPlusMonths,
  certificateMatches,
  payslipDueThrough,
  latestPayslips,
  payslipYears,
  recentMissingPayslips,
} from './work-payslips.js';

const slip = (
  uploadId: string,
  period: string,
  over: Partial<CareerDocumentDto> = {},
): CareerDocumentDto => ({
  uploadId,
  title: `Cedolino ${period}`,
  type: 'PAYSLIP',
  period,
  payslipKind: 'regular',
  gross: 3000,
  net: 2000,
  welfare: null,
  facts: [],
  uploadedAt: '',
  reviewedAt: '',
  bankPayment: null,
  ...over,
});

const job = (
  documents: CareerDocumentDto[],
  over: Partial<WorkplaceDto> = {},
): WorkplaceDto => ({
  id: 'w1',
  label: 'Acme',
  status: 'current',
  values: {} as WorkplaceDto['values'],
  notes: null,
  createdAt: '',
  updatedAt: '',
  documents,
  tenureMonths: null,
  latestPeriod: null,
  ...over,
});

describe('payslip months', () => {
  it('counts months and knows which payslip is due', () => {
    expect(periodPlusMonths('2026-01', -1)).toBe('2025-12');
    expect(periodPlusMonths('2026-11', 2)).toBe('2027-01');
    expect(payslipDueThrough('2026-11-26')).toBe('2026-10');
    expect(payslipDueThrough('2026-11-05')).toBe('2026-09');
  });

  it('puts each payslip in its month, once, with the months missing and what to check', () => {
    const [year, before] = payslipYears({
      workplaces: [
        job([
          slip('oct', '2026-10', {
            bankPayment: {
              paid: 2000,
              full: true,
              lastDate: '2026-10-27',
              accounts: [],
            },
          }),
          slip('oct-copy', '2026-10'),
          slip('aug', '2026-08'),
          slip('13th', '2025-12', { payslipKind: 'thirteenth' }),
          slip('dec', '2025-12'),
        ]),
      ],
      certificates: [{ uploadId: 'cu', year: 2025 } as TaxCertificateDto],
      checks: [],
      findings: [
        {
          kind: 'below_minimum',
          severity: 'problem',
          uploadId: 'aug',
          period: '2026-08',
          title: 'Below the CCNL minimum',
          detail: '',
          amount: 12,
        },
      ],
      today: '2026-11-26',
    });
    expect(year.year).toBe(2026);
    expect(year.months.map((m) => m.state)).toEqual([
      'missing',
      'missing',
      'missing',
      'missing',
      'missing',
      'missing',
      'missing',
      'check',
      'missing',
      'ok',
      'none',
      'none',
    ]);
    expect(year.months[9].slips[0].received).toBe('full');
    expect(year.count).toBe(2);
    expect(year.toCheck).toBe(1);
    expect(year.missing).toBe(8);
    expect(before.year).toBe(2025);
    expect(before.months[11].extras.map((s) => s.kind)).toEqual(['thirteenth']);
    expect(before.months[10].state).toBe('none');
    expect(before.certificates).toHaveLength(1);
    expect(latestPayslips([year, before]).latest?.doc.uploadId).toBe('oct');
    expect(latestPayslips([year, before]).previous?.doc.uploadId).toBe('aug');
  });

  it('owes nothing after a past job ended', () => {
    const [year] = payslipYears({
      workplaces: [
        job([slip('jan', '2026-01'), slip('mar', '2026-03')], {
          status: 'past',
        }),
      ],
      certificates: [],
      checks: [],
      findings: [],
      today: '2026-11-26',
    });
    expect(year.months.slice(0, 4).map((m) => m.state)).toEqual([
      'ok',
      'missing',
      'ok',
      'none',
    ]);
  });

  it('lists a year with no payslip between two that have some, and the year missing in the last 12 months', () => {
    const input = {
      workplaces: [job([slip('a', '2024-12'), slip('b', '2026-10')])],
      certificates: [],
      checks: [],
      findings: [],
      today: '2026-11-26',
    };
    const years = payslipYears(input);
    expect(years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    expect(years[1].months.every((m) => m.state === 'missing')).toBe(true);
    const missing = recentMissingPayslips(years, '2026-11-26');
    expect(missing[0]).toBe('2026-09');
    expect(missing.at(-1)).toBe('2025-11');
    expect(missing).toHaveLength(11);
  });

  it('shows the welfare a payslip credits on its month, after the evaluation before it', () => {
    const [year] = payslipYears({
      workplaces: [
        job([
          slip('sep', '2026-09'),
          slip('oct', '2026-10', { welfare: 903.96 }),
          {
            ...slip('ev', '2026-07'),
            type: 'PERFORMANCE_REVIEW',
            title: 'Valutazione 2026',
            period: '2026-07-20',
            payslipKind: null,
          },
        ]),
      ],
      certificates: [],
      checks: [],
      findings: [],
      today: '2026-11-26',
    });
    expect(year.months[9].welfare).toEqual({
      amount: 903.96,
      evaluation: {
        uploadId: 'ev',
        title: 'Valutazione 2026',
        date: '2026-07-20',
      },
    });
    expect(year.months[8].welfare).toBeNull();
    expect(year.welfare).toBe(903.96);
  });

  it('matches a CU within a euro', () => {
    const cu = (incomeGap: number | null, taxGap: number | null) =>
      ({ incomeGap, taxGap }) as TaxCertificateDto;
    expect(certificateMatches(cu(0.4, -0.2))).toBe(true);
    expect(certificateMatches(cu(120, 0))).toBe(false);
    expect(certificateMatches(cu(null, null))).toBe(null);
  });
});
