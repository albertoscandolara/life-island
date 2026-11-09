import {
  ccnlMinimum,
  ccnlTableFor,
  FOI_LAST_YEAR,
  FOI_PARTIAL_YEAR,
  FOI_SOURCE,
  foiIndex,
  goalKey,
  marginalBracket,
  nextCcnlLevel,
  type BriefFactDto,
  type CareerInsightsDto,
  type CareerStatsDto,
  type CcnlComparisonDto,
  type EvaluationStatsDto,
  type GoalDto,
  type GoalStatus,
  type MarketCheckDto,
  type NegotiationBriefDto,
  type OfferBaselineDto,
  type PackageYearDto,
  type RealPayDto,
  type ReviewPayDto,
  type SalaryPartsPointDto,
  type TaxCertificateDto,
  type TaxMonthDto,
  type IncomeTaxYearDto,
  type TimeOffDto,
  type WorkloadPointDto,
} from '@life-island/contracts';
import {
  countedPayslips,
  kindOf,
  monthsBetween,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';
import { readLines } from './work-documents.js';

/*
 * The career analysis of Work: your pay against inflation, the CCNL and the
 * tax brackets, what it is made of, time off, workload, and how reviews
 * turned into pay. Pure functions of what you approved, unit-tested.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const sum = (values: (number | null)[]) =>
  round2(values.reduce<number>((s, v) => s + (v ?? 0), 0));
const pctChange = (from: number | null, to: number | null) =>
  from && to !== null ? round1(((to - from) / from) * 100) : null;
/** 2.462 €: amounts as the rest of Work shows them. */
const money = (n: number) =>
  `${n.toLocaleString('it-IT', {
    maximumFractionDigits: 0,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions)} €`;

/** YYYY-MM plus `months`. */
function addMonths(period: string, months: number): string {
  const total = +period.slice(0, 4) * 12 + (+period.slice(5, 7) - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export interface InsightsInput {
  workplaces: readonly CareerWorkplace[];
  documents: readonly ApprovedWorkDocument[];
  stats: CareerStatsDto;
  evaluations: EvaluationStatsDto;
  certificates: readonly TaxCertificateDto[];
  today: string;
}

/** The monthly payslips, each once, oldest first. */
function monthlyPayslips(docs: readonly ApprovedWorkDocument[]) {
  return countedPayslips(docs)
    .filter((d) => kindOf(d.reading) === 'regular')
    .sort((a, b) => a.reading.period!.localeCompare(b.reading.period!));
}

function allPayslips(docs: readonly ApprovedWorkDocument[]) {
  return countedPayslips(docs).sort((a, b) =>
    a.reading.period!.localeCompare(b.reading.period!),
  );
}

export function buildRealPay(
  docs: readonly ApprovedWorkDocument[],
): RealPayDto {
  const byYear = new Map<number, number[]>();
  for (const p of monthlyPayslips(docs)) {
    const salary = num(p.reading.values.monthlySalary);
    if (salary === null) continue;
    const year = +p.reading.period!.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), salary]);
  }
  const yearsOnRecord = [...byYear.keys()].sort((a, b) => a - b);
  const latest = yearsOnRecord.at(-1) ?? null;
  // Real euros of the latest year on record, or of the latest FOI year.
  const baseYear = latest === null ? null : Math.min(latest, FOI_LAST_YEAR);
  const baseFoi = baseYear === null ? null : foiIndex(baseYear);
  let previous: { salary: number; real: number | null } | null = null;
  const years = yearsOnRecord.map((year) => {
    const salaries = byYear.get(year)!;
    const averageSalary = round2(
      salaries.reduce((s, v) => s + v, 0) / salaries.length,
    );
    const foi = foiIndex(Math.min(year, FOI_LAST_YEAR));
    const before = foiIndex(Math.min(year, FOI_LAST_YEAR) - 1);
    const realSalary =
      foi && baseFoi ? round2((averageSalary * baseFoi) / foi) : null;
    const row = {
      year,
      averageSalary,
      foi,
      inflationPct: foi && before ? round1((foi / before - 1) * 100) : null,
      realSalary,
      nominalChangePct: previous
        ? pctChange(previous.salary, averageSalary)
        : null,
      realChangePct:
        previous && previous.real !== null
          ? pctChange(previous.real, realSalary)
          : null,
    };
    previous = { salary: averageSalary, real: realSalary };
    return row;
  });
  const first = years[0];
  const last = years.at(-1);
  const firstFoi = first ? foiIndex(Math.min(first.year, FOI_LAST_YEAR)) : null;
  return {
    baseYear,
    years,
    nominalGrowthPct:
      first && last && first !== last
        ? pctChange(first.averageSalary, last.averageSalary)
        : null,
    inflationPct:
      first && last && first !== last && firstFoi && baseFoi
        ? round1((baseFoi / firstFoi - 1) * 100)
        : null,
    realGrowthPct:
      first && last && first !== last
        ? pctChange(first.realSalary, last.realSalary)
        : null,
    partialNote:
      latest !== null && latest >= FOI_PARTIAL_YEAR.year
        ? `Prices of ${FOI_PARTIAL_YEAR.year} are the average of ${FOI_PARTIAL_YEAR.months}.`
        : null,
    source: FOI_SOURCE,
  };
}

export function buildSalaryParts(
  docs: readonly ApprovedWorkDocument[],
): SalaryPartsPointDto[] {
  return monthlyPayslips(docs).map((p) => {
    const v = p.reading.values;
    const total = num(v.monthlySalary);
    const base = num(v.baseMinimum);
    const superminimum = num(v.superminimum);
    const other =
      total !== null && base !== null
        ? round2(Math.max(0, total - base - (superminimum ?? 0)))
        : null;
    return {
      period: p.reading.period!,
      base,
      superminimum,
      other,
      total,
      increments: num(v.seniorityIncrements),
    };
  });
}

export function buildCcnlComparison(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  today: string,
): CcnlComparisonDto {
  const monthly = monthlyPayslips(docs);
  const current =
    workplaces.find((w) => w.status === 'current') ?? workplaces[0] ?? null;
  const own = current
    ? monthly.filter((p) => p.workplaceId === current.id)
    : monthly;
  const latest = own.at(-1) ?? null;
  const agreement =
    (current?.values.collectiveAgreement as string | undefined) ??
    (latest?.reading.values.collectiveAgreement as string | undefined) ??
    null;
  const level =
    (latest?.reading.values.level as string | undefined) ??
    (current?.values.level as string | undefined) ??
    null;
  const salary =
    num(latest?.reading.values.monthlySalary) ??
    num(current?.values.monthlySalary);
  const table = ccnlTableFor(agreement);
  const month = today.slice(0, 7);
  const empty: CcnlComparisonDto = {
    agreement,
    table: null,
    level,
    minimum: null,
    salary,
    aboveMinimum: null,
    aboveMinimumPct: null,
    nextLevel: null,
    nextLevelMinimum: null,
    toNextLevel: null,
    schedule: [],
    history: [],
  };
  if (!table) return empty;
  const known = level !== null && table.levels.includes(level);
  const minimum = known ? ccnlMinimum(table, level, month) : null;
  const nextLevel = known ? nextCcnlLevel(table, level) : null;
  const nextLevelMinimum = nextLevel
    ? ccnlMinimum(table, nextLevel, month)
    : null;
  const currentStep = [...table.steps]
    .reverse()
    .find((step) => step.from <= month);
  return {
    ...empty,
    table: {
      id: table.id,
      label: table.label,
      source: table.source,
      note: table.note,
    },
    minimum,
    aboveMinimum:
      salary !== null && minimum !== null ? round2(salary - minimum) : null,
    aboveMinimumPct: pctChange(minimum, salary),
    nextLevel,
    nextLevelMinimum,
    toNextLevel:
      salary !== null && nextLevelMinimum !== null
        ? round2(salary - nextLevelMinimum)
        : null,
    schedule: known
      ? table.steps
          .filter((step) => !currentStep || step.from >= currentStep.from)
          .map((step) => ({
            from: step.from,
            minimum: step.minimums[level] ?? null,
            nextMinimum: nextLevel ? (step.minimums[nextLevel] ?? null) : null,
          }))
      : [],
    history: own.map((p) => {
      const lvl = (p.reading.values.level as string | undefined) ?? null;
      return {
        period: p.reading.period!,
        level: lvl,
        salary: num(p.reading.values.monthlySalary),
        minimum:
          lvl && table.levels.includes(lvl)
            ? ccnlMinimum(table, lvl, p.reading.period!)
            : null,
      };
    }),
  };
}

export function buildPackages(
  stats: CareerStatsDto,
  evaluations: EvaluationStatsDto,
): PackageYearDto[] {
  const bonusOf = new Map(evaluations.years.map((y) => [y.year, y.bonus]));
  return stats.years.map((y) => {
    const bonus = bonusOf.get(y.year) ?? 0;
    return {
      year: y.year,
      payslips: y.payslips,
      gross: y.gross,
      extraPay: y.extraPay,
      welfare: y.welfare,
      severance: y.severance,
      bonus,
      total: round2(y.gross + y.welfare + y.severance),
    };
  });
}

export function buildTaxes(docs: readonly ApprovedWorkDocument[]): {
  months: TaxMonthDto[];
  years: IncomeTaxYearDto[];
} {
  const payslips = allPayslips(docs);
  const byPeriod = new Map<string, TaxMonthDto>();
  for (const p of payslips) {
    const r = p.reading;
    const m = byPeriod.get(r.period!) ?? {
      period: r.period!,
      gross: null,
      contributions: null,
      incomeTax: null,
      net: null,
      other: null,
    };
    const add = (a: number | null, b: number | null) =>
      a === null && b === null ? null : round2((a ?? 0) + (b ?? 0));
    m.gross = add(m.gross, r.gross);
    m.contributions = add(m.contributions, r.contributions);
    m.incomeTax = add(m.incomeTax, r.incomeTax);
    m.net = add(m.net, r.net);
    byPeriod.set(r.period!, m);
  }
  const months = [...byPeriod.values()].map((m) => ({
    ...m,
    other:
      m.gross !== null && m.net !== null
        ? round2(m.gross - (m.contributions ?? 0) - (m.incomeTax ?? 0) - m.net)
        : null,
  }));

  const byYear = new Map<number, typeof payslips>();
  for (const p of payslips) {
    const year = +p.reading.period!.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), p]);
  }
  const years = [...byYear.entries()]
    .map(([year, list]): IncomeTaxYearDto => {
      const taxable = sum(list.map((p) => p.reading.taxable));
      const incomeTax = sum(list.map((p) => p.reading.incomeTax));
      const contributions = sum(list.map((p) => p.reading.contributions));
      const gross = sum(list.map((p) => p.reading.gross));
      const regularMonths = new Set(
        list
          .filter((p) => kindOf(p.reading) === 'regular')
          .map((p) => p.reading.period),
      ).size;
      const extraTaxable = sum(
        list
          .filter((p) => kindOf(p.reading) !== 'regular')
          .map((p) => p.reading.taxable),
      );
      // A year with missing months, extended to twelve of them.
      const yearTaxable =
        regularMonths > 0
          ? round2(
              ((taxable - extraTaxable) / regularMonths) * 12 + extraTaxable,
            )
          : null;
      const bracket =
        yearTaxable !== null ? marginalBracket(yearTaxable, year) : null;
      return {
        year,
        payslips: list.length,
        taxable,
        incomeTax,
        contributions,
        gross,
        effectiveRatePct:
          taxable > 0 ? round1((incomeTax / taxable) * 100) : null,
        contributionRatePct:
          gross > 0 ? round2((contributions / gross) * 100) : null,
        yearTaxable,
        marginalRatePct: bracket?.ratePct ?? null,
        toNextBracket: bracket?.toNext ?? null,
      };
    })
    .sort((a, b) => b.year - a.year);
  return { months, years };
}

export function buildTimeOff(
  docs: readonly ApprovedWorkDocument[],
): TimeOffDto {
  const points = monthlyPayslips(docs)
    .map((p) => ({
      period: p.reading.period!,
      vacation: p.reading.vacationLeft,
      leave: p.reading.leaveLeft,
    }))
    .filter((p) => p.vacation !== null || p.leave !== null);
  const change = (pick: (p: (typeof points)[number]) => number | null) => {
    const known = points.filter((p) => pick(p) !== null);
    const last = known.at(-1);
    if (!last) return null;
    const start = addMonths(last.period, -12);
    const first = known.find((p) => p.period >= start);
    return first && first !== last ? round2(pick(last)! - pick(first)!) : null;
  };
  const latest = (pick: (p: (typeof points)[number]) => number | null) =>
    [...points]
      .reverse()
      .map(pick)
      .find((v) => v !== null) ?? null;
  return {
    points,
    vacationChange12: change((p) => p.vacation),
    leaveChange12: change((p) => p.leave),
    vacationLeft: latest((p) => p.vacation),
    leaveLeft: latest((p) => p.leave),
  };
}

export function buildWorkload(
  docs: readonly ApprovedWorkDocument[],
): WorkloadPointDto[] {
  return monthlyPayslips(docs).map((p) => ({
    period: p.reading.period!,
    hoursWorked: p.reading.hoursWorked,
    overtimeHours: p.reading.overtimeHours,
    overtimePay: p.reading.overtimePay,
    travelDays: p.reading.travelDays,
    travelAllowance: p.reading.travelAllowance,
  }));
}

/** The monthly salary of the latest monthly payslip on or before a month. */
function salaryAt(
  monthly: ReturnType<typeof monthlyPayslips>,
  workplaceId: string,
  period: string,
) {
  const point = [...monthly]
    .reverse()
    .find(
      (p) =>
        p.workplaceId === workplaceId &&
        p.reading.period! <= period &&
        num(p.reading.values.monthlySalary) !== null,
    );
  return point
    ? {
        period: point.reading.period!,
        salary: num(point.reading.values.monthlySalary)!,
      }
    : null;
}

export function buildReviewsVsPay(
  docs: readonly ApprovedWorkDocument[],
  evaluations: EvaluationStatsDto,
): ReviewPayDto[] {
  const monthly = monthlyPayslips(docs);
  return evaluations.evaluations
    .filter((e) => e.date)
    .map((e) => {
      const at = e.date!.slice(0, 7);
      const before = salaryAt(monthly, e.workplaceId, at);
      const after = salaryAt(monthly, e.workplaceId, addMonths(at, 12));
      const later = after && after.period > at ? after : null;
      return {
        uploadId: e.uploadId,
        date: e.date!,
        cycle: e.cycle,
        score: e.score,
        maxScore: e.maxScore,
        payoutPct: e.payoutPct,
        bonus: e.bonus,
        salaryAt: before?.salary ?? null,
        salaryAfter: later?.salary ?? null,
        afterPeriod: later?.period ?? null,
        riseAfterPct:
          before && later ? pctChange(before.salary, later.salary) : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The default regional and municipal surtax, in percent, when no CU says it. */
const DEFAULT_SURTAX_PCT = 2;
/** INPS and the solidarity fund for most private employees, in percent. */
const DEFAULT_CONTRIBUTION_PCT = 9.19;

export function buildOfferBaseline(input: InsightsInput): OfferBaselineDto {
  const { stats, documents, evaluations, certificates, today } = input;
  const payslips = allPayslips(documents);
  const recent = payslips.filter(
    (p) => monthsBetween(p.reading.period!, today) < 12,
  );
  const regular = recent.filter((p) => kindOf(p.reading) === 'regular');
  const gross = sum(regular.map((p) => p.reading.gross));
  const contributions = sum(regular.map((p) => p.reading.contributions));
  const contributionRatePct =
    gross > 0 && contributions > 0
      ? round2((contributions / gross) * 100)
      : DEFAULT_CONTRIBUTION_PCT;
  const certificate = [...certificates]
    .filter((c) => c.income && c.surtaxes)
    .sort((a, b) => b.year - a.year)[0];
  const surtaxRatePct = certificate
    ? round2((certificate.surtaxes! / certificate.income!) * 100)
    : DEFAULT_SURTAX_PCT;
  const fourteenth = payslips.some(
    (p) =>
      kindOf(p.reading) === 'fourteenth' &&
      monthsBetween(p.reading.period!, today) < 24,
  );
  const monthsPaid = fourteenth ? 14 : 13;
  const monthlySalary = stats.currentMonthlySalary;
  const lastYear = +today.slice(0, 4) - 1;
  return {
    employer: stats.currentEmployer,
    monthlySalary,
    monthsPaid,
    ral: monthlySalary !== null ? round2(monthlySalary * monthsPaid) : null,
    contributionRatePct,
    surtaxRatePct,
    surtaxSource: certificate ? 'certificate' : 'default',
    welfare12: sum(recent.map((p) => p.reading.welfare)),
    bonus12:
      evaluations.years.find((y) => y.year === +today.slice(0, 4))?.bonus ??
      evaluations.years.find((y) => y.year === lastYear)?.bonus ??
      0,
    net12: recent.length ? sum(recent.map((p) => p.reading.net)) : null,
  };
}

export function buildInsights(input: InsightsInput): CareerInsightsDto {
  const taxes = buildTaxes(input.documents);
  return {
    realPay: buildRealPay(input.documents),
    salaryParts: buildSalaryParts(input.documents),
    ccnl: buildCcnlComparison(input.workplaces, input.documents, input.today),
    packages: buildPackages(input.stats, input.evaluations),
    taxMonths: taxes.months,
    taxYears: taxes.years,
    timeOff: buildTimeOff(input.documents),
    workload: buildWorkload(input.documents),
    reviewsVsPay: buildReviewsVsPay(input.documents, input.evaluations),
    offer: buildOfferBaseline(input),
  };
}

/**
 * The goals of an evaluation, one each: by line, else by semicolon or
 * numbered item, else by sentence, as the AI may write them in a paragraph.
 */
export function splitGoals(goals: string | null): string[] {
  const lines = readLines(goals).map((line) =>
    line.replace(/^\(?\d{1,2}[.)]\s+/, '').trim(),
  );
  if (lines.length !== 1) return lines.filter(Boolean);
  const [line] = lines;
  const parts = /;/.test(line)
    ? line.split(/\s*;\s*/)
    : /(?:^|\s)\d{1,2}[.)]\s/.test(line)
      ? line.split(/(?:^|\s)\d{1,2}[.)]\s+/)
      : line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
  return parts
    .map((part) => part.replace(/[.;]\s*$/, '').trim())
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1));
}

/** Every goal your evaluations set, newest evaluation first, with the status you gave it. */
export function buildGoals(
  evaluations: EvaluationStatsDto,
  statuses: readonly {
    uploadId: string;
    goalKey: string;
    status: GoalStatus;
    note: string | null;
    updatedAt: Date;
  }[],
): GoalDto[] {
  const statusOf = new Map(
    statuses.map((s) => [`${s.uploadId}|${s.goalKey}`, s]),
  );
  return [...evaluations.evaluations]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .flatMap((e) => {
      const seen = new Set<string>();
      return splitGoals(e.goals).flatMap((text) => {
        const key = goalKey(text);
        if (!key || seen.has(key)) return [];
        seen.add(key);
        const saved = statusOf.get(`${e.uploadId}|${key}`);
        return [
          {
            uploadId: e.uploadId,
            key,
            text,
            date: e.date,
            cycle: e.cycle,
            workplaceName: e.workplaceName,
            status: saved?.status ?? 'open',
            note: saved?.note ?? null,
            updatedAt: saved?.updatedAt.toISOString() ?? null,
          },
        ];
      });
    });
}

/**
 * The negotiation brief: the facts of your pay, reviews and market position
 * and what they argue for, in sentences you can bring to a review.
 */
export function buildBrief(
  input: InsightsInput,
  insights: CareerInsightsDto,
  goals: readonly GoalDto[],
  market: MarketCheckDto | null,
): NegotiationBriefDto {
  const { stats, evaluations, workplaces } = input;
  const current = workplaces.find((w) => w.status === 'current') ?? null;
  const facts: BriefFactDto[] = [];
  const args: string[] = [];
  const asks: string[] = [];
  const fact = (label: string, value: string, detail: string | null = null) =>
    facts.push({ label, value, detail });

  if (stats.currentMonthlySalary !== null)
    fact(
      'Monthly salary',
      money(stats.currentMonthlySalary),
      insights.offer.ral !== null
        ? `${money(insights.offer.ral)} a year over ${insights.offer.monthsPaid} months`
        : null,
    );
  if (stats.tenureMonths !== null)
    fact(
      'Time at the company',
      `${Math.floor(stats.tenureMonths / 12)} years ${stats.tenureMonths % 12} months`,
    );
  if (stats.monthsSinceLastRise !== null)
    fact('Since the last rise', `${stats.monthsSinceLastRise} months`);

  const real = insights.realPay;
  if (real.nominalGrowthPct !== null && real.realGrowthPct !== null) {
    const first = real.years[0].year;
    const last = real.years.at(-1)!.year;
    fact(
      `Salary ${first} to ${last}`,
      `${real.nominalGrowthPct > 0 ? '+' : ''}${real.nominalGrowthPct}%`,
      `${real.realGrowthPct > 0 ? '+' : ''}${real.realGrowthPct}% after inflation (prices ${real.inflationPct! > 0 ? '+' : ''}${real.inflationPct}%)`,
    );
    if (real.realGrowthPct < 1)
      args.push(
        `Since ${first} prices rose ${real.inflationPct}% and my salary ${real.nominalGrowthPct}%: in real terms it ${real.realGrowthPct < 0 ? `fell ${Math.abs(real.realGrowthPct)}%` : 'barely moved'}.`,
      );
  }

  const ccnl = insights.ccnl;
  if (ccnl.minimum !== null && ccnl.aboveMinimum !== null && ccnl.level) {
    fact(
      `Above the CCNL minimum of ${ccnl.level}`,
      money(ccnl.aboveMinimum),
      ccnl.aboveMinimumPct !== null
        ? `${ccnl.aboveMinimumPct}% over ${money(ccnl.minimum)}`
        : null,
    );
    if (ccnl.aboveMinimumPct !== null && ccnl.aboveMinimumPct < 5)
      args.push(
        `My salary is only ${money(ccnl.aboveMinimum)} (${ccnl.aboveMinimumPct}%) above the CCNL minimum for ${ccnl.level}: CCNL renewals, not merit, have driven most of my rises.`,
      );
  }
  if (ccnl.nextLevel && ccnl.nextLevelMinimum !== null) {
    fact(
      `Minimum of ${ccnl.nextLevel}`,
      money(ccnl.nextLevelMinimum),
      ccnl.toNextLevel !== null
        ? ccnl.toNextLevel >= 0
          ? `you are already ${money(ccnl.toNextLevel)} above it`
          : `${money(-ccnl.toNextLevel)} a month above your salary`
        : null,
    );
    asks.push(
      `Move to level ${ccnl.nextLevel}${ccnl.toNextLevel !== null && ccnl.toNextLevel < 0 ? `, at least ${money(ccnl.nextLevelMinimum)} a month (+${money(-ccnl.toNextLevel)})` : ''}.`,
    );
  }

  const scored = evaluations.evaluations.filter((e) => e.score !== null);
  const latest = scored.at(-1);
  if (latest) {
    const share = latest.scoreShare;
    fact(
      'Latest evaluation',
      `${latest.score}${latest.maxScore ? ` / ${latest.maxScore}` : ''}`,
      [
        latest.cycle,
        latest.payoutPct !== null
          ? `${latest.payoutPct}% of the bonus target`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    );
    if (scored.length >= 2) {
      const first = scored[0];
      if (latest.score! > first.score!)
        args.push(
          `My evaluation score went from ${first.score} to ${latest.score} over ${scored.length} reviews.`,
        );
    }
    if (share !== null && share >= 0.8)
      args.push(
        `My latest evaluation scored ${Math.round(share * 100)}% of the maximum.`,
      );
  }
  const linked = insights.reviewsVsPay.filter(
    (r) => r.score !== null && r.riseAfterPct !== null,
  );
  const flat = linked.filter((r) => (r.riseAfterPct ?? 0) < 1);
  if (linked.length && flat.length === linked.length)
    args.push(
      'None of my evaluations was followed by a rise of 1% or more within a year, whatever the score.',
    );

  const met = goals.filter((g) => g.status === 'met' || g.status === 'partly');
  if (goals.some((g) => g.status !== 'open')) {
    fact(
      'Goals met',
      `${met.length} of ${goals.filter((g) => g.status !== 'dropped').length}`,
    );
    if (met.length)
      args.push(
        `I met or partly met ${met.length} of the goals my evaluations set, for example: ${met
          .slice(0, 2)
          .map((g) => `"${g.text}"`)
          .join(', ')}.`,
      );
  }

  if (market && market.ral !== null) {
    const medians = market.ranges
      .map((r) => r.median)
      .filter((m): m is number => m !== null);
    const median = medians.length
      ? medians.sort((a, b) => a - b)[Math.floor(medians.length / 2)]
      : null;
    if (median !== null) {
      fact(
        'Market median',
        money(median),
        `${market.role}, ${market.region} (${market.ranges.length} sources)`,
      );
      if (median > market.ral) {
        args.push(
          `Public ranges put the median for ${market.role} in ${market.region} at ${money(median)} a year, ${money(median - market.ral)} above my RAL.`,
        );
        asks.push(`A RAL of at least ${money(median)}, the market median.`);
      }
    }
  }

  if (stats.monthsSinceLastRise !== null && stats.monthsSinceLastRise >= 18)
    args.push(
      `My last rise or promotion was ${stats.monthsSinceLastRise} months ago.`,
    );
  if (!asks.length && stats.currentMonthlySalary !== null) {
    const target = Math.round((stats.currentMonthlySalary * 1.05) / 10) * 10;
    asks.push(
      `A rise of about 5%, to ${money(target)} a month, or a superminimum of ${money(target - stats.currentMonthlySalary)}.`,
    );
  }
  asks.push(
    'If the budget is closed: a written date for the next review of your pay, and the goals that would earn it.',
  );

  return {
    employer: stats.currentEmployer,
    role: (current?.values.jobTitle as string | undefined) ?? null,
    level: stats.currentLevel,
    facts,
    arguments: args,
    asks,
  };
}
