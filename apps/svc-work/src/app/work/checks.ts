import {
  ACTIVE_JOB_STATUSES,
  CCNL_RULES_SOURCES,
  ccnlMinimum,
  ccnlTableFor,
  JOB_APPLICATION_STALE_DAYS,
  METALMECCANICI_SENIORITY_STEP,
  PAR_HOURS_PER_YEAR,
  SENIORITY_STEP_MONTHS,
  SENIORITY_STEPS_MAX,
  TFR_DIVISOR,
  TFR_REVALUATION_TAX_PCT,
  TFR_SOURCE,
  tfrRevaluation,
  tfrSeparateTaxRate,
  vacationHoursPerYear,
  type JobApplicationDto,
  type JobApplicationStatus,
  type JobSearchStatsDto,
  type NetChangeDto,
  type NetChangePartDto,
  type PayslipAuditDto,
  type PayslipAuditFindingDto,
  type TfrDto,
  type TfrYearDto,
} from '@life-island/contracts';
import {
  countedPayslips,
  kindOf,
  monthsBetween,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';

/*
 * Checks on your payslips: against the CCNL rules (minimum, seniority
 * increments, vacation and PAR, tredicesima, TFR, contributions), the net
 * explained month by month, the TFR the company holds, and the job search.
 * Pure functions of what you approved, unit-tested.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
/** 2.462,50 €: amounts as the rest of Work shows them. */
const money = (n: number) =>
  `${n.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions)} €`;
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
  `${MONTHS[+period.slice(5, 7) - 1]} ${period.slice(0, 4)}`;

/** YYYY-MM plus `months`. */
function addMonths(period: string, months: number): string {
  const total = +period.slice(0, 4) * 12 + (+period.slice(5, 7) - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function byPeriod(docs: readonly ApprovedWorkDocument[]) {
  return countedPayslips(docs).sort((a, b) =>
    a.reading.period!.localeCompare(b.reading.period!),
  );
}

// ---- audit -----------------------------------------------------------------

/**
 * Your payslips against the rules of your CCNL and against each other. A
 * problem is a rule the payslip seems to break; a check is something to look
 * at (the rule has exceptions the payslip does not show); info is worth
 * knowing. Only the Metalmeccanici industria rules are known.
 */
export function buildAudit(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  today: string,
): PayslipAuditDto {
  const current =
    workplaces.find((w) => w.status === 'current') ?? workplaces[0] ?? null;
  const payslips = byPeriod(docs).filter(
    (p) => !current || p.workplaceId === current.id,
  );
  const monthly = payslips.filter((p) => kindOf(p.reading) === 'regular');
  const latest = monthly.at(-1) ?? null;
  const agreement =
    str(current?.values.collectiveAgreement) ??
    str(latest?.reading.values.collectiveAgreement);
  const table = ccnlTableFor(agreement);
  const findings: PayslipAuditFindingDto[] = [];
  const passed: string[] = [];
  const find = (f: PayslipAuditFindingDto) => findings.push(f);
  const levelOf = (p: ApprovedWorkDocument) => str(p.reading.values.level);

  // 1. The minimum of the level, month by month.
  if (table) {
    let below = 0;
    for (const p of monthly) {
      const level = levelOf(p);
      const base = num(p.reading.values.baseMinimum);
      if (!level || base === null || !table.levels.includes(level)) continue;
      const minimum = ccnlMinimum(table, level, p.reading.period!);
      if (minimum === null || base >= minimum - 0.5) continue;
      below++;
      const before = ccnlMinimum(
        table,
        level,
        addMonths(p.reading.period!, -12),
      );
      const late = before !== null && Math.abs(base - before) < 0.5;
      find({
        kind: 'below_minimum',
        severity: 'problem',
        uploadId: p.uploadId,
        period: p.reading.period,
        title: `${monthText(p.reading.period!)}: minimum below the CCNL's`,
        detail: late
          ? `The payslip pays the ${level} minimum of the year before (${money(base)}) instead of ${money(minimum)}: the renewal was not applied yet. It is usually paid back as arrears (arretrati) a month or two later: check that it was.`
          : `The ${level} minimum printed is ${money(base)}, the CCNL's is ${money(minimum)}.`,
        amount: round2(minimum - base),
      });
    }
    if (!below && monthly.some((p) => num(p.reading.values.baseMinimum)))
      passed.push('Every payslip pays at least the CCNL minimum of its level.');
  }

  // 2. Seniority increments: one every two years at the company, five at most.
  const hire = str(current?.values.hireDate);
  if (table && hire && latest) {
    const months = monthsBetween(hire, `${latest.reading.period}-28`);
    const expected = Math.min(
      SENIORITY_STEPS_MAX,
      Math.floor(months / SENIORITY_STEP_MONTHS),
    );
    const printed = num(latest.reading.values.seniorityIncrements);
    const level = levelOf(latest);
    const step = level ? (METALMECCANICI_SENIORITY_STEP[level] ?? null) : null;
    if (printed !== null && printed < expected)
      find({
        kind: 'seniority_count',
        severity: 'check',
        uploadId: latest.uploadId,
        period: latest.reading.period,
        title: `${printed} seniority increment${printed === 1 ? '' : 's'}, ${expected} expected`,
        detail: `Hired ${hire}, you have ${Math.floor(months / 12)} years at the company: one increment matures every two years, up to five. Fewer can be right (an apprenticeship, a part of the time not counted), but ask the payroll office.${step ? ` Each one is worth ${money(step)} a month at ${level}.` : ''}`,
        amount: step ? round2((expected - printed) * step) : null,
      });
    else if (printed !== null)
      passed.push(
        `The seniority increments (${printed}) match your years at the company.`,
      );
    if (expected < SENIORITY_STEPS_MAX) {
      const next = addMonths(
        hire.slice(0, 7),
        (expected + 1) * SENIORITY_STEP_MONTHS,
      );
      if (next >= today.slice(0, 7))
        find({
          kind: 'next_increment',
          severity: 'info',
          uploadId: null,
          period: next,
          title: `Next seniority increment in ${monthText(next)}`,
          detail: `Increment ${expected + 1} of ${SENIORITY_STEPS_MAX}${step ? `: +${money(step)} a month at ${level}` : ''}. It is yours on top of any rise: it cannot be absorbed by a merit rise, nor absorb one.`,
          amount: step,
        });
    }
    // What the increments add up to on the payslip.
    const base = num(latest.reading.values.baseMinimum);
    const salary = num(latest.reading.values.monthlySalary);
    const superminimum = num(latest.reading.values.superminimum) ?? 0;
    if (printed && step && base !== null && salary !== null) {
      const rest = salary - base - superminimum;
      const owed = printed * step;
      if (rest < owed - 1)
        find({
          kind: 'seniority_amount',
          severity: 'check',
          uploadId: latest.uploadId,
          period: latest.reading.period,
          title: 'The increments seem to pay less than their amount',
          detail: `${printed} increments at ${level} are ${money(owed)} a month, but the salary leaves ${money(Math.max(0, rest))} beyond the minimum and the superminimum. They may be valued at the level you had when each matured: check the payslip's "scatti" line.`,
          amount: round2(owed - Math.max(0, rest)),
        });
    }
  }

  // 3. Superminimum absorbed at a renewal or a promotion.
  let previous: ApprovedWorkDocument | null = null;
  for (const p of monthly) {
    const before = previous;
    previous = p;
    if (!before) continue;
    const was = num(before.reading.values.superminimum);
    const now = num(p.reading.values.superminimum) ?? 0;
    const baseWas = num(before.reading.values.baseMinimum);
    const baseNow = num(p.reading.values.baseMinimum);
    if (
      was === null ||
      now >= was - 0.5 ||
      baseWas === null ||
      baseNow === null
    )
      continue;
    const absorbed = round2(was - now);
    const rise = round2(baseNow - baseWas);
    const promoted = levelOf(before) !== levelOf(p);
    find({
      kind: 'superminimum_absorbed',
      severity: absorbed > rise + 0.5 ? 'problem' : 'info',
      uploadId: p.uploadId,
      period: p.reading.period,
      title: `${monthText(p.reading.period!)}: ${money(absorbed)} of superminimum absorbed`,
      detail:
        absorbed > rise + 0.5
          ? `The superminimum fell by ${money(absorbed)} while the minimum rose by only ${money(rise)}: absorption can take at most the rise. Ask the payroll office.`
          : `${promoted ? 'The promotion' : 'The CCNL renewal'} raised the minimum by ${money(rise)} and took ${money(absorbed)} back from your superminimum ("assorbibile"): you got ${money(round2(rise - absorbed))} of it. Allowed, but worth knowing at your next negotiation: ask for a non-absorbable superminimum.`,
      amount: absorbed,
    });
  }

  // 4. Vacation and PAR piling up.
  if (table && latest) {
    const years = hire
      ? monthsBetween(hire, `${latest.reading.period}-28`) / 12
      : 0;
    const entitlement = vacationHoursPerYear(years);
    const vacation = latest.reading.vacationLeft;
    if (vacation !== null && vacation > entitlement)
      find({
        kind: 'vacation_backlog',
        severity: 'check',
        uploadId: latest.uploadId,
        period: latest.reading.period,
        title: `${vacation} h of vacation left, more than a year's ${entitlement} h`,
        detail:
          'At least two weeks of each year must be taken in that year, the rest within 18 months of its end. Vacation older than that cannot be paid instead of taken while you work there: plan it, or the company may schedule it for you.',
        amount: round2(vacation - entitlement),
      });
    else if (vacation !== null)
      passed.push(
        `Your vacation left (${vacation} h) is within a year's entitlement.`,
      );
    const par = latest.reading.leaveLeft;
    if (par !== null && par > PAR_HOURS_PER_YEAR)
      find({
        kind: 'par_backlog',
        severity: 'info',
        uploadId: latest.uploadId,
        period: latest.reading.period,
        title: `${par} h of PAR (ROL, permessi) left`,
        detail: `More than a year's ${PAR_HOURS_PER_YEAR} h. Unused PAR goes to your hours account for 24 months; what is still there after that is paid, so it is not lost, but the company can ask you to schedule it.`,
        amount: round2(par - PAR_HOURS_PER_YEAR),
      });
  }

  // 5. The tredicesima: a monthly salary for a full year, a twelfth a month otherwise.
  for (const p of payslips.filter((d) => kindOf(d.reading) === 'thirteenth')) {
    const year = p.reading.period!.slice(0, 4);
    const ofYear = monthly.filter((m) => m.reading.period!.startsWith(year));
    const salary = num(ofYear.at(-1)?.reading.values.monthlySalary);
    const gross = p.reading.gross;
    if (salary === null || gross === null) continue;
    const start = hire && hire.slice(0, 4) === year ? hire.slice(0, 7) : null;
    const months = start
      ? 12 - (+start.slice(5, 7) - 1) - (+hire!.slice(8, 10) > 15 ? 1 : 0)
      : 12;
    const expected = round2((salary * months) / 12);
    if (gross < expected * 0.98)
      find({
        kind: 'thirteenth_amount',
        severity: 'check',
        uploadId: p.uploadId,
        period: p.reading.period,
        title: `Tredicesima ${year}: ${money(gross)}, about ${money(expected)} expected`,
        detail: `${months} months worked in ${year} at a monthly salary of ${money(salary)}. Unpaid leave, sick leave beyond what is covered or part time lower it: check the months it was computed on.`,
        amount: round2(expected - gross),
      });
  }

  // 6. TFR of each full year: the year's pay over 13.5.
  const tfrYears = new Map<string, ApprovedWorkDocument[]>();
  for (const p of payslips) {
    const year = p.reading.period!.slice(0, 4);
    tfrYears.set(year, [...(tfrYears.get(year) ?? []), p]);
  }
  let tfrChecked = 0;
  for (const [year, list] of tfrYears) {
    const regular = list.filter((p) => kindOf(p.reading) === 'regular');
    if (regular.length < 12) continue;
    const accrued = list.reduce((s, p) => s + (p.reading.severance ?? 0), 0);
    const gross = list.reduce((s, p) => s + (p.reading.gross ?? 0), 0);
    if (!accrued || !gross) continue;
    tfrChecked++;
    const expected = gross / TFR_DIVISOR;
    if (accrued < expected * 0.85)
      find({
        kind: 'tfr_quota',
        severity: 'check',
        uploadId: null,
        period: `${year}-12`,
        title: `TFR ${year}: ${money(accrued)}, about ${money(expected)} expected`,
        detail:
          'The TFR of a year is its pay divided by 13.5. Occasional items (some allowances, expense refunds) do not count, so a few percent less is normal, but this is more.',
        amount: round2(expected - accrued),
      });
  }
  if (tfrChecked && !findings.some((f) => f.kind === 'tfr_quota'))
    passed.push('The TFR of each full year is about its pay over 13.5.');

  // 7. Employee contributions: 9.19% for most, 10.19% above the threshold.
  let oddRates = 0;
  for (const p of monthly) {
    const { gross, contributions } = p.reading;
    if (!gross || contributions === null || gross < 500) continue;
    const rate = (contributions / gross) * 100;
    if (rate < 8.8 || rate > 10.5) {
      oddRates++;
      if (oddRates <= 3)
        find({
          kind: 'contribution_rate',
          severity: 'info',
          uploadId: p.uploadId,
          period: p.reading.period,
          title: `${monthText(p.reading.period!)}: contributions at ${rate.toFixed(2)}% of the gross`,
          detail:
            'Usually 9.19% (9.49% in larger companies, plus 1% above about 4,000 € a month). Non-taxable items in the gross, or a contribution relief, explain a different share.',
          amount: contributions,
        });
    }
  }
  if (monthly.length && !oddRates)
    passed.push('Your contributions are the usual share of the gross.');

  const rank = { problem: 0, check: 1, info: 2 } as const;
  return {
    agreement,
    rulesKnown: table !== null,
    checkedPayslips: payslips.length,
    findings: findings.sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        (b.period ?? '').localeCompare(a.period ?? ''),
    ),
    passed,
    sources: table
      ? [...CCNL_RULES_SOURCES, table.source, TFR_SOURCE]
      : [TFR_SOURCE],
  };
}

// ---- the net explained -----------------------------------------------------

/**
 * Why the net changed from each monthly payslip to the next: the salary,
 * overtime, travel, the rest of the gross, contributions, IRPEF, surtaxes,
 * the IRPEF adjustment, tax credits and the pension fund, each signed as
 * its effect on the net. What the payslips do not itemize is "other".
 */
export function buildNetChanges(
  docs: readonly ApprovedWorkDocument[],
  limit = 12,
): NetChangeDto[] {
  const monthly = byPeriod(docs).filter(
    (p) => kindOf(p.reading) === 'regular' && p.reading.net !== null,
  );
  const changes: NetChangeDto[] = [];
  for (let i = 1; i < monthly.length; i++) {
    const a = monthly[i - 1];
    const b = monthly[i];
    if (a.workplaceId !== b.workplaceId) continue;
    const ra = a.reading;
    const rb = b.reading;
    const change = round2(rb.net! - ra.net!);
    const delta = (pick: (r: typeof ra) => number | null) => {
      const x = pick(ra);
      const y = pick(rb);
      return x === null && y === null ? 0 : (y ?? 0) - (x ?? 0);
    };
    const salary = delta((r) => num(r.values.monthlySalary));
    const overtime = delta((r) => r.overtimePay);
    const travel = delta((r) => r.travelAllowance);
    const gross = delta((r) => r.gross);
    const parts: NetChangePartDto[] = [
      { label: 'Monthly salary', amount: salary },
      { label: 'Overtime', amount: overtime },
      { label: 'Travel allowances', amount: travel },
      {
        label: 'Other pay (bonus, absences, allowances)',
        amount:
          rb.gross !== null && ra.gross !== null
            ? gross - salary - overtime - travel
            : 0,
      },
      { label: 'Contributions', amount: -delta((r) => r.contributions) },
      { label: 'IRPEF', amount: -delta((r) => r.incomeTax) },
      {
        label: 'Regional and municipal surtaxes',
        amount: -delta((r) =>
          r.regionalSurtax === null && r.municipalSurtax === null
            ? null
            : (r.regionalSurtax ?? 0) + (r.municipalSurtax ?? 0),
        ),
      },
      {
        label: 'IRPEF adjustment (conguaglio, 730)',
        amount: -delta((r) => r.taxAdjustment),
      },
      { label: 'Tax credits paid', amount: delta((r) => r.taxCredit) },
      { label: 'Pension fund', amount: -delta((r) => r.pensionFundEmployee) },
    ].map((p) => ({ ...p, amount: round2(p.amount) }));
    const explained = parts.reduce((s, p) => s + p.amount, 0);
    parts.push({
      label: 'Other deductions and credits',
      amount: round2(change - explained),
    });
    changes.push({
      uploadId: b.uploadId,
      period: rb.period!,
      previousPeriod: ra.period!,
      net: rb.net!,
      previousNet: ra.net!,
      change,
      parts: parts
        .filter((p) => Math.abs(p.amount) >= 0.5)
        .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)),
    });
  }
  return changes.reverse().slice(0, limit);
}

// ---- TFR ---------------------------------------------------------------------

/**
 * The TFR the company holds, from your payslips: each year's quotas, less
 * what went to a pension fund, revalued every year with the ISTAT
 * coefficient after its 17% tax. Only what the payslips on record show:
 * TFR from before them is not in it.
 */
export function buildTfr(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  ral: number | null,
  today: string,
): TfrDto {
  const current =
    workplaces.find((w) => w.status === 'current') ?? workplaces[0] ?? null;
  const payslips = byPeriod(docs).filter(
    (p) => !current || p.workplaceId === current.id,
  );
  const byYear = new Map<number, ApprovedWorkDocument[]>();
  for (const p of payslips) {
    const year = +p.reading.period!.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), p]);
  }
  const sum = (
    list: ApprovedWorkDocument[],
    pick: (d: ApprovedWorkDocument) => number | null,
  ) => round2(list.reduce((s, d) => s + (pick(d) ?? 0), 0));
  let fund = 0;
  const thisYear = +today.slice(0, 4);
  const years: TfrYearDto[] = [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => {
      const list = byYear.get(year)!;
      const accrued = sum(list, (d) => d.reading.severance);
      const toFund = sum(list, (d) => d.reading.tfrToFund);
      const gross = sum(list, (d) => d.reading.gross);
      const regular = list.filter(
        (d) => kindOf(d.reading) === 'regular',
      ).length;
      const { pct, estimated } = tfrRevaluation(year);
      // A year still running is revalued at its end: none yet.
      const running = year >= thisYear;
      const revaluation = running ? 0 : round2((fund * pct) / 100);
      const revaluationTax = round2(
        (revaluation * TFR_REVALUATION_TAX_PCT) / 100,
      );
      fund = round2(fund + revaluation - revaluationTax + accrued - toFund);
      return {
        year,
        payslips: list.length,
        accrued,
        toFund,
        expected: regular >= 12 && gross ? round2(gross / TFR_DIVISOR) : null,
        revaluationPct: pct,
        revaluationEstimated: estimated || running,
        revaluation,
        revaluationTax,
        companyFund: fund,
      };
    });
  const all = payslips;
  const first = all[0]?.reading.period ?? null;
  const fundYears = first ? Math.max(1, monthsBetween(first, today) / 12) : 1;
  return {
    years: years.reverse(),
    companyFund: fund,
    fundTotal: sum(all, (d) => d.reading.tfrToFund),
    employeeContributions: sum(all, (d) => d.reading.pensionFundEmployee),
    employerContributions: sum(all, (d) => d.reading.pensionFundEmployer),
    inFund: all.some(
      (d) =>
        (d.reading.tfrToFund ?? 0) > 0 ||
        (d.reading.pensionFundEmployee ?? 0) > 0,
    ),
    ral,
    separateTaxPct:
      fund > 0 ? tfrSeparateTaxRate(fund, fundYears, thisYear) : null,
    firstPeriod: first,
    source: TFR_SOURCE,
  };
}

// ---- job search ----------------------------------------------------------------

export interface JobApplicationRow {
  id: string;
  company: string;
  role: string;
  source: string | null;
  url: string | null;
  location: string | null;
  status: JobApplicationStatus;
  appliedAt: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  ralMin: number | null;
  ralMax: number | null;
  offerRal: number | null;
  offerMonths: number | null;
  offerWelfare: number | null;
  offerBonus: number | null;
  notes: string | null;
  history: { status: JobApplicationStatus; at: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const daysBetween = (from: string, to: string) =>
  Math.max(
    0,
    Math.round(
      (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) /
        86_400_000,
    ),
  );

export function jobApplicationDto(
  row: JobApplicationRow,
  today: string,
): JobApplicationDto {
  const active = ACTIVE_JOB_STATUSES.includes(row.status);
  const last = row.history.at(-1)?.at ?? row.updatedAt.toISOString();
  const idleDays = active ? daysBetween(last, today) : null;
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    source: row.source,
    url: row.url,
    location: row.location,
    status: row.status,
    appliedAt: row.appliedAt,
    nextStep: row.nextStep,
    nextStepAt: row.nextStepAt,
    ralMin: row.ralMin,
    ralMax: row.ralMax,
    offerRal: row.offerRal,
    offerMonths:
      row.offerMonths === 13 || row.offerMonths === 14 ? row.offerMonths : null,
    offerWelfare: row.offerWelfare,
    offerBonus: row.offerBonus,
    notes: row.notes,
    history: row.history,
    idleDays,
    // Waiting on them, with no news and no next step planned.
    stale:
      (row.status === 'applied' ||
        row.status === 'screening' ||
        row.status === 'interview') &&
      idleDays !== null &&
      idleDays >= JOB_APPLICATION_STALE_DAYS &&
      !(row.nextStepAt && row.nextStepAt >= today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Active first (next step soonest), then the rest, newest first. */
export function sortApplications(
  list: JobApplicationDto[],
): JobApplicationDto[] {
  const active = (a: JobApplicationDto) =>
    ACTIVE_JOB_STATUSES.includes(a.status) ? 0 : 1;
  return [...list].sort(
    (a, b) =>
      active(a) - active(b) ||
      (a.nextStepAt ?? '9999').localeCompare(b.nextStepAt ?? '9999') ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function buildJobSearchStats(
  list: readonly JobApplicationDto[],
): JobSearchStatsDto {
  const reached = (a: JobApplicationDto, statuses: JobApplicationStatus[]) =>
    a.history.some((h) => statuses.includes(h.status)) ||
    statuses.includes(a.status);
  const sent = list.filter((a) => a.status !== 'saved');
  const answered = sent.filter((a) =>
    reached(a, ['screening', 'interview', 'offer', 'accepted', 'rejected']),
  );
  const waits = answered.flatMap((a) => {
    const applied =
      a.appliedAt ?? a.history.find((h) => h.status === 'applied')?.at ?? null;
    const answer = a.history.find((h) =>
      ['screening', 'interview', 'offer', 'accepted', 'rejected'].includes(
        h.status,
      ),
    )?.at;
    return applied && answer && answer >= applied
      ? [daysBetween(applied, answer)]
      : [];
  });
  return {
    total: list.length,
    active: list.filter((a) => ACTIVE_JOB_STATUSES.includes(a.status)).length,
    sent: sent.length,
    answered: answered.length,
    responseRatePct: sent.length
      ? Math.round((answered.length / sent.length) * 100)
      : null,
    interviews: list.filter((a) =>
      reached(a, ['interview', 'offer', 'accepted']),
    ).length,
    offers: list.filter((a) => reached(a, ['offer', 'accepted'])).length,
    averageDaysToAnswer: waits.length
      ? Math.round(waits.reduce((s, d) => s + d, 0) / waits.length)
      : null,
    stale: list.filter((a) => a.stale).length,
  };
}
