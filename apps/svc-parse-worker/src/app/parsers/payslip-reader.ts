/*
 * The offline parser's reading of an Italian payslip (LUL, sezione
 * retributiva): the boxes the Work area needs, found from their printed
 * headers in the text layer. Each value sits on the first line under its
 * header that holds one; anything not found stays null for you to fill in.
 */

const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2,5}/g;

/** "2.378,20" as 2378.2; an amount with five decimals (2.313,34000) is rounded to cents. */
export function italianAmount(raw: string): number {
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Math.round(n * 100) / 100;
}

function moneyIn(line: string): number[] {
  return (line.match(MONEY) ?? []).map(italianAmount);
}

/** Indexes of the lines that contain `header` (case-insensitive). */
function headerLines(lines: string[], header: RegExp): number[] {
  return lines.flatMap((line, index) => (header.test(line) ? [index] : []));
}

/** The first of the next `within` lines that `pick` reads a value from. */
function below<T>(
  lines: string[],
  at: number,
  pick: (line: string) => T | null,
  within = 4,
): T | null {
  for (let i = at + 1; i <= at + within && i < lines.length; i++) {
    const value = pick(lines[i]);
    if (value !== null) return value;
  }
  return null;
}

/** d/mm/yyyy as YYYY-MM-DD. */
function isoOf(day: string, month: string, year: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export interface PayslipReading {
  employer_tax_code: string | null;
  employee_code: string | null;
  hire_date: string | null;
  job_level: string | null;
  monthly_salary: number | null;
  gross_pay: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  welfare_credits: number | null;
}

/**
 * A credit line that pays no cash: welfare conversion (art. 51 or art. 100),
 * welfare from the contract (CCNL), flexible benefits, meal vouchers.
 */
const WELFARE_LINE =
  /\bwelfare\b|\bconvers\w*\.?\s+benefit|flexible\s+benefit|buoni\s+pasto|ticket\s+restaurant/i;
/** Lines that name welfare but are not a credit of the month. */
const NOT_A_CREDIT =
  /trattenut|recuper|imponibil|progressiv|totale|residuo|maturat/i;

/**
 * The welfare credited this month: the sum of the last amount on each welfare
 * line ("333 Welfare convers. benefit art.100 (no netto) 888,56"). A year on
 * the line (2026) has no decimals and is not taken for an amount.
 */
export function readWelfareCredits(text: string): number | null {
  const seen = new Set<string>();
  let sum = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!WELFARE_LINE.test(line) || NOT_A_CREDIT.test(line)) continue;
    // A payslip of several pages can repeat a line; count it once.
    if (seen.has(line)) continue;
    seen.add(line);
    const amount = moneyIn(line).at(-1);
    if (amount && amount > 0) sum += amount;
  }
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

export function readPayslipText(text: string): PayslipReading {
  const lines = text.split('\n').map((line) => line.trim());

  const taxCode =
    /\b(?:C\.F\.|P\.IVA)\s*:?\s*(\d{11})\b/i.exec(text)?.[1] ?? null;

  const codeAt = headerLines(lines, /\bCOD\.\s?DIP\b/i)[0];
  const employeeCode =
    codeAt === undefined
      ? null
      : below(lines, codeAt, (line) => /^(\d{2,10})\b/.exec(line)?.[1] ?? null);

  const hiredAt = headerLines(lines, /\bASSUNZIONE\b/i)[0];
  const hireDate =
    hiredAt === undefined
      ? null
      : below(lines, hiredAt, (line) => {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(line);
          return m ? isoOf(m[1], m[2], m[3]) : null;
        });

  const levelAt = headerLines(lines, /\bLIVELLO\b/i)[0];
  const level =
    levelAt === undefined
      ? null
      : below(
          lines,
          levelAt,
          (line) =>
            /(?:^|\s)([A-Z]{1,2}\d{1,2}|\d[A-Z]?|Q[A-Z]?)$/.exec(line)?.[1] ??
            null,
        );

  const salaryAt = headerLines(lines, /RETRIBUZIONE MENSILE/i)[0];
  const monthly =
    salaryAt === undefined
      ? null
      : below(lines, salaryAt, (line) => moneyIn(line).at(-1) ?? null, 2);

  // A payslip of several pages repeats the header; the totals are on the last.
  let totals: number[] | null = null;
  for (const at of headerLines(lines, /NETTO IN BUSTA/i).reverse()) {
    totals = below(
      lines,
      at,
      (line) => {
        const amounts = moneyIn(line);
        return amounts.length >= 3 ? amounts.slice(-3) : null;
      },
      8,
    );
    if (totals) break;
  }

  return {
    employer_tax_code: taxCode,
    employee_code: employeeCode,
    hire_date: hireDate,
    job_level: level,
    monthly_salary: monthly,
    gross_pay: totals?.[0] ?? null,
    total_deductions: totals?.[1] ?? null,
    net_pay: totals?.[2] ?? null,
    welfare_credits: readWelfareCredits(text),
  };
}
