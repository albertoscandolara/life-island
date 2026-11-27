import type { ApprovedWorkDocument, CareerWorkplace } from './career.js';
import { buildCertificates } from './certificates.js';
import { readWorkDocument } from './work-documents.js';

// Made-up amounts, shaped like a real year: twelve months, a December
// conguaglio refund and a productivity bonus taxed at 5%.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: { employerName: 'ESEMPIO LAVORI S.R.L.', hireDate: '2020-03-01' },
};

const payslip = (
  month: string,
  extra: Record<string, string | number | null> = {},
): ApprovedWorkDocument => ({
  uploadId: `p-${month}`,
  title: `Payslip ${month}`,
  workplaceId: 'w1',
  reading: readWorkDocument('PAYSLIP', {
    employer: 'ESEMPIO LAVORI S.R.L.',
    pay_period: `2025-${month}-01/2025-${month}-28`,
    gross_pay: 2200,
    taxable_income: 2000,
    income_tax_withheld: 300,
    net_pay: 1600,
    ...extra,
  }),
});

const cu = (extra: Record<string, string | number | null>) =>
  ({
    uploadId: 'cu',
    title: 'CU 2026',
    workplaceId: 'w1',
    reading: readWorkDocument('CERTIFICAZIONE_UNICA', {
      employer: 'ESEMPIO LAVORI S.R.L.',
      income_year: 2025,
      employment_income: 24000,
      ...extra,
    }),
  }) satisfies ApprovedWorkDocument;

const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];

describe('buildCertificates', () => {
  it("counts December's year-end conguaglio, not a summer 730 refund", () => {
    const docs = [
      ...months.map((m) =>
        payslip(m, m === '07' ? { tax_adjustment: -150 } : {}),
      ),
      payslip('12', { income_tax_withheld: null, tax_adjustment: -400 }),
      cu({ irpef_withheld: 3300 - 400 }),
    ];
    const [c] = buildCertificates([workplace], docs);
    expect(c).toMatchObject({ incomeGap: 0, taxGap: 0, payslipIncomeTax: 2900 });
  });

  it('leaves out the 5% bonus tax the payslips print with IRPEF', () => {
    const docs = [
      ...months.map((m) =>
        payslip(m, m === '05' ? { income_tax_withheld: 324.15 } : {}),
      ),
      payslip('12'),
      cu({ irpef_withheld: 3600, productivity_bonus_tax: 24.15 }),
    ];
    expect(buildCertificates([workplace], docs)[0].taxGap).toBe(0);
  });

  it('keeps a real gap', () => {
    const docs = [
      ...months.map((m) => payslip(m)),
      cu({ irpef_withheld: 3600, productivity_bonus_tax: 24.15 }),
    ];
    expect(buildCertificates([workplace], docs)[0]).toMatchObject({
      incomeGap: 2000,
      taxGap: 300,
    });
  });
});
