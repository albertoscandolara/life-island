import {
  certificateMatches,
  payslipYears,
  recentMissingPayslips,
  type LifeAttentionItemDto,
  type WorkOverviewDto,
} from '@life-island/contracts';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const monthText = (period: string) =>
  `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** A CU this old (by its income year) no longer asks for you. */
const CU_YEARS = 2;

/**
 * What the payslips need from you with no date of their own, for the hub
 * and the Agenda (`GET /attention` items), as What's next on the Work page
 * shows them: the payslips missing in the last year (one item), and each
 * recent Certificazione Unica that differs from the payslips. Both open the
 * Payslips section.
 */
export function payslipAttention(
  overview: Pick<
    WorkOverviewDto,
    'workplaces' | 'certificates' | 'stats' | 'audit'
  >,
  today: string,
): LifeAttentionItemDto[] {
  const years = payslipYears({
    workplaces: overview.workplaces,
    certificates: overview.certificates,
    checks: overview.stats.checks,
    findings: overview.audit.findings,
    today,
  });
  const items: LifeAttentionItemDto[] = [];
  const missing = recentMissingPayslips(years, today);
  if (missing.length)
    items.push({
      id: `payslips-missing:${missing.join(',')}`,
      kind: 'payslip-missing',
      title:
        missing.length === 1
          ? `Load the payslip of ${monthText(missing[0])}`
          : `Load ${missing.length} missing payslips`,
      detail:
        missing.length === 1
          ? 'Without it your pay, TFR and CU checks have a gap.'
          : `${missing.map(monthText).join(', ')}: without them your pay, TFR and CU checks have gaps.`,
      since: null,
      path: '/work#work-payslips',
      action: 'Load it',
    });
  const thisYear = Number(today.slice(0, 4));
  for (const c of overview.certificates) {
    if (c.year < thisYear - CU_YEARS || certificateMatches(c) !== false)
      continue;
    items.push({
      id: `cu-differs:${c.uploadId}`,
      kind: 'cu-differs',
      title: `CU ${c.year} of ${c.workplaceName} differs from your payslips`,
      detail: c.missingMonths.length
        ? `No payslip for ${c.missingMonths.map(monthText).join(', ')}.`
        : 'A payslip differs from the one your employer counted, or a conguaglio.',
      since: null,
      path: '/work#work-payslips',
      action: 'Compare',
    });
  }
  return items;
}
