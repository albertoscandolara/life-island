import {
  CAREER_EVENT_LABELS,
  NOTABLE_CAREER_EVENTS,
  WORK_DOCUMENT_TYPE_LABELS,
  type CareerEventDto,
  type CareerEventKind,
  type CareerStatsDto,
  type MonthPointDto,
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
/** A month whose gross is this much over the monthly salary has extra pay. */
const EXTRA_PAY_THRESHOLD = 0.1;

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

function payslipsOf(
  workplaceId: string,
  docs: readonly ApprovedWorkDocument[],
): PayslipPoint[] {
  return docs
    .filter(
      (d) =>
        d.workplaceId === workplaceId &&
        d.reading.type === 'PAYSLIP' &&
        d.reading.period,
    )
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

  for (const workplace of workplaces) {
    const payslips = payslipsOf(workplace.id, docs);
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
        if (levelBefore && levelNow && levelBefore !== levelNow) {
          const up =
            (levelRank(levelNow) ?? -1) > (levelRank(levelBefore) ?? -1) &&
            levelRank(levelNow) !== null &&
            levelRank(levelBefore) !== null;
          const promotion = up || (change !== null && change > RISE_THRESHOLD);
          push({
            ...base,
            id: `level:${point.doc.uploadId}`,
            kind: promotion ? 'promotion' : 'level_change',
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
        const titleBefore =
          text(before.values.jobTitle) ?? text(before.values.qualification);
        const titleNow =
          text(now.values.jobTitle) ?? text(now.values.qualification);
        if (titleBefore && titleNow && titleBefore !== titleNow)
          push({
            ...base,
            id: `role:${point.doc.uploadId}`,
            kind: 'role_change',
            title: titleNow,
            detail: `Before: ${titleBefore}`,
            amount: null,
            changePct: null,
          });
        const ccnlBefore = text(before.values.collectiveAgreement);
        const ccnlNow = text(now.values.collectiveAgreement);
        if (ccnlBefore && ccnlNow && ccnlBefore !== ccnlNow)
          push({
            ...base,
            id: `ccnl:${point.doc.uploadId}`,
            kind: 'contract_change',
            title: ccnlNow,
            detail: `Before: ${ccnlBefore}`,
            amount: null,
            changePct: null,
          });
        const teamBefore = text(before.values.costCenter);
        const teamNow = text(now.values.costCenter);
        if (teamBefore && teamNow && teamBefore !== teamNow)
          push({
            ...base,
            id: `team:${point.doc.uploadId}`,
            kind: 'role_change',
            title: `New team: ${teamNow}`,
            detail: `Before: ${teamBefore}`,
            amount: null,
            changePct: null,
          });
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

      const salary = numeric(now.values.monthlySalary);
      if (
        salary &&
        now.gross !== null &&
        now.gross > salary * (1 + EXTRA_PAY_THRESHOLD)
      )
        push({
          ...base,
          id: `extra:${point.doc.uploadId}`,
          kind: 'extra_pay',
          title: `${money(round2(now.gross - salary))} over the monthly salary`,
          detail: extraPayDetail(point.period),
          amount: round2(now.gross - salary),
          changePct: null,
        });
      if (now.welfare)
        push({
          ...base,
          id: `welfare:${point.doc.uploadId}`,
          kind: 'extra_pay',
          title: `${money(now.welfare)} of welfare credits`,
          detail:
            'Benefits you can spend on the welfare platform, not paid in the net',
          amount: now.welfare,
          changePct: null,
        });
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

function extraPayDetail(period: string): string {
  const month = +period.slice(5, 7);
  if (month === 12) return 'December: usually the tredicesima (13th month)';
  if (month === 6 || month === 7)
    return 'Summer: the quattordicesima (14th month), if your CCNL has one, or a bonus';
  return 'A bonus, arrears, paid-out leave or allowances';
}

/** Statistics of your pay and career, from the payslips you approved. */
export function buildStats(
  workplaces: readonly CareerWorkplace[],
  docs: readonly ApprovedWorkDocument[],
  events: readonly CareerEventDto[],
  today: string,
): CareerStatsDto {
  const payslips = docs
    .filter((d) => d.reading.type === 'PAYSLIP' && d.reading.period)
    .sort((a, b) => a.reading.period!.localeCompare(b.reading.period!));
  const current =
    workplaces.find(
      (w) =>
        w.status === 'current' && payslips.some((p) => p.workplaceId === w.id),
    ) ??
    workplaces.find((w) => w.status === 'current') ??
    null;
  const latest = [...payslips].reverse();
  const latestOf = (pick: (r: WorkDocumentReading) => unknown) =>
    latest
      .map((p) => pick(p.reading))
      .find((v) => v !== null && v !== undefined) ?? null;
  const currentPayslips = current
    ? payslips.filter((p) => p.workplaceId === current.id)
    : [];

  const monthly: MonthPointDto[] = payslips.map((p) => ({
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
    };
    y.payslips++;
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
