import type {
  CriterionTrendDto,
  EvaluationBandDto,
  EvaluationDto,
  EvaluationRulesDto,
  EvaluationStatsDto,
  EvaluationYearDto,
  ScoreItemDto,
  YearStatsDto,
} from '@life-island/contracts';
import type { ApprovedWorkDocument, CareerWorkplace } from './career.js';

/*
 * Your evaluations in numbers: the score of each period, each criterion
 * across the periods, the bonus they converted to and the roles they state.
 * Each employer's rules are documents you load (EVALUATION_RULES): an
 * evaluation is read against the version of its workplace's rules in force
 * on its date, so nothing about one company is fixed here.
 * Pure: the service passes what you approved.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const average = (values: number[]) =>
  values.length
    ? round2(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

/** Words that do not tell two criteria apart. */
const FILLER = new Set([
  'al',
  'alla',
  'del',
  'della',
  'dei',
  'di',
  'e',
  'la',
  'il',
  'le',
  'of',
  'the',
  'and',
  'to',
]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !FILLER.has(t));
}

/**
 * Whether two criterion names mean the same criterion: equal once case,
 * accents and filler words are dropped, or every word of the shorter is in
 * the longer ("Qualità" and "Qualità del prodotto", "Tecnologie" and
 * "Conoscenza tecnologie").
 */
export function sameCriterion(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/** The year an evaluation is about: printed in its cycle, else its period's or its own date. */
export function evaluationYear(e: EvaluationDto): number | null {
  const printed = /\b(20\d{2}|19\d{2})\b/.exec(e.cycle ?? '');
  if (printed) return Number(printed[1]);
  const date = e.periodEnd ?? e.date;
  return date ? Number(date.slice(0, 4)) : null;
}

/** Where it sits in time, for sorting: the end of its period, else its date. */
const when = (e: EvaluationDto) => e.periodEnd ?? e.date ?? '';

export function toEvaluation(
  doc: ApprovedWorkDocument,
  workplaceName: string | null,
): EvaluationDto {
  const r = doc.reading;
  return {
    uploadId: doc.uploadId,
    title: doc.title,
    workplaceId: doc.workplaceId,
    workplaceName,
    date: r.date,
    cycle: r.cycle,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    role: r.role,
    team: r.team,
    reviewer: r.reviewer,
    score: r.score,
    maxScore: r.maxScore,
    scoreShare:
      r.score !== null && r.maxScore ? round2(r.score / r.maxScore) : null,
    rating: r.rating,
    sections: r.sections,
    criteria: r.criteria,
    payoutPct: r.payoutPct,
    bonus: r.bonus,
    bonusTarget: r.bonusTarget,
    annualGross: (r.values.annualGrossSalary as number | undefined) ?? null,
    band: null,
    strengths: r.strengths,
    improvements: r.improvements,
    goals: r.goals,
    comments: r.comments,
  };
}

/** The rules documents you approved, newest version of each workplace first. */
export function toRules(
  approved: readonly ApprovedWorkDocument[],
  nameOf: ReadonlyMap<string, string>,
): EvaluationRulesDto[] {
  return approved
    .filter((d) => d.reading.type === 'EVALUATION_RULES' && d.reading.rules)
    .map((d) => ({
      uploadId: d.uploadId,
      title: d.title,
      workplaceId: d.workplaceId,
      workplaceName: nameOf.get(d.workplaceId) ?? null,
      ...d.reading.rules!,
      effectiveFrom: d.reading.rules!.effectiveFrom ?? d.reading.date,
    }))
    .sort(
      (a, b) =>
        (a.workplaceName ?? '').localeCompare(b.workplaceName ?? '') ||
        (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''),
    );
}

/**
 * The rules an evaluation is scored by: its workplace's version in force on
 * its date, else (an evaluation older than every version you have) the oldest.
 */
export function rulesFor(
  e: Pick<EvaluationDto, 'workplaceId' | 'date' | 'periodEnd'>,
  rules: readonly EvaluationRulesDto[],
): EvaluationRulesDto | null {
  const own = rules
    .filter((r) => r.workplaceId === e.workplaceId)
    .sort((a, b) =>
      (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''),
    );
  if (!own.length) return null;
  const at = e.periodEnd ?? e.date ?? '';
  return (
    [...own].reverse().find((r) => !r.effectiveFrom || r.effectiveFrom <= at) ??
    own[0]
  );
}

/**
 * Where a score sits in a conversion table: the highest band it reaches
 * (a band runs up to where the next starts, so 85.5 between "81-85" and
 * "86-90" is still in the first), the next one and how far it is.
 */
export function bandFor(
  score: number | null,
  rules: EvaluationRulesDto | null,
): EvaluationBandDto | null {
  if (score === null || !rules?.bands.length) return null;
  const bands = rules.bands;
  let index = -1;
  bands.forEach((b, i) => {
    if (b.min === null || score >= b.min) index = i;
  });
  if (index < 0) return null;
  const band = bands[index];
  const next = bands.slice(index + 1).find((b) => b.min !== null) ?? null;
  return {
    rulesUploadId: rules.uploadId,
    pct: band.pct,
    nextAt: next?.min ?? null,
    nextPct: next?.pct ?? null,
    pointsToNext: next?.min != null ? round2(next.min - score) : null,
    marginBelow: band.min !== null ? round2(score - band.min) : null,
  };
}

/** The key that tells two forms about the same period apart: its cycle, else its period. */
function periodKey(e: EvaluationDto): string | null {
  if (e.cycle) return `${tokens(e.cycle).join(' ')}|${evaluationYear(e)}`;
  if (e.periodStart && e.periodEnd) return `${e.periodStart}/${e.periodEnd}`;
  return null;
}

function criterionTrends(evaluations: EvaluationDto[]): CriterionTrendDto[] {
  const groups: {
    name: string;
    items: { e: EvaluationDto; item: ScoreItemDto }[];
  }[] = [];
  for (const e of evaluations)
    for (const item of e.criteria) {
      const group = groups.find((g) => sameCriterion(g.name, item.name));
      if (group) {
        // The newest name is the one you know it by.
        group.name = item.name;
        group.items.push({ e, item });
      } else groups.push({ name: item.name, items: [{ e, item }] });
    }
  return groups.map(({ name, items }) => {
    const scores = items.map((i) => i.item.score);
    const first = scores[0];
    const latest = scores[scores.length - 1];
    return {
      name,
      points: items.map((i) => ({
        uploadId: i.e.uploadId,
        date: when(i.e) || null,
        score: i.item.score,
      })),
      max: items.map((i) => i.item.max).find((m) => m !== null) ?? null,
      first,
      latest,
      average: average(scores) ?? 0,
      change: round2(latest - first),
    };
  });
}

/** How good a criterion is, comparable across scales: its average over its max when known. */
const strength = (c: CriterionTrendDto) =>
  c.max ? c.average / c.max : c.average;

export function buildEvaluationStats(
  approved: readonly ApprovedWorkDocument[],
  workplaces: readonly CareerWorkplace[],
  payslipYears: readonly YearStatsDto[],
): EvaluationStatsDto {
  const nameOf = new Map(workplaces.map((w) => [w.id, w.name]));
  const rules = toRules(approved, nameOf);
  const all = approved
    .filter((d) => d.reading.type === 'PERFORMANCE_REVIEW')
    .map((d) => {
      const e = toEvaluation(d, nameOf.get(d.workplaceId) ?? null);
      const own = rulesFor(e, rules);
      // A form that does not print its highest score takes the rules' one.
      if (e.maxScore === null && own?.maxScore) {
        e.maxScore = own.maxScore;
        e.scoreShare = e.score !== null ? round2(e.score / own.maxScore) : null;
      }
      e.band = bandFor(e.score, own);
      return e;
    })
    .sort((a, b) => when(a).localeCompare(when(b)));

  // A later form about the same period replaces the earlier one.
  const byPeriod = new Map<string, EvaluationDto>();
  const evaluations: EvaluationDto[] = [];
  for (const e of all) {
    const key = periodKey(e);
    const earlier = key ? byPeriod.get(key) : undefined;
    if (earlier) evaluations.splice(evaluations.indexOf(earlier), 1);
    if (key) byPeriod.set(key, e);
    evaluations.push(e);
  }
  evaluations.sort((a, b) => when(a).localeCompare(when(b)));

  const scored = evaluations.filter((e) => e.score !== null);
  const scores = scored.map((e) => e.score as number);
  const latest = evaluations.at(-1) ?? null;
  const lastTwo = scored.slice(-2);
  const criteria = criterionTrends(evaluations).sort(
    (a, b) => strength(b) - strength(a) || a.name.localeCompare(b.name),
  );
  const repeated = criteria.filter((c) => c.points.length > 1);
  const byChange = [...repeated].sort((a, b) => b.change - a.change);

  const roles: EvaluationStatsDto['roles'] = [];
  for (const e of evaluations) {
    if (!e.role && !e.team) continue;
    const last = roles.at(-1);
    const at = when(e) || null;
    if (last && last.role === e.role && last.team === e.team) last.to = at;
    else roles.push({ role: e.role, team: e.team, from: at, to: at });
  }

  const years = new Map<number, EvaluationDto[]>();
  for (const e of evaluations) {
    const year = evaluationYear(e);
    if (year === null) continue;
    years.set(year, [...(years.get(year) ?? []), e]);
  }
  const grossOf = new Map(payslipYears.map((y) => [y.year, y.gross]));
  const yearDtos: EvaluationYearDto[] = [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => {
      const yearScores = list
        .map((e) => e.score)
        .filter((s): s is number => s !== null);
      const bonus = round2(list.reduce((sum, e) => sum + (e.bonus ?? 0), 0));
      const gross = grossOf.get(year) ?? null;
      const lastOf = <T>(pick: (e: EvaluationDto) => T | null) =>
        [...list]
          .reverse()
          .map(pick)
          .find((v) => v !== null) ?? null;
      return {
        year,
        evaluations: list.length,
        averageScore: average(yearScores),
        bestScore: yearScores.length ? Math.max(...yearScores) : null,
        bonus,
        bonusTarget: lastOf((e) => e.bonusTarget),
        payslipGross: gross,
        bonusShareOfGrossPct: gross ? round1((bonus / gross) * 100) : null,
        role: lastOf((e) => e.role),
        annualGross: lastOf((e) => e.annualGross),
      };
    });

  const payouts = evaluations
    .map((e) => e.payoutPct)
    .filter((p): p is number => p !== null);
  return {
    count: evaluations.length,
    evaluations,
    latest,
    scoreChange:
      lastTwo.length === 2
        ? round2((lastTwo[1].score as number) - (lastTwo[0].score as number))
        : null,
    averageScore: average(scores),
    bestScore: scores.length ? Math.max(...scores) : null,
    averagePayoutPct: average(payouts),
    bonusTotal: round2(evaluations.reduce((sum, e) => sum + (e.bonus ?? 0), 0)),
    criteria,
    strongest: criteria.slice(0, 3).map((c) => c.name),
    // Never the same criterion as a strongest one.
    weakest: criteria
      .slice(Math.max(3, criteria.length - 3))
      .reverse()
      .map((c) => c.name),
    improving: byChange
      .filter((c) => c.change > 0)
      .slice(0, 3)
      .map((c) => c.name),
    declining: byChange
      .filter((c) => c.change < 0)
      .reverse()
      .slice(0, 3)
      .map((c) => c.name),
    roles,
    years: yearDtos,
    rules,
  };
}
