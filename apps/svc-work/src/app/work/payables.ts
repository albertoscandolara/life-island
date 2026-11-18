import {
  isoAddDays,
  isoAddMonths,
  type CareerDocumentDto,
  type PayableDto,
  type PayablesQuery,
} from '@life-island/contracts';

/*
 * Work as Money matching reads it (`GET /payables`,
 * docs/guides/money-matching.md): the net pay of every payslip, money coming
 * in from the employer. Pay arrives between the middle of the month it pays
 * and the 20th of the next (the 27th, or the 10th of the month after, are
 * both common in Italy).
 */

/** The first day of the month paid that the pay can arrive. */
export const PAY_FROM_DAY = 15;
/** The last day of the next month that the pay can arrive. */
export const PAY_UNTIL_DAY = 20;

const KEY = 'work:payslip:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const payslipPayableKey = (uploadId: string) => `${KEY}${uploadId}`;

/** The payslip a payable key names, or null when it is not one. */
export function payslipOfPayable(key: string): string | null {
  if (!key.startsWith(KEY)) return null;
  const id = key.slice(KEY.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** One payable (money in) per payslip with a month and a net pay. */
export function payslipPayables(
  employer: { name: string; payees: string[] },
  documents: readonly CareerDocumentDto[],
  query: PayablesQuery,
): PayableDto[] {
  return documents.flatMap((doc): PayableDto[] => {
    const month = doc.period?.slice(0, 7);
    if (doc.type !== 'PAYSLIP' || !month || !/^\d{4}-\d{2}$/.test(month))
      return [];
    if (!doc.net || !(doc.net > 0)) return [];
    const first = `${month}-01`;
    const window = {
      from: isoAddDays(first, PAY_FROM_DAY - 1),
      to: isoAddDays(isoAddMonths(first, 1), PAY_UNTIL_DAY - 1),
    };
    if (window.from > query.to || window.to < query.from) return [];
    return [
      {
        key: payslipPayableKey(doc.uploadId),
        module: 'work',
        kind: 'payslip',
        title: `${employer.name}: pay of ${month}`,
        payees: employer.payees,
        amount: Math.round(doc.net * 100) / 100,
        direction: 'in',
        // The end of the month paid: when most pay arrives.
        date: isoAddDays(isoAddMonths(first, 1), -1),
        window,
        path: '/work',
      },
    ];
  });
}
