import { suggestMatches, type CareerDocumentDto } from '@life-island/contracts';
import {
  payslipOfPayable,
  payslipPayableKey,
  payslipPayables,
} from './payables.js';

const ID = '9b1c2b3a-1111-4222-8333-944455556666';
const employer = { name: 'Acme', payees: ['ACME S.P.A.', 'Acme'] };
const query = { from: '2026-01-01', to: '2026-12-31' };

const payslip = (over: Partial<CareerDocumentDto> = {}): CareerDocumentDto => ({
  uploadId: ID,
  title: 'Cedolino ottobre',
  type: 'PAYSLIP',
  period: '2026-10',
  gross: 3200,
  net: 2187.45,
  facts: [],
  uploadedAt: '2026-11-01T00:00:00Z',
  reviewedAt: '2026-11-01T00:00:00Z',
  bankPayment: null,
  ...over,
});

describe('payslips as money coming in', () => {
  it('keys a payslip and reads it back', () => {
    expect(payslipOfPayable(payslipPayableKey(ID))).toBe(ID);
    expect(payslipOfPayable('work:payslip:x')).toBeNull();
    expect(payslipOfPayable(`cars:cost:${ID}`)).toBeNull();
  });

  it('expects the net pay from the middle of the month to the 20th of the next', () => {
    expect(payslipPayables(employer, [payslip()], query)).toEqual([
      {
        key: payslipPayableKey(ID),
        module: 'work',
        kind: 'payslip',
        title: 'Acme: pay of 2026-10',
        payees: ['ACME S.P.A.', 'Acme'],
        amount: 2187.45,
        direction: 'in',
        date: '2026-10-31',
        window: { from: '2026-10-15', to: '2026-11-20' },
        path: '/work',
      },
    ]);
    // Read as a date (YYYY-MM-DD) too.
    expect(
      payslipPayables(employer, [payslip({ period: '2026-12-01' })], query)[0]
        .window,
    ).toEqual({ from: '2026-12-15', to: '2027-01-20' });
  });

  it('leaves out other documents, payslips without a net or a month, and other days', () => {
    expect(
      payslipPayables(
        employer,
        [
          payslip({ type: 'CERTIFICAZIONE_UNICA' }),
          payslip({ net: null }),
          payslip({ period: null }),
        ],
        query,
      ),
    ).toEqual([]);
    expect(
      payslipPayables(employer, [payslip()], {
        from: '2026-11-21',
        to: '2026-12-31',
      }),
    ).toEqual([]);
  });

  it('matches the salary transfer, never a payment of the same amount', () => {
    const payables = payslipPayables(employer, [payslip()], query);
    const move = (amount: number) => ({
      id: 'm1',
      date: '2026-10-27',
      amount,
      description: 'BONIFICO DA ACME S.P.A. STIPENDIO OTTOBRE',
    });
    expect(suggestMatches([move(2187.45)], payables, [])[0]).toMatchObject({
      confidence: 'sure',
    });
    expect(suggestMatches([move(-2187.45)], payables, [])).toEqual([]);
  });
});
