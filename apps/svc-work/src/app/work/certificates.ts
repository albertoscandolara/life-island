import type { TaxCertificateDto } from '@life-island/contracts';
import {
  countedPayslips,
  kindOf,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';

/*
 * Each Certificazione Unica you approved next to the payslips of the same
 * workplace and year: the CU is what the employer declared, the payslips what
 * you have; a gap means a payslip is missing or read wrong.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumOf = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? round2(present.reduce((a, b) => a + b, 0)) : null;
};

/** The months of a year you worked at a workplace: from the hire to the end date, if in that year. */
function monthsOfYear(year: number, workplace: CareerWorkplace | undefined) {
  const hire = String(workplace?.values.hireDate ?? '').slice(0, 7);
  const end = String(workplace?.values.endDate ?? '').slice(0, 7);
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const period = `${year}-${String(m).padStart(2, '0')}`;
    if (hire && period < hire) continue;
    if (end && period > end) continue;
    months.push(period);
  }
  return months;
}

/**
 * CU IRPEF minus the payslips'. A payslip can print the 5% tax on a
 * productivity bonus in its tax total, while the CU keeps it apart (punto
 * 576): when taking it out of the payslips' side closes the gap, it is.
 */
function taxGapOf(
  cuWithheld: number,
  payslips: number,
  bonusTax: number | null,
): number {
  const gap = round2(cuWithheld - payslips);
  if (!bonusTax) return gap;
  const withoutBonus = round2(gap + bonusTax);
  return Math.abs(withoutBonus) < Math.abs(gap) ? withoutBonus : gap;
}

export function buildCertificates(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
): TaxCertificateDto[] {
  const workplaceOf = new Map(workplaces.map((w) => [w.id, w]));
  const payslips = countedPayslips(docs);
  const seen = new Set<string>();
  const certificates: TaxCertificateDto[] = [];
  for (const doc of docs) {
    const cu = doc.reading.certificate;
    if (doc.reading.type !== 'CERTIFICAZIONE_UNICA' || !cu?.year) continue;
    const key = `${doc.workplaceId}|${cu.year}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const workplace = workplaceOf.get(doc.workplaceId);
    const own = payslips.filter(
      (p) =>
        p.workplaceId === doc.workplaceId &&
        p.reading.period!.startsWith(`${cu.year}-`),
    );
    const have = new Set(
      own
        .filter((p) => kindOf(p.reading) === 'regular')
        .map((p) => p.reading.period!),
    );
    const allTaxable =
      own.length > 0 && own.every((p) => p.reading.taxable !== null);
    const payslipIncome = own.length
      ? sumOf(
          own.map((p) => (allTaxable ? p.reading.taxable : p.reading.gross)),
        )
      : null;
    // The year-end conguaglio is on December's payslip (a refund is negative);
    // a 730 refund or charge in the summer is about last year, so not counted.
    const payslipIncomeTax = sumOf([
      ...own.map((p) => p.reading.incomeTax),
      ...own
        .filter((p) => p.reading.period!.endsWith('-12'))
        .map((p) => p.reading.taxAdjustment),
    ]);
    certificates.push({
      uploadId: doc.uploadId,
      title: doc.title,
      workplaceId: doc.workplaceId,
      workplaceName: workplace?.name ?? doc.reading.employerName ?? '',
      year: cu.year,
      income: cu.income,
      days: cu.days,
      irpefWithheld: cu.irpefWithheld,
      surtaxes: sumOf([cu.regionalSurtax, cu.municipalSurtax]),
      grossTax: cu.grossTax,
      totalDeductions: cu.totalDeductions,
      netTax: cu.netTax,
      pensionFundDeducted: cu.pensionFundDeducted,
      pensionFundNotDeducted: cu.pensionFundNotDeducted,
      payslips: own.length,
      missingMonths: own.length
        ? monthsOfYear(cu.year, workplace).filter((m) => !have.has(m))
        : [],
      payslipIncome,
      payslipIncomeKind:
        payslipIncome === null ? null : allTaxable ? 'taxable' : 'gross',
      incomeGap:
        cu.income !== null && payslipIncome !== null && allTaxable
          ? round2(cu.income - payslipIncome)
          : null,
      taxGap:
        cu.irpefWithheld !== null && payslipIncomeTax !== null
          ? taxGapOf(
              cu.irpefWithheld,
              payslipIncomeTax,
              cu.productivityBonusTax,
            )
          : null,
      payslipIncomeTax,
    });
  }
  return certificates.sort(
    (a, b) => b.year - a.year || a.workplaceName.localeCompare(b.workplaceName),
  );
}
