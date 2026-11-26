import { describe, expect, it } from 'vitest';
import type {
  CareerDocumentDto,
  TaxCertificateDto,
  WorkplaceDto,
} from '@life-island/contracts';
import {
  addMonths,
  certificateMatches,
  dueThrough,
  latestPayslips,
  payslipYears,
} from './payslip-months';

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
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(dueThrough('2026-11-26')).toBe('2026-10');
    expect(dueThrough('2026-11-05')).toBe('2026-09');
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

  it('matches a CU within a euro', () => {
    const cu = (incomeGap: number | null, taxGap: number | null) =>
      ({ incomeGap, taxGap }) as TaxCertificateDto;
    expect(certificateMatches(cu(0.4, -0.2))).toBe(true);
    expect(certificateMatches(cu(120, 0))).toBe(false);
    expect(certificateMatches(cu(null, null))).toBe(null);
  });
});
