import {
  CAREER_EVENT_LABELS,
  PLATFORM_STALE_DAYS,
  type CareerEventDto,
  type CareerFeedbackOutput,
  type CareerStatsDto,
  type EvaluationStatsDto,
  type HiringPlatformDto,
} from '@life-island/contracts';
import type { ApprovedWorkDocument, CareerWorkplace } from './career.js';

/*
 * The career feedback: a dossier of what you approved (workplaces, timeline,
 * pay statistics, evaluations, hiring platforms), written for the Claude API
 * or, without a key, read by Life Island's own rules. The dossier holds no
 * tax codes, employee codes or addresses: only what a career coach needs.
 */

export interface CareerDossierInput {
  workplaces: readonly CareerWorkplace[];
  documents: readonly ApprovedWorkDocument[];
  timeline: readonly CareerEventDto[];
  stats: CareerStatsDto;
  /** Evaluations read against their employer's rules (see evaluations.ts). */
  evaluations: EvaluationStatsDto;
  platforms: readonly HiringPlatformDto[];
  today: string;
}

const money = (n: number | null) =>
  n === null
    ? 'unknown'
    : n.toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });

const years = (months: number | null) =>
  months === null
    ? 'unknown'
    : months < 12
      ? `${months} months`
      : `${Math.floor(months / 12)} years${months % 12 ? ` ${months % 12} months` : ''}`;

/** The dossier as plain text, the only thing the model reads. */
export function careerDossier(input: CareerDossierInput): string {
  const { stats } = input;
  const lines: string[] = [`Today: ${input.today}`, '', '## Workplaces'];
  for (const w of input.workplaces) {
    const v = w.values;
    lines.push(
      `- ${w.name} (${w.status}): ${[
        v.hireDate ? `since ${v.hireDate}` : null,
        v.endDate ? `until ${v.endDate}` : null,
        v.contractKind ? `contract ${v.contractKind}` : null,
        v.collectiveAgreement ? `CCNL ${v.collectiveAgreement}` : null,
        v.qualification ? `qualification ${v.qualification}` : null,
        v.level ? `level ${v.level}` : null,
        v.jobTitle ? `role ${v.jobTitle}` : null,
        v.costCenter ? `team ${v.costCenter}` : null,
        typeof v.monthlySalary === 'number'
          ? `monthly gross ${money(v.monthlySalary)}`
          : null,
        typeof v.annualGrossSalary === 'number'
          ? `annual gross ${money(v.annualGrossSalary)}`
          : null,
        typeof v.partTimePercentage === 'number'
          ? `part time ${v.partTimePercentage}%`
          : null,
      ]
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  lines.push(
    '',
    '## Pay statistics',
    `- Payslips: ${stats.payslips}`,
    `- Current level: ${stats.currentLevel ?? 'unknown'}; monthly gross ${money(stats.currentMonthlySalary)}`,
    `- At the current workplace for ${years(stats.tenureMonths)}; whole career on record ${years(stats.careerMonths)}`,
    `- Monthly salary growth on record: ${stats.salaryGrowthPct ?? 'unknown'}%${stats.annualGrowthPct !== null ? ` (${stats.annualGrowthPct}% a year)` : ''}`,
    `- Months since the last rise or promotion: ${stats.monthsSinceLastRise ?? 'none on record'}`,
    `- Net over gross, last 12 months: ${stats.netRatio ?? 'unknown'}`,
    `- Vacation left: ${stats.vacationLeft ?? 'unknown'} h; leave (ROL) left: ${stats.leaveLeft ?? 'unknown'} h`,
  );
  for (const y of stats.years)
    lines.push(
      `- ${y.year}: ${y.payslips} payslips, gross ${money(y.gross)}, net ${money(y.net)}, income tax ${money(y.incomeTax)}, welfare ${money(y.welfare)}`,
    );
  lines.push('', '## Timeline (newest first)');
  for (const e of input.timeline.slice(0, 40))
    lines.push(
      `- ${e.date} ${CAREER_EVENT_LABELS[e.kind]}: ${e.title}${e.detail ? ` (${e.detail})` : ''}${e.workplaceName ? ` at ${e.workplaceName}` : ''}`,
    );
  lines.push(...evaluationLines(input.evaluations));
  lines.push('', '## Hiring platforms');
  if (!input.platforms.length) lines.push('- none');
  for (const p of input.platforms)
    lines.push(
      `- ${p.name} (${p.status}), profile updated ${p.profileUpdatedAt ?? 'never'}`,
    );
  return lines.join('\n');
}

const pct = (n: number | null) => (n === null ? 'unknown' : `${n}%`);

/** The evaluations, their statistics and the rules each employer scores them by. */
function evaluationLines(stats: EvaluationStatsDto): string[] {
  if (!stats.count && !stats.rules.length) return [];
  const lines: string[] = [];
  if (stats.rules.length) {
    lines.push('', "## Evaluation rules (each employer's own)");
    for (const r of stats.rules) {
      lines.push(
        `- ${r.workplaceName ?? r.title}${r.version ? `, version ${r.version}` : ''}${r.effectiveFrom ? `, from ${r.effectiveFrom}` : ''}: highest score ${r.maxScore ?? 'unknown'}, bonus target ${r.targetRule ?? 'unknown'}, highest payout ${pct(r.maxPayoutPct)}`,
      );
      if (r.sections.length)
        lines.push(
          `  Sections: ${r.sections.map((i) => `${i.name}${i.value !== null ? ` (max ${i.value})` : ''}${i.note ? `: ${i.note}` : ''}`).join('; ')}`,
        );
      if (r.scale.length)
        lines.push(
          `  Scale: ${r.scale.map((i) => `${i.name}${i.note ? ` = ${i.note}` : ''}`).join('; ')}`,
        );
      if (r.bands.length)
        lines.push(
          `  Conversion: ${r.bands.map((b) => `${b.min === null ? `below ${(b.max ?? 0) + 1}` : `${b.min}${b.max !== null ? `-${b.max}` : '+'}`} = ${b.pct}%`).join(', ')}`,
        );
      for (const line of [...r.schedule, ...r.notes].slice(0, 12))
        lines.push(`  ${line}`);
    }
  }
  if (!stats.count) return lines;
  lines.push(
    '',
    '## Evaluations (one per period, oldest first)',
    `- Average score ${stats.averageScore ?? 'unknown'}, best ${stats.bestScore ?? 'unknown'}, change since the one before ${stats.scoreChange ?? 'unknown'}; average bonus conversion ${pct(stats.averagePayoutPct)}`,
  );
  if (stats.strongest.length)
    lines.push(`- Strongest criteria: ${stats.strongest.join(', ')}`);
  if (stats.weakest.length)
    lines.push(`- Weakest criteria: ${stats.weakest.join(', ')}`);
  if (stats.improving.length)
    lines.push(`- Improving: ${stats.improving.join(', ')}`);
  if (stats.declining.length)
    lines.push(`- Declining: ${stats.declining.join(', ')}`);
  for (const y of stats.years)
    lines.push(
      `- ${y.year}: ${y.evaluations} evaluations, average ${y.averageScore ?? 'unknown'}, bonus paid ${money(y.bonus)} of target ${money(y.bonusTarget)}${y.bonusShareOfGrossPct !== null ? ` (${y.bonusShareOfGrossPct}% of the year's gross)` : ''}`,
    );
  for (const e of stats.evaluations) {
    const score =
      e.score !== null
        ? `score ${e.score}${e.maxScore ? `/${e.maxScore}` : ''}`
        : `rating ${e.rating ?? 'none'}`;
    const band = e.band
      ? `, converts to ${e.band.pct}%${e.band.pointsToNext !== null ? ` (${e.band.pointsToNext} points short of ${e.band.nextPct}%)` : ''}`
      : e.payoutPct !== null
        ? `, bonus conversion ${e.payoutPct}%`
        : '';
    lines.push(
      `- ${e.date ?? 'undated'}${e.cycle ? ` (${e.cycle})` : ''}${e.workplaceName ? ` at ${e.workplaceName}` : ''}: ${score}${band}${e.role ? `, role ${e.role}` : ''}${e.team ? `, team ${e.team}` : ''}`,
      ...(e.sections.length
        ? [
            `  Sections: ${e.sections.map((c) => `${c.name} ${c.score}${c.max ? `/${c.max}` : ''}`).join(', ')}`,
          ]
        : []),
      ...(e.criteria.length
        ? [
            `  Criteria: ${e.criteria.map((c) => `${c.name} ${c.score}${c.max ? `/${c.max}` : ''}`).join(', ')}`,
          ]
        : []),
      ...(e.comments ? [`  Comments: ${e.comments}`] : []),
      ...(e.strengths ? [`  Strengths: ${e.strengths}`] : []),
      ...(e.improvements ? [`  To improve: ${e.improvements}`] : []),
      ...(e.goals ? [`  Goals: ${e.goals}`] : []),
    );
  }
  return lines;
}

export const FEEDBACK_INSTRUCTIONS = `You are a frank, practical career coach for someone working in Italy. You read a dossier built from their own payslips, evaluations and contracts, and answer in English.
Base every statement on the dossier: quote the numbers and dates it holds, and say plainly when the data is too thin to judge. Never invent salaries, market figures or facts about the employer. When you compare with the market or with inflation, say it is a general rule of thumb and suggest how to check it (for example the CCNL tables, salary surveys, job ads on the hiring platforms).
Read each evaluation against its own employer's rules in the dossier (sections, scale, conversion to bonus): never apply one company's rules to another. Point out which criteria hold the score back and how many points the next bonus band needs.
Know the Italian context: CCNL levels and minimums, superminimo, scatti di anzianità, tredicesima and quattordicesima, welfare credits, TFR, ROL and ferie.
Give concrete next steps, verb first. If the person asks a question, answer it first and keep the rest short.`;

/** Life Island's own reading of the dossier, when no Claude API key is set. */
export function offlineFeedback(
  input: CareerDossierInput,
  question: string | null,
): CareerFeedbackOutput {
  const { stats, timeline, platforms, today } = input;
  const strengths: string[] = [];
  const watchouts: string[] = [];
  const suggestions: CareerFeedbackOutput['suggestions'] = [];

  if (!stats.payslips && !input.documents.length) {
    return {
      summary:
        'There is nothing approved in Work yet, so there is no career to read. Load your payslips, evaluations or contracts and approve them in "To review".',
      strengths: [],
      watchouts: [],
      suggestions: [
        {
          title: 'Load your last twelve payslips',
          detail:
            'A year of payslips is enough to see your level, your rises and what you really take home.',
        },
      ],
    };
  }

  const promotions = timeline.filter((e) => e.kind === 'promotion');
  const rises = timeline.filter((e) => e.kind === 'salary_rise');
  if (stats.salaryGrowthPct !== null && stats.salaryGrowthPct > 0)
    strengths.push(
      `Your monthly salary grew ${stats.salaryGrowthPct}% over the payslips on record${stats.annualGrowthPct !== null ? ` (${stats.annualGrowthPct}% a year)` : ''}.`,
    );
  if (promotions.length)
    strengths.push(
      `${promotions.length} promotion${promotions.length > 1 ? 's' : ''} on record, the latest on ${promotions[0].date}: ${promotions[0].title}.`,
    );
  if (rises.length)
    strengths.push(
      `The latest rise was on ${rises[0].date}: ${rises[0].title}.`,
    );
  if (stats.tenureMonths !== null && stats.tenureMonths >= 36)
    strengths.push(
      `${years(stats.tenureMonths)} at ${stats.currentEmployer ?? 'your employer'}: deep knowledge of the company is leverage in a negotiation.`,
    );

  if (stats.monthsSinceLastRise === null && stats.payslips >= 6)
    watchouts.push(
      'No rise or promotion shows in the payslips on record. Load older payslips to see the whole story, or treat this as a sign to ask.',
    );
  else if (
    stats.monthsSinceLastRise !== null &&
    stats.monthsSinceLastRise >= 18
  )
    watchouts.push(
      `${stats.monthsSinceLastRise} months since the last rise or promotion.`,
    );
  if (stats.annualGrowthPct !== null && stats.annualGrowthPct < 2)
    watchouts.push(
      `${stats.annualGrowthPct}% a year is below a typical 2% inflation (a rule of thumb, check ISTAT for the real figure): in real terms the salary may be shrinking.`,
    );
  if (stats.vacationLeft !== null && stats.vacationLeft > 120)
    watchouts.push(
      `${stats.vacationLeft} hours of vacation left: holidays not taken within 18 months of the year they matured can be lost.`,
    );
  if (stats.leaveLeft !== null && stats.leaveLeft > 150)
    watchouts.push(
      `${stats.leaveLeft} hours of ROL left: check with HR whether your CCNL pays them out or lets them expire.`,
    );
  if (stats.missingMonths.length)
    watchouts.push(
      `No payslip on record for ${stats.missingMonths.join(', ')}.`,
    );
  if (stats.checks.length)
    watchouts.push(
      `${stats.checks.length} payslip${stats.checks.length === 1 ? ' is' : 's are'} not fully in the figures (values not read): check them before reading too much into the totals.`,
    );

  const evaluations = input.documents.filter(
    (d) => d.reading.type === 'PERFORMANCE_REVIEW',
  );
  const review = input.evaluations;
  const latest = review.latest;
  if (latest?.score != null && review.scoreChange !== null) {
    if (review.scoreChange > 0)
      strengths.push(
        `Your latest evaluation scored ${latest.score}, ${review.scoreChange} points more than the one before.`,
      );
    else if (review.scoreChange < 0)
      watchouts.push(
        `Your latest evaluation scored ${latest.score}, ${-review.scoreChange} points less than the one before.`,
      );
  }
  if (review.strongest.length)
    strengths.push(
      `Your evaluations rate you best on ${review.strongest.join(', ')}.`,
    );
  if (review.declining.length)
    watchouts.push(
      `Dropping across your evaluations: ${review.declining.join(', ')}.`,
    );
  if (latest?.band?.pointsToNext != null && latest.band.nextPct !== null)
    suggestions.push({
      title: `Aim for ${latest.band.nextAt} points next time`,
      detail: `Your latest score converts to ${latest.band.pct}% of the bonus target; ${latest.band.pointsToNext} more points reach ${latest.band.nextPct}%.${review.weakest.length ? ` Your weakest criteria (${review.weakest.join(', ')}) have the most room.` : ''}`,
    });
  if (!evaluations.length)
    suggestions.push({
      title: 'Ask for a written evaluation',
      detail:
        'No evaluation is on record. A yearly written review with clear goals is the strongest argument for the next level: ask your manager for one, then load it here.',
    });
  else {
    const goals = evaluations.at(-1)?.reading.goals;
    if (goals)
      suggestions.push({
        title: 'Track the goals of your last evaluation',
        detail: `Your last evaluation set: ${goals}. Note your progress on each as a career event, so the next review starts from facts.`,
      });
  }
  if (stats.monthsSinceLastRise === null || stats.monthsSinceLastRise >= 12)
    suggestions.push({
      title: 'Prepare a pay conversation',
      detail: `Bring your level (${stats.currentLevel ?? 'unknown'}), your monthly gross (${money(stats.currentMonthlySalary)}), what you delivered since the last rise and the CCNL minimum of the next level. Ask for a superminimo or the next level, with a date.`,
    });
  const activePlatforms = platforms.filter((p) => p.status === 'active');
  if (!activePlatforms.length)
    suggestions.push({
      title: 'Sign up to one or two hiring platforms',
      detail:
        'Knowing what the market offers for your role is the best benchmark for your salary, even if you are not looking. Add them in "Hiring platforms".',
    });
  else {
    const stale = activePlatforms.filter((p) => p.stale);
    if (stale.length)
      suggestions.push({
        title: `Update your profile on ${stale.map((p) => p.name).join(', ')}`,
        detail: `Not updated for over ${PLATFORM_STALE_DAYS} days: add your current level, role and what you worked on.`,
      });
  }
  if (stats.vacationLeft !== null && stats.vacationLeft > 120)
    suggestions.push({
      title: 'Plan your vacation days',
      detail: `Book at least ${Math.round((stats.vacationLeft - 80) / 8)} days in the next months.`,
    });
  suggestions.push({
    title: 'Log what is not on paper',
    detail:
      'Courses, certifications, projects and awards are career events too: add them in the timeline, so the feedback sees them.',
  });

  const summary = [
    stats.currentEmployer
      ? `You work at ${stats.currentEmployer}${stats.tenureMonths !== null ? ` for ${years(stats.tenureMonths)}` : ''}${stats.currentLevel ? `, at level ${stats.currentLevel}` : ''}${stats.currentMonthlySalary !== null ? ` with a monthly gross of ${money(stats.currentMonthlySalary)}` : ''}.`
      : null,
    `${stats.payslips} payslip${stats.payslips === 1 ? '' : 's'} and ${evaluations.length} evaluation${evaluations.length === 1 ? '' : 's'} on record, up to ${today}.`,
    question
      ? "This feedback comes from Life Island's own rules, which cannot answer free questions: set ANTHROPIC_API_KEY in .env for an AI answer."
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    summary,
    strengths,
    watchouts,
    suggestions: suggestions.slice(0, 6),
  };
}
