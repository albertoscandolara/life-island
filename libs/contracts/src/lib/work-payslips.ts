/*
 * Your payslips laid out month by month, shared by the Work page (the grid
 * and What's next) and svc-work (`GET /attention`), so both see the same
 * months missing and the same payslips to check.
 */
import type {
  PayslipCheckDto,
  PayslipKind,
  TaxCertificateDto,
  WorkplaceDto,
  CareerDocumentDto,
} from './work.js';
import type { PayslipAuditFindingDto } from './work-checks.js';

const workplaceName = (w: WorkplaceDto): string =>
  w.label ||
  (typeof w.values.employerName === 'string' ? w.values.employerName : '') ||
  'Unnamed workplace';

/** One payslip on the grid, with what it needs from you. */
export interface PayslipSlip {
  doc: CareerDocumentDto;
  kind: PayslipKind;
  workplaceId: string;
  workplace: string;
  /** Why it is not fully right: a value not read, a CCNL check that failed. */
  checks: string[];
  /** Received in the bank (Money matched it), in part, or not known. */
  received: 'full' | 'part' | null;
}

/** What a month of the grid shows. */
export type PayslipMonthState =
  /** A monthly payslip, all in order. */
  | 'ok'
  /** A monthly payslip with something to look at. */
  | 'check'
  /** No payslip, though one was due. */
  | 'missing'
  /** Not due yet, or outside any job you had. */
  | 'none';

export interface PayslipMonth {
  /** YYYY-MM */
  period: string;
  /** 1..12 */
  month: number;
  state: PayslipMonthState;
  /** The monthly payslips (more than one with two jobs in the month). */
  slips: PayslipSlip[];
  /** Tredicesima, quattordicesima and other extra payslips of the month. */
  extras: PayslipSlip[];
  /** Welfare the month's payslips credit outside the net; null when none. */
  welfare: PayslipWelfare | null;
}

/** An evaluation a welfare credit follows, at most this many days after it. */
export const WELFARE_EVALUATION_DAYS = 180;

/**
 * Welfare credited with a month's payslips, tax free and outside the net: a
 * premio di risultato converted to welfare, meal vouchers, flexible benefits.
 */
export interface PayslipWelfare {
  amount: number;
  /** The evaluation it most likely rewards: the latest one before it, within WELFARE_EVALUATION_DAYS. */
  evaluation: { uploadId: string; title: string; date: string } | null;
}

export interface PayslipYear {
  year: number;
  months: PayslipMonth[];
  /** Each payslip once. */
  count: number;
  gross: number;
  net: number;
  missing: number;
  toCheck: number;
  /** Welfare credited in the year with the payslips, tax free and not in the gross. */
  welfare: number;
  /** The Certificazioni Uniche about the year's income. */
  certificates: TaxCertificateDto[];
}

const isoMonth = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Adds months to a YYYY-MM. */
export function periodPlusMonths(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number);
  return isoMonth(new Date(y, m - 1 + months, 1));
}

/**
 * The latest month whose payslip should be here by `today`: a month's
 * payslip comes at its end or in the first days of the next, so the previous
 * month counts from the 15th, the one before always.
 */
export function payslipDueThrough(today: string): string {
  const current = today.slice(0, 7);
  return periodPlusMonths(current, Number(today.slice(8, 10)) >= 15 ? -1 : -2);
}

/**
 * The months each job owes a payslip: from its hire date (else its first
 * payslip) to its end date (else its latest payslip, or the month due now
 * for the job you have).
 */
function owedMonths(workplace: WorkplaceDto, through: string): Set<string> {
  const payslips = workplace.documents
    .filter((d) => d.type === 'PAYSLIP' && d.period)
    .map((d) => d.period!.slice(0, 7))
    .sort();
  const hire =
    typeof workplace.values.hireDate === 'string'
      ? workplace.values.hireDate.slice(0, 7)
      : null;
  const first = [hire, payslips[0]].filter(Boolean).sort()[0];
  if (!first) return new Set();
  const end =
    typeof workplace.values.endDate === 'string'
      ? workplace.values.endDate.slice(0, 7)
      : workplace.status === 'current'
        ? through
        : (payslips.at(-1) ?? first);
  const last = end < through ? end : through;
  const out = new Set<string>();
  for (let p = first; p <= last; p = periodPlusMonths(p, 1)) out.add(p);
  return out;
}

/** What identifies one payslip, so a copy you approved twice shows once. */
function slipKey(workplaceId: string, doc: CareerDocumentDto): string {
  const kind = doc.payslipKind ?? 'regular';
  return [
    workplaceId,
    doc.period?.slice(0, 7),
    kind,
    kind === 'other' ? doc.gross : '',
  ].join('|');
}

/**
 * Your payslips year by year, newest year first: twelve months each, every
 * payslip in its month with what needs a look, the months missing, and the
 * year's Certificazione Unica beside them.
 */
export function payslipYears(input: {
  workplaces: readonly WorkplaceDto[];
  certificates: readonly TaxCertificateDto[];
  checks: readonly PayslipCheckDto[];
  findings: readonly PayslipAuditFindingDto[];
  today: string;
}): PayslipYear[] {
  const through = payslipDueThrough(input.today);
  const notes = new Map<string, string[]>();
  const note = (uploadId: string | null, text: string) => {
    if (!uploadId) return;
    notes.set(uploadId, [...(notes.get(uploadId) ?? []), text]);
  };
  for (const c of input.checks) note(c.uploadId, c.message);
  for (const f of input.findings)
    if (f.severity !== 'info') note(f.uploadId, f.title);

  const evaluations = input.workplaces
    .flatMap((w) =>
      w.documents
        .filter((d) => d.type === 'PERFORMANCE_REVIEW' && d.period)
        .map((d) => ({
          workplaceId: w.id,
          uploadId: d.uploadId,
          title: d.title,
          date: d.period!.slice(0, 10),
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const evaluationBefore = (workplaceId: string, period: string) => {
    const end = `${period}-31`;
    return (
      evaluations.find(
        (e) =>
          e.workplaceId === workplaceId &&
          e.date <= end &&
          (Date.parse(`${period}-28`) - Date.parse(e.date)) / 86_400_000 <=
            WELFARE_EVALUATION_DAYS,
      ) ?? null
    );
  };

  const slips = new Map<string, PayslipSlip[]>();
  const seen = new Set<string>();
  const owed = new Set<string>();
  for (const w of input.workplaces) {
    for (const p of owedMonths(w, through)) owed.add(p);
    for (const doc of w.documents) {
      if (doc.type !== 'PAYSLIP' || !doc.period) continue;
      const key = slipKey(w.id, doc);
      if (seen.has(key)) continue;
      seen.add(key);
      const period = doc.period.slice(0, 7);
      const paid = doc.bankPayment;
      slips.set(period, [
        ...(slips.get(period) ?? []),
        {
          doc,
          kind: doc.payslipKind ?? 'regular',
          workplaceId: w.id,
          workplace: workplaceName(w),
          checks: notes.get(doc.uploadId) ?? [],
          received: paid ? (paid.full ? 'full' : 'part') : null,
        },
      ]);
    }
  }

  const known = [
    ...[...slips.keys()].map((p) => Number(p.slice(0, 4))),
    ...input.certificates.map((c) => c.year),
  ];
  // A year with no document between two that have some is a gap, not a
  // year you did not work: it is listed, with its owed months missing.
  const years = new Set<number>(
    known.length
      ? Array.from(
          { length: Math.max(...known) - Math.min(...known) + 1 },
          (_, i) => Math.min(...known) + i,
        )
      : [],
  );
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const months = Array.from({ length: 12 }, (_, i): PayslipMonth => {
        const period = `${year}-${String(i + 1).padStart(2, '0')}`;
        const all = slips.get(period) ?? [];
        const regular = all.filter((s) => s.kind === 'regular');
        const state: PayslipMonthState = regular.length
          ? all.some((s) => s.checks.length)
            ? 'check'
            : 'ok'
          : owed.has(period)
            ? 'missing'
            : 'none';
        return {
          period,
          month: i + 1,
          state,
          slips: regular,
          extras: all.filter((s) => s.kind !== 'regular'),
          welfare: welfareOf(all, period, evaluationBefore),
        };
      });
      const every = months.flatMap((m) => [...m.slips, ...m.extras]);
      return {
        year,
        months,
        count: every.length,
        gross: every.reduce((sum, s) => sum + (s.doc.gross ?? 0), 0),
        net: every.reduce((sum, s) => sum + (s.doc.net ?? 0), 0),
        missing: months.filter((m) => m.state === 'missing').length,
        toCheck: every.filter((s) => s.checks.length).length,
        welfare:
          Math.round(
            months.reduce((sum, m) => sum + (m.welfare?.amount ?? 0), 0) * 100,
          ) / 100,
        certificates: input.certificates.filter((c) => c.year === year),
      };
    });
}

function welfareOf(
  slips: readonly PayslipSlip[],
  period: string,
  evaluationBefore: (
    workplaceId: string,
    period: string,
  ) => PayslipWelfare['evaluation'],
): PayslipWelfare | null {
  const credited = slips.filter((s) => (s.doc.welfare ?? 0) > 0);
  if (!credited.length) return null;
  const amount = credited.reduce((sum, s) => sum + s.doc.welfare!, 0);
  const evaluation = evaluationBefore(credited[0].workplaceId, period);
  return {
    amount: Math.round(amount * 100) / 100,
    evaluation: evaluation
      ? {
          uploadId: evaluation.uploadId,
          title: evaluation.title,
          date: evaluation.date,
        }
      : null,
  };
}

/** The latest monthly payslip and the one before, for the tiles. */
export function latestPayslips(years: readonly PayslipYear[]): {
  latest: PayslipSlip | null;
  previous: PayslipSlip | null;
} {
  const regular = years
    .flatMap((y) => y.months)
    .filter((m) => m.slips.length)
    .sort((a, b) => b.period.localeCompare(a.period));
  return {
    latest: regular[0]?.slips[0] ?? null,
    previous: regular[1]?.slips[0] ?? null,
  };
}

/** A CU within a euro of the payslips matches; null when a side is missing. */
export function certificateMatches(c: TaxCertificateDto): boolean | null {
  const gaps = [c.incomeGap, c.taxGap].filter((g): g is number => g !== null);
  if (!gaps.length) return null;
  return gaps.every((g) => Math.abs(g) < 1);
}

/** How far back a missing payslip still asks for you: older gaps stay on the grid only. */
export const MISSING_PAYSLIP_MONTHS = 12;

/**
 * The payslips missing in the last year, newest first: what What's next,
 * the hub and the Agenda ask you to load. An older gap stays on the grid,
 * so a career loaded only in part does not nag.
 */
export function recentMissingPayslips(
  years: readonly PayslipYear[],
  today: string,
): string[] {
  const from = periodPlusMonths(today.slice(0, 7), -MISSING_PAYSLIP_MONTHS);
  return years
    .flatMap((y) => y.months)
    .filter((m) => m.state === 'missing' && m.period >= from)
    .map((m) => m.period)
    .sort((a, b) => b.localeCompare(a));
}
