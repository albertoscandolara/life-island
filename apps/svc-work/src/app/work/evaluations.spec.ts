import { describe, expect, it } from 'vitest';
import type { ApprovedWorkDocument, CareerWorkplace } from './career.js';
import {
  bandFor,
  buildEvaluationStats,
  rulesFor,
  sameCriterion,
  toRules,
} from './evaluations.js';
import { readWorkDocument } from './work-documents.js';

// Made-up evaluations: four-monthly forms, like many Italian companies use.
const workplace: CareerWorkplace = {
  id: 'w1',
  name: 'Esempio Lavori',
  status: 'current',
  values: {},
};

let n = 0;
const evaluation = (
  fields: Record<string, string | number>,
): ApprovedWorkDocument => ({
  uploadId: `u${++n}`,
  title: `Evaluation ${n}`,
  workplaceId: 'w1',
  reading: readWorkDocument('PERFORMANCE_REVIEW', {
    employer: 'Esempio Lavori srl',
    ...fields,
  }),
});

describe('sameCriterion', () => {
  it('matches the same criterion written a little differently', () => {
    expect(sameCriterion('Qualità', 'Qualità del prodotto')).toBe(true);
    expect(sameCriterion('Tecnologie', 'Conoscenza tecnologie')).toBe(true);
    expect(sameCriterion('Gestione Task', 'gestione task')).toBe(true);
    expect(sameCriterion('Supporto', 'Supporto al/la responsabile')).toBe(true);
    expect(sameCriterion('Organizzazione', 'Clima aziendale')).toBe(false);
  });
});

describe('buildEvaluationStats', () => {
  const docs = [
    evaluation({
      review_date: '2025-05-20',
      review_cycle: '1° quadrimestre 2025',
      review_period: '2025-01-01/2025-04-30',
      role: 'Developer Middle',
      team: 'Team Alpha',
      overall_score: 78,
      criteria_scores:
        'Gestione task: 3\nQualità: 4\nTecnologie: 4\nSupporto: 3',
      payout_percent: 60,
      bonus_amount: 500,
      bonus_target: 2600,
      annual_gross_salary: 26000,
    }),
    evaluation({
      review_date: '2025-09-20',
      review_cycle: '2° quadrimestre 2025',
      role: 'Developer Middle',
      team: 'Team Alpha',
      overall_score: 84,
      criteria_scores:
        'Gestione task: 4\nQualità del prodotto: 4\nConoscenza tecnologie: 4\nSupporto: 3',
      payout_percent: 70,
      bonus_amount: 600,
    }),
    // The same period again, sent later with a correction: it replaces the first.
    evaluation({
      review_date: '2025-10-01',
      review_cycle: '2° quadrimestre 2025',
      role: 'Developer Middle',
      team: 'Team Alpha',
      overall_score: 86,
      criteria_scores:
        'Gestione task: 4\nQualità del prodotto: 4\nConoscenza tecnologie: 4\nSupporto: 4',
      payout_percent: 70,
      bonus_amount: 620,
    }),
    // A form delivered in January about the last period of the year before.
    evaluation({
      review_date: '2026-01-25',
      review_cycle: '3° quadrimestre 2025',
      role: 'Developer Senior',
      team: 'Team Beta',
      overall_score: 95,
      criteria_scores:
        'Gestione task: 4\nQualità del prodotto: 5\nTecnologie: 4\nSupporto al responsabile: 5',
      payout_percent: 80,
      bonus_amount: 700,
    }),
  ];
  const stats = buildEvaluationStats(
    docs,
    [workplace],
    [
      {
        year: 2025,
        payslips: 12,
        gross: 30000,
        net: 21000,
        incomeTax: 5000,
        contributions: 2800,
        welfare: 0,
        severance: 2000,
        averageNet: 1750,
        extraPay: 0,
      },
    ],
  );

  it('keeps one evaluation per period, oldest first', () => {
    expect(stats.count).toBe(3);
    expect(stats.evaluations.map((e) => e.score)).toEqual([78, 86, 95]);
    expect(stats.latest?.role).toBe('Developer Senior');
    expect(stats.scoreChange).toBe(9);
    expect(stats.averageScore).toBe(86.33);
    expect(stats.bestScore).toBe(95);
    expect(stats.averagePayoutPct).toBe(70);
    expect(stats.bonusTotal).toBe(1820);
  });

  it('follows each criterion across its names', () => {
    expect(stats.criteria.map((c) => c.name)).toEqual([
      'Qualità del prodotto',
      'Supporto al responsabile',
      'Tecnologie',
      'Gestione task',
    ]);
    const support = stats.criteria.find((c) => c.name.startsWith('Supporto'));
    expect(support).toMatchObject({ first: 3, latest: 5, change: 2 });
    expect(stats.improving[0]).toBe('Supporto al responsabile');
    expect(stats.strongest).toHaveLength(3);
    expect(stats.weakest).toEqual(['Gestione task']);
  });

  it('counts the year an evaluation is about, not when it was delivered', () => {
    expect(stats.years).toEqual([
      expect.objectContaining({
        year: 2025,
        evaluations: 3,
        bonus: 1820,
        bonusTarget: 2600,
        payslipGross: 30000,
        bonusShareOfGrossPct: 6.1,
        role: 'Developer Senior',
        annualGross: 26000,
      }),
    ]);
  });

  it('lists each role and team once, with when it held', () => {
    expect(stats.roles).toEqual([
      expect.objectContaining({
        role: 'Developer Middle',
        team: 'Team Alpha',
      }),
      expect.objectContaining({ role: 'Developer Senior', team: 'Team Beta' }),
    ]);
  });
});

// Made-up rules of a made-up employer, in two versions.
const rulesDoc = (
  uploadId: string,
  fields: Record<string, string | number>,
): ApprovedWorkDocument => ({
  uploadId,
  title: `Rules ${uploadId}`,
  workplaceId: 'w1',
  reading: readWorkDocument('EVALUATION_RULES', {
    employer: 'Esempio Lavori srl',
    ...fields,
  }),
});

describe('evaluation rules', () => {
  const v1 = rulesDoc('r1', {
    version: 'V1',
    effective_from: '2024-01-01',
    max_score: 100,
    conversion_table: '90-100: 100%\n80-89: 75\nda 70 a 79: 50\n< 70: 0',
  });
  const v2 = rulesDoc('r2', {
    version: 'V2',
    effective_from: '2026-01-01',
    max_score: 120,
    bonus_target_rule: '10% of the RAL',
    sections:
      'Team objective: 40 – 4 indicators\nPerformance: 40 (4 criteria from 1 to 5, times 2)\nBehaviour: 20',
    score_scale: '1: inadequate\n3: adequate and steady\nLivello 5: excellent',
    conversion_table: '>= 110: 100\n100-109: 80\n< 100: 0',
    payout_schedule:
      '- January-April: paid in May\n- May-August: paid in September',
  });
  const rules = toRules([v1, v2], new Map([['w1', 'Esempio Lavori']]));

  it('reads sections, scale and conversion bands from text', () => {
    const latest = rules[0];
    expect(latest.version).toBe('V2');
    expect(latest.sections).toEqual([
      { name: 'Team objective', value: 40, note: '4 indicators' },
      {
        name: 'Performance',
        value: 40,
        note: '4 criteria from 1 to 5, times 2',
      },
      { name: 'Behaviour', value: 20, note: null },
    ]);
    expect(latest.scale.map((i) => [i.value, i.note])).toEqual([
      [1, 'inadequate'],
      [3, 'adequate and steady'],
      [5, 'excellent'],
    ]);
    expect(latest.bands).toEqual([
      { min: null, max: 99, pct: 0 },
      { min: 100, max: 109, pct: 80 },
      { min: 110, max: null, pct: 100 },
    ]);
    expect(latest.schedule).toEqual([
      'January-April: paid in May',
      'May-August: paid in September',
    ]);
  });

  it('picks the version in force on the date of the evaluation', () => {
    expect(
      rulesFor(
        { workplaceId: 'w1', date: '2025-05-01', periodEnd: null },
        rules,
      )?.version,
    ).toBe('V1');
    expect(
      rulesFor(
        { workplaceId: 'w1', date: '2026-05-01', periodEnd: null },
        rules,
      )?.version,
    ).toBe('V2');
    // Older than every version: the oldest one.
    expect(
      rulesFor(
        { workplaceId: 'w1', date: '2023-05-01', periodEnd: null },
        rules,
      )?.version,
    ).toBe('V1');
    expect(
      rulesFor(
        { workplaceId: 'w2', date: '2026-05-01', periodEnd: null },
        rules,
      ),
    ).toBeNull();
  });

  it('places a score in its band, also between two printed ranges', () => {
    const v1Rules = rules[1];
    expect(bandFor(85, v1Rules)).toMatchObject({
      pct: 75,
      nextAt: 90,
      nextPct: 100,
      pointsToNext: 5,
      marginBelow: 5,
    });
    expect(bandFor(89.5, v1Rules)?.pct).toBe(75);
    expect(bandFor(60, v1Rules)).toMatchObject({
      pct: 0,
      nextAt: 70,
      pointsToNext: 10,
      marginBelow: null,
    });
    expect(bandFor(95, v1Rules)).toMatchObject({
      pct: 100,
      nextAt: null,
      pointsToNext: null,
    });
    expect(bandFor(null, v1Rules)).toBeNull();
  });

  it('reads each evaluation against its rules and lists the rules', () => {
    const stats = buildEvaluationStats(
      [
        v1,
        v2,
        evaluation({
          review_date: '2026-05-20',
          review_cycle: '1° quadrimestre 2026',
          overall_score: 104,
        }),
      ],
      [workplace],
      [],
    );
    const [e] = stats.evaluations;
    expect(e.maxScore).toBe(120);
    expect(e.band).toMatchObject({
      rulesUploadId: 'r2',
      pct: 80,
      pointsToNext: 6,
    });
    expect(stats.rules.map((r) => r.uploadId)).toEqual(['r2', 'r1']);
  });
});
