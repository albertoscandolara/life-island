import type {
  CareerDocumentDto,
  TaxCertificateDto,
  WorkOverviewDto,
  WorkplaceDto,
} from '@life-island/contracts';
import { payslipAttention } from './payslip-attention.js';

const slip = (period: string): CareerDocumentDto => ({
  uploadId: `u-${period}`,
  title: period,
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
});

const overview = (
  periods: string[],
  certificates: Partial<TaxCertificateDto>[] = [],
) =>
  ({
    workplaces: [
      {
        id: 'w',
        label: 'Acme',
        status: 'current',
        values: {},
        documents: periods.map(slip),
      } as unknown as WorkplaceDto,
    ],
    certificates: certificates as TaxCertificateDto[],
    stats: { checks: [] },
    audit: { findings: [] },
  }) as unknown as WorkOverviewDto;

describe('payslipAttention', () => {
  it('asks for the payslips missing in the last year, in one item', () => {
    const items = payslipAttention(
      overview(['2024-01', '2026-08', '2026-10']),
      '2026-11-26',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'payslip-missing',
      title: 'Load 10 missing payslips',
      path: '/work#work-payslips',
      action: 'Load it',
    });
    expect(items[0].detail).toMatch(/^Sep 2026, Jul 2026/);
  });

  it('is quiet when every payslip is in, and flags a recent CU that differs', () => {
    expect(
      payslipAttention(overview(['2026-09', '2026-10']), '2026-11-26'),
    ).toEqual([]);
    const items = payslipAttention(
      overview(
        ['2026-09', '2026-10'],
        [
          {
            uploadId: 'cu',
            year: 2025,
            workplaceName: 'Acme',
            incomeGap: 200,
            taxGap: 0,
            missingMonths: [],
          },
          {
            uploadId: 'old',
            year: 2020,
            workplaceName: 'Acme',
            incomeGap: 200,
            taxGap: 0,
            missingMonths: [],
          },
        ],
      ),
      '2026-11-26',
    );
    expect(items.map((i) => i.id)).toEqual(['cu-differs:cu']);
  });
});
