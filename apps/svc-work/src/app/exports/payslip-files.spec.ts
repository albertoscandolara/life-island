import type {
  CareerDocumentDto,
  TaxCertificateDto,
  WorkplaceDto,
} from '@life-island/contracts';
import {
  documentFileName,
  findDocument,
  payslipYearFiles,
  workplaceFileName,
} from './payslip-files.js';

const doc = (over: Partial<CareerDocumentDto>): CareerDocumentDto => ({
  uploadId: 'u',
  title: 'Cedolino',
  type: 'PAYSLIP',
  period: '2026-10',
  payslipKind: 'regular',
  gross: 3200,
  net: 2187.45,
  welfare: null,
  facts: [],
  uploadedAt: '2026-11-01T00:00:00Z',
  reviewedAt: '2026-11-01T00:00:00Z',
  bankPayment: null,
  ...over,
});

const workplace = (
  over: Partial<WorkplaceDto> & { documents: CareerDocumentDto[] },
): WorkplaceDto => ({
  id: 'w1',
  label: null,
  status: 'current',
  values: { employerName: 'Acme S.p.A.' } as WorkplaceDto['values'],
  notes: null,
  createdAt: '',
  updatedAt: '',
  tenureMonths: null,
  latestPeriod: null,
  ...over,
});

const cu = (uploadId: string, year: number) =>
  ({ uploadId, year }) as TaxCertificateDto;

describe('work document file names', () => {
  it('names a workplace by its label, else its employer', () => {
    expect(workplaceFileName(workplace({ documents: [] }))).toBe('Acme S.p.A.');
    expect(workplaceFileName(workplace({ label: 'Acme', documents: [] }))).toBe(
      'Acme',
    );
  });

  it('names payslips by month and kind, a CU by its year', () => {
    expect(documentFileName(doc({}), 'Acme', 'scan.PDF')).toBe(
      '2026-10 - Cedolino - Acme.pdf',
    );
    expect(
      documentFileName(
        doc({ period: '2026-12', payslipKind: 'thirteenth' }),
        'Acme',
        'x.pdf',
      ),
    ).toBe('2026-12 - Tredicesima - Acme.pdf');
    expect(
      documentFileName(
        doc({ type: 'CERTIFICAZIONE_UNICA', payslipKind: null }),
        'Acme',
        'cu.pdf',
        2025,
      ),
    ).toBe('CU 2025 - Acme.pdf');
    expect(
      documentFileName(
        doc({
          type: 'EMPLOYMENT_CONTRACT',
          payslipKind: null,
          period: '2024-03-01',
          title: 'Contratto',
        }),
        'Acme',
        'c.pdf',
      ),
    ).toBe('2024-03-01 - Contratto.pdf');
  });

  it('finds a document with its workplace', () => {
    const w = workplace({ documents: [doc({ uploadId: 'a' })] });
    expect(findDocument({ workplaces: [w] }, 'a')?.workplace.id).toBe('w1');
    expect(findDocument({ workplaces: [w] }, 'b')).toBeNull();
  });
});

describe('payslipYearFiles', () => {
  it('takes the year of every workplace by month, each payslip once, and the CU of that income year', () => {
    const files = payslipYearFiles(
      {
        workplaces: [
          workplace({
            documents: [
              doc({ uploadId: 'nov', period: '2026-11' }),
              doc({ uploadId: 'oct', period: '2026-10' }),
              doc({ uploadId: 'oct-copy', period: '2026-10' }),
              doc({ uploadId: 'last-year', period: '2025-12' }),
              doc({
                uploadId: 'cu-2026',
                type: 'CERTIFICAZIONE_UNICA',
                payslipKind: null,
                period: '2027-03-16',
              }),
              doc({
                uploadId: 'cu-2025',
                type: 'CERTIFICAZIONE_UNICA',
                payslipKind: null,
                period: '2026-03-16',
              }),
            ],
          }),
          workplace({
            id: 'w2',
            label: 'Old job',
            documents: [doc({ uploadId: 'jan', period: '2026-01' })],
          }),
        ],
        certificates: [cu('cu-2026', 2026), cu('cu-2025', 2025)],
      },
      2026,
      new Map([['nov', 'nov.pdf']]),
      'Cedolini 2026',
    );
    expect(files).toEqual([
      { uploadId: 'jan', path: 'Cedolini 2026/2026-01 - Cedolino - Old job' },
      {
        uploadId: 'oct',
        path: 'Cedolini 2026/2026-10 - Cedolino - Acme S.p.A',
      },
      {
        uploadId: 'nov',
        path: 'Cedolini 2026/2026-11 - Cedolino - Acme S.p.A.pdf',
      },
      { uploadId: 'cu-2026', path: 'Cedolini 2026/CU 2026 - Acme S.p.A' },
    ]);
  });
});
