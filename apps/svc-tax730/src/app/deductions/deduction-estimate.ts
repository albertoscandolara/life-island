import {
  tax730DeductionRules,
  type Tax730CarriedInstalmentDto,
  type Tax730DeductionLineDto,
  type Tax730DeductionRule,
  type Tax730DeductionsDto,
} from '@life-island/contracts';

/** What the estimate needs of an expense. */
export interface EstimatedExpense {
  taxYear: number;
  expenseType: string;
  amount: number;
  traceablePayment: boolean | null;
  beneficiaryFiscalCode: string | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Cash where the rule wants a traceable payment: it does not count. */
function isExcluded(rule: Tax730DeductionRule, expense: EstimatedExpense) {
  if (expense.traceablePayment !== false) return false;
  if (rule.traceable === 'required') return true;
  // Health: only visits and treatments need a card or a transfer.
  return rule.traceable === 'partly' && expense.expenseType === 'medical';
}

function line(
  rule: Tax730DeductionRule,
  items: EstimatedExpense[],
): Tax730DeductionLineDto {
  const spent = round(items.reduce((sum, e) => sum + e.amount, 0));
  const counted = items.filter((e) => !isExcluded(rule, e));
  const excluded = round(spent - counted.reduce((sum, e) => sum + e.amount, 0));
  const countedTotal = round(spent - excluded);

  let capped = countedTotal;
  let effectiveCap = rule.cap;
  let people: number | null = null;
  if (rule.cap !== null && rule.capScope === 'person') {
    // Each person (by codice fiscale) has a cap of their own.
    const byPerson = new Map<string, number>();
    for (const e of counted) {
      const who = e.beneficiaryFiscalCode?.trim().toUpperCase() || '?';
      byPerson.set(who, (byPerson.get(who) ?? 0) + e.amount);
    }
    people = Math.max(1, byPerson.size);
    effectiveCap = rule.cap * people;
    capped = round(
      [...byPerson.values()].reduce(
        (sum, total) => sum + Math.min(total, rule.cap as number),
        0,
      ),
    );
  } else if (rule.cap !== null) {
    capped = Math.min(countedTotal, rule.cap);
  }
  const eligible = round(Math.max(0, capped - (rule.franchigia ?? 0)));
  const totalDeduction = round(eligible * (rule.rate ?? 0));
  return {
    group: rule.group,
    label: rule.label.en,
    labelIt: rule.label.it,
    row730: rule.row730,
    rate: rule.rate,
    reducedRate: rule.reducedRate,
    cap: rule.cap,
    capScope: rule.capScope,
    franchigia: rule.franchigia,
    instalments: rule.instalments,
    spent,
    expenseCount: items.length,
    excluded,
    eligible,
    overCap: round(countedTotal - capped),
    capUsage: effectiveCap ? countedTotal / effectiveCap : null,
    effectiveCap,
    people,
    totalDeduction,
    deduction: round(totalDeduction / rule.instalments),
    notes: rule.notes,
  };
}

/** One line per kind of expense spent in `taxYear`, biggest deduction first. */
export function deductionLines(
  taxYear: number,
  expenses: EstimatedExpense[],
): Tax730DeductionLineDto[] {
  const ofYear = expenses.filter((e) => e.taxYear === taxYear);
  return tax730DeductionRules(taxYear)
    .map((rule) => ({
      rule,
      items: ofYear.filter((e) =>
        (rule.types as string[]).includes(e.expenseType),
      ),
    }))
    .filter(({ items }) => items.length)
    .map(({ rule, items }) => line(rule, items))
    .sort((a, b) => b.deduction - a.deduction || b.spent - a.spent);
}

/**
 * What the expenses of `taxYear` are worth in its 730, plus the instalments
 * that home bonuses of the nine years before still bring. `expenses` may hold
 * every year: the earlier ones are only read for those instalments.
 */
export function estimateDeductions(
  taxYear: number,
  expenses: EstimatedExpense[],
): Tax730DeductionsDto {
  const lines = deductionLines(taxYear, expenses);
  const carried: Tax730CarriedInstalmentDto[] = [];
  for (let fromYear = taxYear - 9; fromYear < taxYear; fromYear++) {
    for (const earlier of deductionLines(fromYear, expenses)) {
      const instalment = taxYear - fromYear + 1;
      if (earlier.instalments < instalment || !earlier.deduction) continue;
      carried.push({
        fromYear,
        group: earlier.group,
        label: earlier.label,
        labelIt: earlier.labelIt,
        instalment,
        of: earlier.instalments,
        amount: earlier.deduction,
      });
    }
  }
  carried.sort((a, b) => b.fromYear - a.fromYear || b.amount - a.amount);
  return {
    lines,
    carried,
    thisYear: round(
      lines.reduce((sum, l) => sum + l.deduction, 0) +
        carried.reduce((sum, c) => sum + c.amount, 0),
    ),
    futureYears: round(
      lines.reduce((sum, l) => sum + l.totalDeduction - l.deduction, 0),
    ),
  };
}
