import {
  CAREER_EVENT_LABELS,
  NOTABLE_CAREER_EVENTS,
  PAYSLIP_KIND_LABELS,
  WORK_DOCUMENT_TYPE_LABELS,
  type CareerEventDto,
  type CareerEventKind,
  type CareerStatsDto,
  type MonthPointDto,
  type PayslipKind,
  type WorkplaceStatus,
  type YearStatsDto,
} from '@life-island/contracts';
import type { StoredValues, WorkDocumentReading } from './work-documents.js';

/*
 * The career read from what you approved: a timeline of notable events
 * (hired, promotions, rises, evaluations...) and your pay statistics. Pure
 * functions of the workplaces and their documents, unit-tested on their own.
 */

export interface CareerWorkplace {
  id: string;
  name: string;
  status: WorkplaceStatus;
  values: StoredValues;
}

export interface ApprovedWorkDocument {
  uploadId: string;
  title: string;
  workplaceId: string;
  reading: WorkDocumentReading;
}

export interface ManualCareerEvent {
  id: string;
  date: string;
  kind: CareerEventKind;
  title: string;
  detail: string | null;
  workplaceId: string | null;
  amount: number | null;
}

/** A rise smaller than this (0.5%) is rounding, not a rise. */
const RISE_THRESHOLD = 0.005;

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Months from one date (or YYYY-MM) to another, counting whole months. */
export function monthsBetween(from: string, to: string): number {
  const y = (d: string) => +d.slice(0, 4);
  const m = (d: string) => +d.slice(5, 7);
  const day = (d: string) => (d.length >= 10 ? +d.slice(8, 10) : 1);
  let months = (y(to) - y(from)) * 12 + (m(to) - m(from));
  if (day(to) < day(from)) months--;
  return Math.max(0, months);
}

function nextMonth(period: string): string {
  const y = +period.slice(0, 4);
  const m = +period.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Where a level sits, to tell a promotion from a step down: letter and digit
 * levels (the metalmeccanici scale D1 < D2 < C1 < ... < B3 < A1, where A is
 * the highest letter) compare; numbers alone mean opposite things in
 * different CCNL (1 is the top of commercio, the bottom of old metalmeccanici),
 * so they do not. Quadro (Q) is above every letter level.
 */
export function levelRank(level: string | null): number | null {
  if (!level) return null;
  const code = level.toUpperCase().replace(/\s+/g, '');
  if (/^Q(UADRO)?\w*$/.test(code)) return 1000;
  const m = /^([A-F])(\d{1,2})$/.exec(code);
  if (!m) return null;
  return ('FEDCBA'.indexOf(m[1]) + 1) * 100 + Number(m[2]);
}

interface PayslipPoint {
  doc: ApprovedWorkDocument;
  period: string;
}

export function kindOf(reading: WorkDocumentReading): PayslipKind {
  return reading.payslipKind ?? 'regular';
}

/**
 * What makes two payslips the same one: the workplace, the month and the
 * kind (a tredicesima paid on its own payslip is not a second December);
 * two extra payslips of one month are the same only with the same gross.
 */
export function payslipKey(
  workplaceId: string,
  reading: WorkDocumentReading,
): string | null {
  if (reading.type !== 'PAYSLIP' || !reading.period) return null;
  const kind = kindOf(reading);
  return [
    workplaceId,
    reading.period,
    kind,
    kind === 'other' ? (reading.gross ?? '') : '',
  ].join('|');
}

/**
 * Your payslips with a month, each counted once: a copy of one you have
 * (the same file renamed or downloaded again) is left out, the first kept.
 */
export function countedPayslips(
  docs: readonly ApprovedWorkDocument[],
): ApprovedWorkDocument[] {
  const seen = new Set<string>();
  return docs.filter((d) => {
    const key = payslipKey(d.workplaceId, d.reading);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function payslipsOf(
  workplaceId: string,
  payslips: readonly ApprovedWorkDocument[],
): PayslipPoint[] {
  return payslips
    .filter((d) => d.workplaceId === workplaceId)
    .map((doc) => ({ doc, period: doc.reading.period! }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Every event of your career, newest first: the ones each workplace's
 * documents show (hired, level and salary changes from one payslip to the
 * next, new role or contract, extra pay, evaluations, contracts) and the
 * ones you added.
 */
export function buildTimeline(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  manual: readonly ManualCareerEvent[],
): CareerEventDto[] {
  const events: CareerEventDto[] = [];
  const nameOf = new Map(workplaces.map((w) => [w.id, w.name]));
  const push = (
    event: Omit<CareerEventDto, 'notable' | 'workplaceName'> & {
      workplaceId: string | null;
    },
  ) =>
    events.push({
      ...event,
      workplaceName: event.workplaceId
        ? (nameOf.get(event.workplaceId) ?? null)
        : null,
      notable: NOTABLE_CAREER_EVENTS.includes(event.kind),
    });

  const counted = countedPayslips(docs);
  for (const workplace of workplaces) {
    const all = payslipsOf(workplace.id, counted);
    // Month to month on the monthly payslips only: an extra one (a
    // tredicesima on its own payslip) counts in the statistics, not here.
    const payslips = all.filter((p) => kindOf(p.doc.reading) === 'regular');
    const hireDate = (workplace.values.hireDate as string | undefined) ?? null;
    const firstSalary =
      payslips
        .map((p) => p.doc.reading.values.monthlySalary)
        .find((s) => typeof s === 'number') ?? null;
    if (hireDate)
      push({
        id: `hired:${workplace.id}`,
        date: hireDate,
        kind: 'hired',
        title: `Hired at ${workplace.name}`,
        detail:
          [
            workplace.values.jobTitle,
            workplace.values.qualification,
            workplace.values.collectiveAgreement,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        workplaceId: workplace.id,
        source: 'document',
        uploadId: null,
        amount: null,
        changePct: null,
      });
    const endDate = (workplace.values.endDate as string | undefined) ?? null;
    if (endDate && workplace.status === 'past')
      push({
        id: `left:${workplace.id}`,
        date: endDate,
        kind: 'left',
        title: `Left ${workplace.name}`,
        detail: null,
        workplaceId: workplace.id,
        source: 'document',
        uploadId: null,
        amount: null,
        changePct: null,
      });

    // From one payslip to the next: what changed.
    let previous: PayslipPoint | null = null;
    let lastIncrements: number | null = null;
    for (const point of payslips) {
      const now = point.doc.reading;
      const base = {
        date: `${point.period}-01`,
        workplaceId: workplace.id,
        source: 'document' as const,
        uploadId: point.doc.uploadId,
      };
      const increments = numeric(now.values.seniorityIncrements);
      if (previous) {
        const before = previous.doc.reading;
        const salaryBefore = numeric(before.values.monthlySalary);
        const salaryNow = numeric(now.values.monthlySalary);
        const change =
          salaryBefore && salaryNow
            ? (salaryNow - salaryBefore) / salaryBefore
            : null;
        const levelBefore = text(before.values.level);
        const levelNow = text(now.values.level);
        const levelChanged =
          levelBefore && levelNow && levelBefore !== levelNow;
        const up =
          levelChanged &&
          levelRank(levelNow) !== null &&
          levelRank(levelBefore) !== null &&
          levelRank(levelNow)! > levelRank(levelBefore)!;
        // A new level is a promotion when it ranks higher or pays more; any
        // other level change is not an event (a salary change still is).
        if (
          levelChanged &&
          (up || (change !== null && change > RISE_THRESHOLD))
        ) {
          push({
            ...base,
            id: `level:${point.doc.uploadId}`,
            kind: 'promotion',
            title: `Level ${levelBefore} → ${levelNow}`,
            detail:
              change !== null && Math.abs(change) > RISE_THRESHOLD
                ? `Monthly salary ${money(salaryBefore!)} → ${money(salaryNow!)} (${pct(change * 100)})`
                : null,
            amount: salaryNow,
            changePct: change === null ? null : round1(change * 100),
          });
        } else if (change !== null && Math.abs(change) > RISE_THRESHOLD) {
          push({
            ...base,
            id: `salary:${point.doc.uploadId}`,
            kind: change > 0 ? 'salary_rise' : 'salary_cut',
            title: `Monthly salary ${money(salaryNow!)} (${pct(change * 100)})`,
            detail: salaryDetail(before.values, now.values, salaryBefore!),
            amount: salaryNow,
            changePct: round1(change * 100),
          });
        }
      }
      if (
        increments !== null &&
        lastIncrements !== null &&
        increments > lastIncrements
      )
        push({
          ...base,
          id: `scatto:${point.doc.uploadId}`,
          kind: 'seniority_increment',
          title: `Seniority increment no. ${increments}`,
          detail: null,
          amount: null,
          changePct: null,
        });
      if (increments !== null) lastIncrements = increments;

      previous = point;
    }

    if (payslips.length && hireDate === null) {
      const first = payslips[0];
      push({
        id: `first:${workplace.id}`,
        date: `${first.period}-01`,
        kind: 'hired',
        title: `First payslip at ${workplace.name}`,
        detail:
          firstSalary !== null
            ? `Monthly salary ${money(firstSalary as number)}`
            : null,
        workplaceId: workplace.id,
        source: 'document',
        uploadId: first.doc.uploadId,
        amount: (firstSalary as number | null) ?? null,
        changePct: null,
      });
    }
  }

  for (const doc of docs) {
    const r = doc.reading;
    if (!r.date) continue;
    if (r.type === 'PERFORMANCE_REVIEW')
      push({
        id: `evaluation:${doc.uploadId}`,
        date: r.date,
        kind: 'evaluation',
        title: `Evaluation${r.cycle ? ` ${r.cycle}` : ''}${
          r.score !== null
            ? `: ${r.score}${r.maxScore ? ` / ${r.maxScore}` : ''}`
            : r.rating
              ? `: ${r.rating}${r.ratingScale ? ` (${r.ratingScale})` : ''}`
              : ''
        }`,
        detail:
          [
            r.reviewer ? `By ${r.reviewer}` : null,
            r.values.level ? `new level ${r.values.level}` : null,
            r.values.jobTitle ? `new role ${r.values.jobTitle}` : null,
            r.payoutPct !== null ? `${r.payoutPct}% of the bonus target` : null,
            r.bonus ? `bonus ${money(r.bonus)}` : null,
          ]
            .filter(Boolean)
            .join(', ') || r.strengths,
        workplaceId: doc.workplaceId,
        source: 'document',
        uploadId: doc.uploadId,
        amount: r.bonus,
        changePct: null,
      });
    if (r.type === 'EMPLOYMENT_CONTRACT')
      push({
        id: `contract:${doc.uploadId}`,
        date: r.date,
        kind: 'contract_signed',
        title: WORK_DOCUMENT_TYPE_LABELS.EMPLOYMENT_CONTRACT,
        detail:
          [r.values.jobTitle, r.values.level, r.values.collectiveAgreement]
            .filter(Boolean)
            .join(' · ') || null,
        workplaceId: doc.workplaceId,
        source: 'document',
        uploadId: doc.uploadId,
        amount:
          numeric(r.values.annualGrossSalary) ??
          numeric(r.values.monthlySalary),
        changePct: null,
      });
  }

  for (const event of manual)
    push({
      id: event.id,
      date: event.date,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      workplaceId: event.workplaceId,
      source: 'manual',
      uploadId: null,
      amount: event.amount,
      changePct: null,
    });

  return events.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.notable) - Number(a.notable) ||
      CAREER_EVENT_LABELS[a.kind].localeCompare(CAREER_EVENT_LABELS[b.kind]),
  );
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Where a rise came from, when the payslip splits the salary. */
function salaryDetail(
  before: StoredValues,
  now: StoredValues,
  salaryBefore: number,
): string {
  const parts = [`Before: ${money(salaryBefore)}`];
  const minBefore = numeric(before.baseMinimum);
  const minNow = numeric(now.baseMinimum);
  if (minBefore && minNow && minNow !== minBefore)
    parts.push(`CCNL minimum ${money(minBefore)} → ${money(minNow)}`);
  const superBefore = numeric(before.superminimum) ?? 0;
  const superNow = numeric(now.superminimum) ?? 0;
  if (superNow !== superBefore)
    parts.push(
      superBefore
        ? `superminimum ${money(superBefore)} → ${money(superNow)}`
        : `a superminimum of ${money(superNow)}`,
    );
  return parts.join(', ');
}

/** Statistics of your pay and career, from the payslips you approved. */
export function buildStats(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  events: readonly CareerEventDto[],
  today: string,
): CareerStatsDto {
  // Every payslip once; the month by month figures only of the monthly ones.
  const payslips = countedPayslips(docs).sort((a, b) =>
    a.reading.period!.localeCompare(b.reading.period!),
  );
  const monthlyPayslips = payslips.filter(
    (p) => kindOf(p.reading) === 'regular',
  );
  const current =
    workplaces.find(
      (w) =>
        w.status === 'current' && payslips.some((p) => p.workplaceId === w.id),
    ) ??
    workplaces.find((w) => w.status === 'current') ??
    null;
  const latest = [...monthlyPayslips].reverse();
  const latestOf = (pick: (r: WorkDocumentReading) => unknown) =>
    latest
      .map((p) => pick(p.reading))
      .find((v) => v !== null && v !== undefined) ?? null;
  const currentPayslips = current
    ? monthlyPayslips.filter((p) => p.workplaceId === current.id)
    : [];

  const monthly: MonthPointDto[] = monthlyPayslips.map((p) => ({
    period: p.reading.period!,
    gross: p.reading.gross,
    net: p.reading.net,
    monthlySalary: numeric(p.reading.values.monthlySalary),
    workplaceId: p.workplaceId,
  }));

  const byYear = new Map<number, YearStatsDto>();
  for (const p of payslips) {
    const year = +p.reading.period!.slice(0, 4);
    const y = byYear.get(year) ?? {
      year,
      payslips: 0,
      gross: 0,
      net: 0,
      incomeTax: 0,
      contributions: 0,
      welfare: 0,
      severance: 0,
      averageNet: 0,
      extraPay: 0,
    };
    y.payslips++;
    if (kindOf(p.reading) !== 'regular') y.extraPay += p.reading.gross ?? 0;
    y.gross += p.reading.gross ?? 0;
    y.net += p.reading.net ?? 0;
    y.incomeTax += p.reading.incomeTax ?? 0;
    y.contributions += p.reading.contributions ?? 0;
    y.welfare += p.reading.welfare ?? 0;
    y.severance += p.reading.severance ?? 0;
    byYear.set(year, y);
  }
  const years = [...byYear.values()]
    .map((y) => ({
      ...y,
      gross: round2(y.gross),
      net: round2(y.net),
      incomeTax: round2(y.incomeTax),
      contributions: round2(y.contributions),
      welfare: round2(y.welfare),
      severance: round2(y.severance),
      extraPay: round2(y.extraPay),
      averageNet: round2(y.net / y.payslips),
    }))
    .sort((a, b) => b.year - a.year);

  const salaries = monthly.filter((m) => m.monthlySalary !== null);
  const firstSalary = salaries.at(0) ?? null;
  const lastSalary = salaries.at(-1) ?? null;
  const growth =
    firstSalary && lastSalary && firstSalary.monthlySalary
      ? (lastSalary.monthlySalary! - firstSalary.monthlySalary) /
        firstSalary.monthlySalary
      : null;
  const span =
    firstSalary && lastSalary
      ? monthsBetween(firstSalary.period, lastSalary.period)
      : 0;
  const annualGrowth =
    growth !== null && span >= 12
      ? (Math.pow(1 + growth, 12 / span) - 1) * 100
      : null;

  const tenureOf = (w: CareerWorkplace): number | null => {
    const start =
      (w.values.hireDate as string | undefined) ??
      payslips.find((p) => p.workplaceId === w.id)?.reading.period ??
      null;
    if (!start) return null;
    const end =
      (w.values.endDate as string | undefined) ??
      (w.status === 'past'
        ? ([...payslips].reverse().find((p) => p.workplaceId === w.id)?.reading
            .period ?? today)
        : today);
    return monthsBetween(start, end < today ? end : today);
  };
  const tenures = workplaces
    .map(tenureOf)
    .filter((t): t is number => t !== null);

  const lastRise = events.find(
    (e) => e.kind === 'salary_rise' || e.kind === 'promotion',
  );
  const recent = payslips.filter(
    (p) => monthsBetween(p.reading.period!, today) < 12,
  );
  const recentGross = recent.reduce((s, p) => s + (p.reading.gross ?? 0), 0);
  const recentNet = recent.reduce((s, p) => s + (p.reading.net ?? 0), 0);

  const missingMonths: string[] = [];
  if (currentPayslips.length > 1) {
    const have = new Set(currentPayslips.map((p) => p.reading.period!));
    for (
      let m = currentPayslips[0].reading.period!;
      m < currentPayslips.at(-1)!.reading.period!;
      m = nextMonth(m)
    )
      if (!have.has(m)) missingMonths.push(m);
  }

  return {
    payslips: payslips.length,
    currentEmployer: current?.name ?? null,
    currentLevel:
      (current?.values.level as string | undefined) ??
      (latestOf((r) => r.values.level) as string | null),
    currentMonthlySalary:
      numeric(current?.values.monthlySalary) ??
      (latestOf((r) => r.values.monthlySalary) as number | null),
    tenureMonths: current ? tenureOf(current) : null,
    careerMonths: tenures.length ? tenures.reduce((a, b) => a + b, 0) : null,
    salaryGrowthPct: growth === null ? null : round1(growth * 100),
    annualGrowthPct: annualGrowth === null ? null : round1(annualGrowth),
    monthsSinceLastRise: lastRise ? monthsBetween(lastRise.date, today) : null,
    netRatio:
      recentGross > 0
        ? Math.round((recentNet / recentGross) * 1000) / 1000
        : null,
    vacationLeft: latestOf((r) => r.vacationLeft) as number | null,
    leaveLeft: latestOf((r) => r.leaveLeft) as number | null,
    missingMonths,
    years,
    monthly,
  };
}

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

/**
 * What a document is the one of, to tell a copy: a payslip by its workplace,
 * month and kind (see `payslipKey`), a CU by its workplace and year. Null for
 * the other documents, which are never copies of each other.
 */
export function documentIdentity(
  workplaceKey: string,
  reading: WorkDocumentReading,
): { key: string; what: string } | null {
  if (reading.type === 'PAYSLIP' && reading.period) {
    const kind = kindOf(reading);
    const month = `${MONTHS[+reading.period.slice(5, 7) - 1]} ${reading.period.slice(0, 4)}`;
    return {
      key: payslipKey(workplaceKey, reading)!,
      what:
        kind === 'regular'
          ? `the payslip for ${month}`
          : `the ${PAYSLIP_KIND_LABELS[kind].toLowerCase()} for ${month}`,
    };
  }
  if (reading.type === 'CERTIFICAZIONE_UNICA' && reading.certificate?.year)
    return {
      key: `${workplaceKey}|CU|${reading.certificate.year}`,
      what: `the Certificazione Unica for ${reading.certificate.year}`,
    };
  return null;
}
