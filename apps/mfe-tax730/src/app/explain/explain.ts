import { euro } from '@life-island/records-ui';
import {
  irpefByBracket,
  pensionDeductionLimit,
  tax730DeductionRules,
  type IrpefBracketShare,
  type Tax730ExpenseBucketsDto,
  type Tax730TaxFiguresDto,
  type Tax730TaxReturnDto,
  type TaxYearDto,
} from '@life-island/contracts';

/*
 * The arithmetic behind "Your tax, explained": pure functions over the
 * figures of a year's return (filed, or forecast from your documents), so
 * the cards only draw them. Nothing here is sent anywhere.
 */

const round = (value: number) => Math.round(value * 100) / 100;

/** Where a year's figures come from. */
export type FigureSource = 'filed' | 'forecast';

export interface YearFigures {
  source: FigureSource;
  figures: Tax730TaxFiguresDto;
  buckets: Tax730ExpenseBucketsDto;
}

/** The filed return's figures when there is one, the forecast's otherwise; null with neither. */
export function figuresOf(
  r: Tax730TaxReturnDto,
  prefer: FigureSource = 'filed',
): YearFigures | null {
  const filed = r.filed
    ? {
        source: 'filed' as const,
        figures: r.filed.figures,
        buckets: r.filed.buckets,
      }
    : null;
  const forecast = r.forecast
    ? {
        source: 'forecast' as const,
        figures: r.forecast.figures,
        buckets: r.forecast.buckets,
      }
    : null;
  return prefer === 'forecast' ? (forecast ?? filed) : (filed ?? forecast);
}

// ---------------------------------------------------------------------------
// Tax credits and capienza
// ---------------------------------------------------------------------------

export interface CreditsUse {
  /** Every tax credit the return gives (RN8 + RN13…RN21, i.e. RN22). */
  total: number;
  /** The part that actually lowered the tax: at most the gross tax. */
  used: number;
  /** The part that did not fit (incapienza): lost for good, never paid back. */
  lost: number;
}

/**
 * Tax credits (detrazioni) can only cancel tax: once the gross tax is down
 * to zero, the rest is lost. Null when the gross tax is not known.
 */
export function creditsUse(f: Tax730TaxFiguresDto): CreditsUse | null {
  if (f.grossTax === null) return null;
  const total = round((f.workDeductions ?? 0) + (f.expenseDeductions ?? 0));
  const used = round(Math.min(total, f.grossTax));
  return { total, used, lost: round(Math.max(0, total - f.grossTax)) };
}

// ---------------------------------------------------------------------------
// From income to the result, step by step
// ---------------------------------------------------------------------------

export type StepKind = 'start' | 'minus' | 'total' | 'result';

export interface TaxStep {
  id: string;
  kind: StepKind;
  label: string;
  /** The Italian name on the return, and its row. */
  italian: string;
  row: string;
  /** Positive amounts; a `minus` step is taken off. A result can be below zero (a credit). */
  value: number;
  /** One or two sentences for a beginner. */
  explain: string;
}

/**
 * The tax of a year in the order the return computes it: income, less
 * deductible charges, is taxable; the brackets give the gross tax; tax
 * credits lower it to the net tax; what was withheld and paid in advance
 * is taken off, and what is left is to pay (or a credit).
 */
export function taxSteps(f: Tax730TaxFiguresDto, taxYear: number): TaxStep[] {
  const steps: TaxStep[] = [];
  const credits = creditsUse(f);
  if (f.income !== null)
    steps.push({
      id: 'income',
      kind: 'start',
      label: 'Your income',
      italian: 'Reddito complessivo',
      row: 'RN1',
      value: f.income,
      explain:
        'Everything IRPEF counts: your salary as the Certificazione Unica prints it (before tax, after INPS contributions), plus buildings and other income. Flat-rate (forfettario) self-employed income is taxed apart, at 5% or 15%, and is not in it.',
    });
  if (f.deductibleExpenses)
    steps.push({
      id: 'deductible',
      kind: 'minus',
      label: 'Deductible charges',
      italian: 'Oneri deducibili (deduzioni)',
      row: 'RN3',
      value: f.deductibleExpenses,
      explain:
        'Some payments come off the income itself, before any tax is computed: pension fund contributions your employer did not already take off, domestic workers’ contributions, donations. Each euro here saves you your top bracket rate.',
    });
  if (f.taxableIncome !== null)
    steps.push({
      id: 'taxable',
      kind: 'total',
      label: 'Taxable income',
      italian: 'Reddito imponibile',
      row: 'RN4',
      value: f.taxableIncome,
      explain:
        'The income the tax is computed on. It is cut into slices (scaglioni) and each slice pays its own rate: see the brackets below.',
    });
  if (f.grossTax !== null)
    steps.push({
      id: 'gross',
      kind: 'total',
      label: 'Gross IRPEF',
      italian: 'Imposta lorda',
      row: 'RN5',
      value: f.grossTax,
      explain: `The tax before any credit: ${bracketSentence(taxYear)}`,
    });
  if (f.workDeductions)
    steps.push({
      id: 'work',
      kind: 'minus',
      label: 'Employment tax credits',
      italian: 'Detrazioni per lavoro dipendente e familiari',
      row: 'RN8',
      value: f.workDeductions,
      explain:
        'Every employee gets a tax discount that is bigger on lower incomes (and one for each dependant). Your employer already applies it on each payslip.',
    });
  if (f.expenseDeductions)
    steps.push({
      id: 'expenses',
      kind: 'minus',
      label: 'Credits from your expenses',
      italian: 'Detrazioni per oneri e spese',
      row: 'RN13–RN21',
      value: f.expenseDeductions,
      explain:
        credits && credits.lost > 0
          ? `Health, mortgage interest, home bonuses and the others give back a share of what you spent. Here they were more than your tax: ${euroText(credits.lost)} did not fit and is lost (incapienza).`
          : 'Health, mortgage interest, home bonuses and the others give back a share of what you spent, as a discount on the tax.',
    });
  if (f.netTax !== null)
    steps.push({
      id: 'net',
      kind: 'total',
      label: 'Net IRPEF',
      italian: 'Imposta netta',
      row: 'RN26',
      value: f.netTax,
      explain:
        f.netTax === 0
          ? 'Your credits cancelled the whole tax: for this year you owe no IRPEF at all.'
          : 'The IRPEF you really owe for the year, after every credit.',
    });
  if (f.irpefWithheld !== null)
    steps.push({
      id: 'withheld',
      kind: 'minus',
      label: 'Already withheld from your pay',
      italian: 'Ritenute',
      row: 'RN33',
      value: f.irpefWithheld,
      explain:
        'During the year your employer kept IRPEF from every payslip and paid it for you: it is on the Certificazione Unica.',
    });
  if (f.advancesPaid)
    steps.push({
      id: 'advances',
      kind: 'minus',
      label: 'Advances you paid',
      italian: 'Acconti versati',
      row: 'RN38',
      value: f.advancesPaid,
      explain:
        'With Redditi PF you pay part of this year’s tax in advance, with F24, in June and November of the same year.',
    });
  if (f.balance !== null)
    steps.push({
      id: 'balance',
      kind: 'result',
      label:
        f.balance > 0
          ? 'Left to pay'
          : f.balance < 0
            ? 'Paid too much: yours back'
            : 'Even',
      italian: f.balance > 0 ? 'IRPEF a debito' : 'IRPEF a credito',
      row: 'RX1',
      value: f.balance,
      explain:
        f.balance > 0
          ? 'You paid less than the tax during the year: the difference is paid with the return.'
          : f.balance < 0
            ? 'Withholdings and advances were more than the tax you owe: the difference is a credit, yours to get back or to use.'
            : 'What was withheld matches the tax: nothing to pay, nothing back.',
    });
  return steps;
}

function bracketSentence(taxYear: number): string {
  const parts = irpefByBracket(0, taxYear).map((b) =>
    b.to === null
      ? `${pct(b.rate)} above ${euroText(b.from)}`
      : `${pct(b.rate)} up to ${euroText(b.to)}`,
  );
  return `in ${taxYear} ${parts.join(', ')}. Only the slice above each limit pays the higher rate.`;
}

/** A horizontal waterfall of the tax: each bar from where the last one ended. */
export interface WaterfallBar {
  id: string;
  label: string;
  kind: 'total' | 'minus' | 'lost' | 'result';
  /** Where the bar starts and ends, in euros (start ≤ end). */
  start: number;
  end: number;
  value: number;
}

/** From the gross tax to the result: credits, net tax, withholdings and advances. */
export function taxWaterfall(f: Tax730TaxFiguresDto): WaterfallBar[] {
  if (f.grossTax === null) return [];
  const bars: WaterfallBar[] = [];
  const gross = f.grossTax;
  bars.push({
    id: 'gross',
    label: 'Gross IRPEF',
    kind: 'total',
    start: 0,
    end: gross,
    value: gross,
  });
  let level = gross;
  for (const [id, label, amount] of [
    ['work', 'Employment credits', f.workDeductions ?? 0],
    ['expenses', 'Credits from expenses', f.expenseDeductions ?? 0],
  ] as const) {
    if (!amount) continue;
    const used = Math.min(amount, level);
    if (used > 0)
      bars.push({
        id,
        label,
        kind: 'minus',
        start: round(level - used),
        end: level,
        value: round(used),
      });
    if (amount > used)
      bars.push({
        id: `${id}-lost`,
        label: 'Did not fit: lost',
        kind: 'lost',
        start: round(level - amount),
        end: round(level - used),
        value: round(amount - used),
      });
    level = round(level - used);
  }
  const net = f.netTax ?? level;
  bars.push({
    id: 'net',
    label: 'Net IRPEF',
    kind: 'total',
    start: 0,
    end: net,
    value: net,
  });
  level = net;
  for (const [id, label, amount] of [
    ['withheld', 'Withheld from pay', f.irpefWithheld ?? 0],
    ['advances', 'Advances paid', f.advancesPaid ?? 0],
  ] as const) {
    if (!amount) continue;
    bars.push({
      id,
      label,
      kind: 'minus',
      start: round(level - amount),
      end: level,
      value: amount,
    });
    level = round(level - amount);
  }
  const balance = f.balance ?? level;
  bars.push({
    id: 'balance',
    label: balance > 0 ? 'To pay' : balance < 0 ? 'Credit' : 'Even',
    kind: 'result',
    start: Math.min(0, balance),
    end: Math.max(0, balance),
    value: balance,
  });
  return bars;
}

// ---------------------------------------------------------------------------
// Brackets, rates and where each euro goes
// ---------------------------------------------------------------------------

export interface BracketRow extends IrpefBracketShare {
  /** The bracket your last euro falls in. */
  top: boolean;
}

export function bracketRows(taxable: number, taxYear: number): BracketRow[] {
  const shares = irpefByBracket(taxable, taxYear);
  const lastIndex = shares.reduce(
    (last, share, i) => (share.amount > 0 ? i : last),
    0,
  );
  return shares.map((share, i) => ({ ...share, top: i === lastIndex }));
}

/** The rate of your next euro of income: the bracket the taxable income ends in. */
export function marginalRate(taxable: number, taxYear: number): number {
  const top = bracketRows(taxable, taxYear).find((b) => b.top);
  return top?.rate ?? irpefByBracket(0, taxYear)[0].rate;
}

export interface EuroSplit {
  /** Of each €100 of income: kept, saved by credits, paid as IRPEF. */
  kept: number;
  credits: number;
  irpef: number;
  /** Net IRPEF over income. */
  effectiveRate: number;
  /** Gross IRPEF over income, before the credits. */
  grossRate: number;
}

/**
 * Where €100 of income goes: the IRPEF you pay, the tax your credits
 * cancelled, and what stays with you. Null without income and gross tax.
 */
export function euroSplit(f: Tax730TaxFiguresDto): EuroSplit | null {
  const income = f.income;
  if (!income || income <= 0 || f.grossTax === null) return null;
  const net = f.netTax ?? Math.max(0, f.grossTax - (creditsUse(f)?.used ?? 0));
  const per100 = (value: number) => round((value / income) * 100);
  const irpef = per100(net);
  const credits = per100(Math.max(0, f.grossTax - net));
  return {
    irpef,
    credits,
    kept: round(100 - irpef - credits),
    effectiveRate: net / income,
    grossRate: f.grossTax / income,
  };
}

// ---------------------------------------------------------------------------
// What if: what one more expense or contribution would be worth
// ---------------------------------------------------------------------------

export const WHAT_IF_KINDS = [
  'health',
  'expense19',
  'renovation',
  'pension',
] as const;
export type WhatIfKind = (typeof WHAT_IF_KINDS)[number];

export const WHAT_IF_LABELS: Record<WhatIfKind, string> = {
  health: 'A health expense (19% back)',
  expense19: 'Another 19% expense (school, sport, vet…)',
  renovation: 'Renovation works (building bonus, 10 years)',
  pension: 'A pension fund contribution (deduzione)',
};

export interface WhatIfResult {
  kind: WhatIfKind;
  /** detrazione: lowers the tax; deduzione: lowers the income. */
  mechanism: 'detrazione' | 'deduzione';
  rate: number;
  /** What it would be worth in full, before checking your tax. */
  nominal: number;
  /** What it would actually save in this year's return. */
  thisYear: number;
  /** Over every instalment, if your tax stays the same. */
  total: number;
  /** What would not fit in your tax and be lost. */
  lost: number;
  instalments: number;
  explain: string;
}

/**
 * What `amount` more spent in `taxYear` would save, against that year's
 * figures. A detrazione is worth its rate but only up to the net tax that
 * is left; a deduzione is worth your top rate, and also only while there
 * is tax to cut.
 */
export function whatIf(
  kind: WhatIfKind,
  amount: number,
  f: Tax730TaxFiguresDto,
  taxYear: number,
): WhatIfResult | null {
  if (!(amount > 0) || f.netTax === null) return null;
  const room = Math.max(0, f.netTax);
  if (kind === 'pension') {
    const limit = pensionDeductionLimit(taxYear);
    const counted = Math.min(amount, limit);
    const taxable = f.taxableIncome ?? 0;
    const rate = marginalRate(taxable, taxYear);
    const before = grossOf(taxable, taxYear);
    const after = grossOf(Math.max(0, taxable - counted), taxYear);
    const nominal = round(before - after);
    const credits = creditsUse(f)?.total ?? 0;
    const netBefore = Math.max(0, before - credits);
    const netAfter = Math.max(0, after - credits);
    const saved = round(netBefore - netAfter);
    return {
      kind,
      mechanism: 'deduzione',
      rate,
      nominal,
      thisYear: saved,
      total: saved,
      lost: round(nominal - saved),
      instalments: 1,
      explain:
        amount > limit
          ? `Only ${euroText(limit)} a year is deductible; the rest is not.`
          : `It comes off your taxable income, so it saves your top rate, ${pct(rate)}.`,
    };
  }
  const rules = tax730DeductionRules(taxYear);
  const group =
    kind === 'health'
      ? 'health'
      : kind === 'renovation'
        ? 'renovation'
        : 'education';
  const rule = rules.find((r) => r.group === group);
  const rate = rule?.rate ?? 0.19;
  const instalments = kind === 'renovation' ? 10 : 1;
  const nominal = round(amount * rate);
  const yearly = round(nominal / instalments);
  const thisYear = round(Math.min(yearly, room));
  return {
    kind,
    mechanism: 'detrazione',
    rate,
    nominal,
    thisYear,
    total: round(thisYear * instalments),
    lost: round(nominal - thisYear * instalments),
    instalments,
    explain:
      room <= 0
        ? 'Your tax is already zero: a new tax credit would be lost entirely.'
        : thisYear < yearly
          ? `Only ${euroText(room)} of tax is left to cancel, so part of it would be lost.`
          : instalments > 1
            ? `${pct(rate)} of it, in ${instalments} yearly instalments of ${euroText(yearly)}.`
            : kind === 'health'
              ? `${pct(rate)} of it (the first €129.11 of health expenses in a year never counts).`
              : `${pct(rate)} of it, within that expense's yearly cap.`,
  };
}

function grossOf(taxable: number, taxYear: number): number {
  return round(
    irpefByBracket(taxable, taxYear).reduce((sum, b) => sum + b.tax, 0),
  );
}

// ---------------------------------------------------------------------------
// Credit, debit and F24
// ---------------------------------------------------------------------------

export interface SettlementStep {
  date: string;
  label: string;
  amount: number;
  /** Paid by you, or a credit that pays it for you. */
  paidWith: 'credit' | 'f24' | 'payslip';
}

export interface Settlement {
  form: Tax730TaxReturnDto['form'];
  /** Everything due less every credit, IRPEF and surtaxes: above zero you pay. */
  result: number;
  credit: number;
  due: number;
  nextAdvances: number;
  /** The credit after it pays the next year's advances; carried over or refunded. */
  creditLeft: number;
  /** What you still pay with F24 once the credit is used. */
  toPay: number;
  steps: SettlementStep[];
}

/** What the filed return leaves to do, with its credit used in F24 first. */
export function settlementOf(r: Tax730TaxReturnDto): Settlement | null {
  const f = r.filed;
  if (!f) return null;
  const credit = round(f.irpefCredit + f.surtaxCredit);
  const due = round(f.irpefDue + f.surtaxDue);
  const advances = round(f.nextAdvanceFirst + f.nextAdvanceSecond);
  const steps: SettlementStep[] = [];
  const year = f.taxYear + 1;
  if (f.form === '730') {
    if (due > 0 || credit > 0)
      steps.push({
        date: `${year}-07-31`,
        label:
          credit > due
            ? 'Refund in your July payslip'
            : 'Taken from your July payslip',
        amount: Math.abs(round(credit - due)),
        paidWith: 'payslip',
      });
    return {
      form: f.form,
      result: f.result,
      credit,
      due,
      nextAdvances: advances,
      creditLeft: Math.max(0, round(credit - due)),
      toPay: Math.max(0, round(due - credit)),
      steps,
    };
  }
  let left = credit;
  let toPay = 0;
  const take = (label: string, date: string, amount: number) => {
    if (amount <= 0) return;
    const covered = Math.min(left, amount);
    left = round(left - covered);
    if (covered > 0)
      steps.push({ date, label, amount: round(covered), paidWith: 'credit' });
    if (amount > covered) {
      toPay = round(toPay + amount - covered);
      steps.push({
        date,
        label,
        amount: round(amount - covered),
        paidWith: 'f24',
      });
    }
  };
  take('Balance of the year (saldo)', `${year}-06-30`, due);
  take('First advance for next year', `${year}-06-30`, f.nextAdvanceFirst);
  take('Second advance for next year', `${year}-11-30`, f.nextAdvanceSecond);
  return {
    form: f.form,
    result: f.result,
    credit,
    due,
    nextAdvances: advances,
    creditLeft: left,
    toPay,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Years side by side
// ---------------------------------------------------------------------------

export interface TrendYear {
  taxYear: number;
  source: FigureSource;
  formLabel: string;
  income: number | null;
  grossTax: number | null;
  netTax: number | null;
  creditsUsed: number | null;
  lost: number | null;
  withheld: number | null;
  /** Above zero to pay, below a credit: the filed result, or the forecast balance. */
  result: number | null;
  effectiveRate: number | null;
}

/** Every year with figures, oldest first. */
export function trendOf(years: readonly TaxYearDto[]): TrendYear[] {
  return [...years]
    .sort((a, b) => a.taxYear - b.taxYear)
    .flatMap((y) => {
      const picked = figuresOf(y.taxReturn);
      if (!picked) return [];
      const f = picked.figures;
      const credits = creditsUse(f);
      const net = f.netTax;
      return [
        {
          taxYear: y.taxYear,
          source: picked.source,
          formLabel: `${y.taxReturn.formLabel} ${y.taxReturn.filingYear}`,
          income: f.income,
          grossTax: f.grossTax,
          netTax: net,
          creditsUsed: credits?.used ?? null,
          lost: credits?.lost ?? null,
          withheld: f.irpefWithheld,
          result:
            picked.source === 'filed' && y.taxReturn.filed
              ? y.taxReturn.filed.result
              : f.balance,
          effectiveRate:
            net !== null && f.income
              ? round((net / f.income) * 10000) / 10000
              : null,
        },
      ];
    });
}

// ---------------------------------------------------------------------------

/** Whole euros, for sentences. */
export const euroText = (value: number) => euro(value, false);
export const pct = (rate: number) =>
  `${Math.round(rate * 1000) / 10}%`.replace('.0%', '%');
