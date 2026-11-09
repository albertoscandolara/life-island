import {
  isOutdated,
  matchWorkplace,
  monthOf,
  normalizeName,
  normalizeTaxCode,
  proposeWorkplaceChanges,
  readWorkDocument,
  workDocumentType,
} from './work-documents.js';

// Anonymized: the fields the parse worker reads from an Italian LUL, with
// made-up names, codes and amounts.
const payslipFields = (
  month: string,
  extra: Record<string, string | number | null> = {},
) => ({
  employer: 'ESEMPIO LAVORI S.R.L.',
  employer_tax_code: '01234567890',
  employee_code: '12345',
  hire_date: '2020-03-01',
  pay_period: `2026-${month}-01/2026-${month}-28`,
  gross_pay: 2350,
  total_deductions: '610,00',
  net_pay: '1.740,00',
  job_level: 'B1',
  contract_type: 'Metalmeccanici Industria Impiegati',
  qualification: 'IMPIEGATI',
  monthly_salary: '2.350,00',
  base_minimum: 2290,
  seniority_increments: 2,
  vacation_left: 60,
  ...extra,
});

describe('workDocumentType', () => {
  const parentOf = new Map<string, string | null>([
    ['PAYSLIP', null],
    ['TREDICESIMA', 'PAYSLIP'],
    ['WORK', null],
  ]);

  it('knows a payslip, also under a subcategory of yours', () => {
    expect(workDocumentType(['INCOME', 'TREDICESIMA'], parentOf)).toEqual({
      isWork: true,
      type: 'PAYSLIP',
    });
  });

  it('counts a document filed only under WORK, with no type', () => {
    expect(workDocumentType(['WORK'], parentOf)).toEqual({
      isWork: true,
      type: null,
    });
    expect(workDocumentType(['BILL'], parentOf).isWork).toBe(false);
  });
});

describe('readWorkDocument', () => {
  it('reads a payslip: its workplace values, the month paid and its amounts', () => {
    const reading = readWorkDocument('PAYSLIP', payslipFields('06'));
    expect(reading.period).toBe('2026-06');
    expect(reading.date).toBe('2026-06-01');
    expect(reading.net).toBe(1740);
    expect(reading.deductions).toBe(610);
    expect(reading.values).toMatchObject({
      employerName: 'ESEMPIO LAVORI S.R.L.',
      employerTaxCode: '01234567890',
      hireDate: '2020-03-01',
      level: 'B1',
      monthlySalary: 2350,
      seniorityIncrements: 2,
    });
    expect(reading.facts.map((f) => f.label)).toContain('Net pay');
  });

  it('reads an evaluation: what it grants only, with its rating', () => {
    const reading = readWorkDocument('PERFORMANCE_REVIEW', {
      employer: 'Esempio Lavori srl',
      review_date: '2026-02-10',
      overall_rating: '4',
      rating_scale: '1-5',
      job_level: 'B2',
      hire_date: '2020-03-01',
      goals: 'Lead the new product',
    });
    expect(reading.date).toBe('2026-02-10');
    expect(reading.rating).toBe('4');
    expect(reading.values).toEqual({
      employerName: 'Esempio Lavori srl',
      level: 'B2',
    });
  });

  it('reads the period, scores and bonus of an evaluation', () => {
    const reading = readWorkDocument('PERFORMANCE_REVIEW', {
      employer: 'Esempio Lavori srl',
      review_date: '2026-05-20',
      review_period: '2026-01-01/2026-04-30',
      review_cycle: '1° quadrimestre 2026',
      role: 'Developer Senior',
      team: 'Team Alpha',
      overall_score: '91,5',
      section_scores: 'Team objective: 29.5\nPerformance: 32\nBehaviour: 30',
      criteria_scores:
        '- Gestione task: 4/5\nQualità: 4\nNo score here\nSupporto = 5 / 5',
      payout_percent: 75,
      bonus_target: '3.000,00',
      bonus_amount: 750,
      comments: 'Good feedback from the client',
    });
    expect(reading).toMatchObject({
      cycle: '1° quadrimestre 2026',
      periodStart: '2026-01-01',
      periodEnd: '2026-04-30',
      role: 'Developer Senior',
      team: 'Team Alpha',
      score: 91.5,
      payoutPct: 75,
      bonusTarget: 3000,
      bonus: 750,
      comments: 'Good feedback from the client',
    });
    expect(reading.sections.map((s) => s.score)).toEqual([29.5, 32, 30]);
    expect(reading.criteria).toEqual([
      { name: 'Gestione task', score: 4, max: 5 },
      { name: 'Qualità', score: 4, max: null },
      { name: 'Supporto', score: 5, max: 5 },
    ]);
  });

  it('reads a plain numeric rating as the score', () => {
    expect(
      readWorkDocument('PERFORMANCE_REVIEW', { overall_rating: '4' }).score,
    ).toBe(4);
    expect(
      readWorkDocument('PERFORMANCE_REVIEW', { overall_rating: '4/5' }).score,
    ).toBeNull();
  });

  it('takes the payer of an income document as the employer', () => {
    expect(
      readWorkDocument('PAYSLIP', { payer: 'ACME SPA' }).employerName,
    ).toBe('ACME SPA');
  });
});

describe('matching', () => {
  const known = [
    { id: 'a', values: { employerName: 'Esempio Lavori S.r.l.' } },
    {
      id: 'b',
      values: { employerName: 'Other', employerTaxCode: 'IT09876543210' },
    },
  ];

  it('matches by tax code first, then by name without the legal form', () => {
    expect(
      matchWorkplace(
        { employerName: 'Whatever', employerTaxCode: '09876543210' },
        known,
      ),
    ).toEqual({ workplace: known[1], match: 'tax_code' });
    expect(
      matchWorkplace(
        { employerName: 'ESEMPIO LAVORI SRL', employerTaxCode: null },
        known,
      ),
    ).toEqual({ workplace: known[0], match: 'name' });
    expect(
      matchWorkplace({ employerName: 'New Co', employerTaxCode: null }, known)
        .match,
    ).toBe('none');
  });

  it('normalizes names and tax codes', () => {
    expect(normalizeName('Esempio Lavori S.R.L.')).toBe('ESEMPIO LAVORI');
    expect(normalizeName('Enel Energia S.p.A.')).toBe('ENEL ENERGIA');
    expect(normalizeTaxCode('IT 01234567890')).toBe('01234567890');
    expect(monthOf('2026-06-01/2026-06-30')).toBe('2026-06');
  });
});

describe('proposeWorkplaceChanges', () => {
  const printed = readWorkDocument(
    'PAYSLIP',
    payslipFields('06', {
      job_level: 'B2',
      employee_code: '99999',
    }),
  ).values;
  const current = readWorkDocument('PAYSLIP', payslipFields('05')).values;

  it('takes a new level, checks a different employee code', () => {
    const changes = proposeWorkplaceChanges(printed, current, false);
    expect(changes).toEqual([
      expect.objectContaining({
        field: 'employeeCode',
        kind: 'different_value',
        suggestion: 'check',
      }),
      expect.objectContaining({
        field: 'level',
        current: 'B1',
        proposed: 'B2',
        suggestion: 'accept',
      }),
    ]);
  });

  it('keeps your values when the document is older than one you approved', () => {
    const changes = proposeWorkplaceChanges(printed, current, true);
    expect(changes.find((c) => c.field === 'level')?.suggestion).toBe(
      'keep_current',
    );
    expect(
      isOutdated({ date: '2026-03-01' }, [{ reading: { date: '2026-05-01' } }]),
    ).toBe(true);
    expect(isOutdated({ date: '2026-06-01' }, [])).toBe(false);
  });

  it('suggests every value for a new workplace', () => {
    const changes = proposeWorkplaceChanges(printed, null, false);
    expect(changes.every((c) => c.suggestion === 'accept')).toBe(true);
    expect(changes.length).toBe(Object.keys(printed).length);
  });
});
