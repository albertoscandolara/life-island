import type {
  Tax730FiledReturnDto,
  Tax730TaxFiguresDto,
  Tax730TaxReturnDto,
  TaxYearDto,
} from '@life-island/contracts';
import {
  bracketRows,
  creditsUse,
  euroSplit,
  figuresOf,
  marginalRate,
  settlementOf,
  taxSteps,
  taxWaterfall,
  trendOf,
  whatIf,
} from './explain';

/** A year whose credits are more than its tax: a building bonus that does not fit. */
const figures: Tax730TaxFiguresDto = {
  income: 30000,
  deductibleExpenses: 0,
  taxableIncome: 30000,
  grossTax: 7140,
  workDeductions: 1801,
  expenseDeductions: 6091,
  netTax: 0,
  irpefWithheld: 4214,
  advancesPaid: 0,
  balance: -4214,
};

const buckets = {
  general: 220,
  renovation: 5871,
  otherHome: null,
  energy: null,
};

const filed = (
  over: Partial<Tax730FiledReturnDto> = {},
): Tax730FiledReturnDto => ({
  uploadId: 'u1',
  title: 'Redditi PF 2025',
  form: 'redditi_pf',
  formLabel: 'Redditi PF',
  taxYear: 2024,
  filedOn: '2025-10-20',
  filingId: null,
  kind: 'ordinary',
  figures,
  buckets,
  irpefDue: 0,
  irpefCredit: 4214,
  surtaxDue: 0,
  surtaxCredit: 0,
  result: -4214,
  nextAdvanceFirst: 0,
  nextAdvanceSecond: 0,
  notes: [],
  ...over,
});

const taxReturn = (
  over: Partial<Tax730TaxReturnDto> = {},
): Tax730TaxReturnDto => ({
  form: 'redditi_pf',
  formLabel: 'Redditi PF',
  filingYear: 2025,
  deadline: '2025-10-31',
  status: 'filed',
  filed: filed(),
  forecast: null,
  comparison: null,
  ...over,
});

describe('creditsUse', () => {
  it('counts the credits that did not fit in the gross tax as lost', () => {
    expect(creditsUse(figures)).toEqual({
      total: 7892,
      used: 7140,
      lost: 752,
    });
  });

  it('loses nothing when the tax is larger than the credits', () => {
    expect(creditsUse({ ...figures, grossTax: 9000 })?.lost).toBe(0);
  });
});

describe('taxSteps', () => {
  it('walks from income to the result and names the lost credits', () => {
    const steps = taxSteps(figures, 2024);
    expect(steps.map((s) => s.id)).toEqual([
      'income',
      'taxable',
      'gross',
      'work',
      'expenses',
      'net',
      'withheld',
      'balance',
    ]);
    expect(steps.find((s) => s.id === 'expenses')?.explain).toContain('752');
    const balance = steps.at(-1);
    expect(balance?.value).toBe(-4214);
    expect(balance?.label).toContain('back');
  });
});

describe('taxWaterfall', () => {
  it('stops the credits at zero and draws the rest as lost', () => {
    const bars = taxWaterfall(figures);
    const lost = bars.find((b) => b.kind === 'lost');
    expect(lost).toMatchObject({ start: -752, end: 0, value: 752 });
    expect(bars.find((b) => b.id === 'net')?.value).toBe(0);
    expect(bars.at(-1)).toMatchObject({
      kind: 'result',
      start: -4214,
      end: 0,
    });
  });
});

describe('brackets and rates', () => {
  it('splits a 2024 income into the three brackets', () => {
    const rows = bracketRows(30000, 2024);
    expect(rows.map((r) => [r.amount, r.tax, r.top])).toEqual([
      [28000, 6440, false],
      [2000, 700, true],
      [0, 0, false],
    ]);
    expect(marginalRate(30000, 2024)).toBe(0.35);
    expect(marginalRate(30000, 2026)).toBe(0.33);
  });

  it('uses the five brackets before 2022', () => {
    expect(bracketRows(30000, 2021)).toHaveLength(5);
    expect(marginalRate(30000, 2021)).toBe(0.38);
  });

  it('splits €100 of income into IRPEF, credits and the rest', () => {
    const split = euroSplit({ ...figures, grossTax: 7140, netTax: 1000 });
    expect(split).toMatchObject({ irpef: 3.33, credits: 20.47, kept: 76.2 });
  });
});

describe('whatIf', () => {
  it('loses a new credit entirely when the tax is already zero', () => {
    const r = whatIf('health', 1000, figures, 2024);
    expect(r).toMatchObject({ nominal: 190, thisYear: 0, lost: 190 });
  });

  it('gives 19% back when there is tax left', () => {
    const r = whatIf('health', 1000, { ...figures, netTax: 2000 }, 2024);
    expect(r).toMatchObject({ thisYear: 190, lost: 0 });
  });

  it('spreads a building bonus over ten years', () => {
    const r = whatIf('renovation', 10000, { ...figures, netTax: 2000 }, 2024);
    expect(r).toMatchObject({ instalments: 10, thisYear: 500, total: 5000 });
  });

  it('saves the top rate on a deduction, while there is tax', () => {
    const ok = whatIf(
      'pension',
      1000,
      { ...figures, workDeductions: 1801, expenseDeductions: 0, netTax: 5339 },
      2024,
    );
    expect(ok).toMatchObject({ mechanism: 'deduzione', thisYear: 350 });
    expect(whatIf('pension', 1000, figures, 2024)?.thisYear).toBe(0);
  });
});

describe('settlementOf', () => {
  it('pays the next advances with a Redditi PF credit first', () => {
    const s = settlementOf(
      taxReturn({
        filed: filed({ nextAdvanceFirst: 400, nextAdvanceSecond: 600 }),
      }),
    );
    expect(s?.creditLeft).toBe(3214);
    expect(s?.toPay).toBe(0);
    expect(s?.steps.every((step) => step.paidWith === 'credit')).toBe(true);
  });

  it('leaves the rest to pay with F24 when the credit runs out', () => {
    const s = settlementOf(
      taxReturn({
        filed: filed({
          irpefCredit: 300,
          result: -300,
          nextAdvanceFirst: 400,
          nextAdvanceSecond: 600,
        }),
      }),
    );
    expect(s?.toPay).toBe(700);
    expect(s?.steps.map((step) => [step.paidWith, step.amount])).toEqual([
      ['credit', 300],
      ['f24', 100],
      ['f24', 600],
    ]);
  });
});

describe('figuresOf and trendOf', () => {
  it('prefers the filed figures and falls back on the forecast', () => {
    const forecast = {
      figures,
      buckets,
      basis: [],
      missing: [],
      projected: false,
    };
    expect(figuresOf(taxReturn({ forecast }))?.source).toBe('filed');
    expect(figuresOf(taxReturn({ forecast }), 'forecast')?.source).toBe(
      'forecast',
    );
    expect(figuresOf(taxReturn({ filed: null, forecast }))?.source).toBe(
      'forecast',
    );
  });

  it('lists the years with figures, oldest first', () => {
    const year = (taxYear: number, r: Tax730TaxReturnDto) =>
      ({ taxYear, taxReturn: r }) as TaxYearDto;
    const trend = trendOf([
      year(2025, taxReturn({ filed: null, forecast: null })),
      year(2024, taxReturn()),
      year(2023, taxReturn({ filed: filed({ result: 120 }) })),
    ]);
    expect(trend.map((t) => [t.taxYear, t.result, t.lost])).toEqual([
      [2023, 120, 752],
      [2024, -4214, 752],
    ]);
    expect(trend[1].effectiveRate).toBe(0);
  });
});
