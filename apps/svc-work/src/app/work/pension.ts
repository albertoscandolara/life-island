import {
  marginalBracket,
  pensionDeductionLimit,
  pensionExitTaxPct,
  pensionNoticeDeadline,
  pensionYearsMember,
  PENSION_FUND_SOURCES,
  PENSION_STATEMENT_KEYS,
  type DeadlineDto,
  type PendingPensionStatementDto,
  type PensionDocumentDto,
  type PensionFundDto,
  type PensionFundKind,
  type PensionFundStatus,
  type PensionOverviewDto,
  type PensionPaymentDto,
  type PensionPaymentKind,
  type PensionStatementDto,
  type PensionThisYearDto,
  type PensionYearDto,
  euroText,
} from '@life-island/contracts';
import { countedPayslips, type ApprovedWorkDocument } from './career.js';
import { normalizeName, numberOf, type Fields } from './work-documents.js';

/*
 * The pension fund, from what you have: the fund lines of your payslips
 * (yours, the employer's and the TFR sent to the fund), the payments you made
 * yourself, the CUs (what the employer deducted) and the fund's statements.
 * Year by year against the deduction limit, with what the 730 and the fund
 * need from you. Pure functions, unit-tested on their own.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PensionFundRowInput {
  id: string;
  name: string;
  kind: PensionFundKind;
  memberSince: string | null;
  investmentLine: string | null;
  employeePct: number | null;
  employerPct: number | null;
  tfrPct: number | null;
  firstJob: boolean;
  memberCode: string | null;
  url: string | null;
  notes: string | null;
  status: PensionFundStatus;
  createdAt: Date;
}

export interface PensionStatementRowInput {
  id: string;
  fundId: string;
  date: string;
  value: number;
  paidIn: number | null;
  employee: number | null;
  employer: number | null;
  tfr: number | null;
  returnPct: number | null;
  sourceUploadId: string | null;
  notes: string | null;
}

export interface PensionPaymentRowInput {
  id: string;
  fundId: string;
  date: string;
  amount: number;
  kind: PensionPaymentKind;
  note: string | null;
}

/** A document filed as a fund statement, as svc-work mirrors it. */
export interface StatementDocument {
  uploadId: string;
  title: string;
  fields: Fields | null;
  uploadedAt: Date;
}

export interface PensionInput {
  funds: readonly PensionFundRowInput[];
  statements: readonly PensionStatementRowInput[];
  payments: readonly PensionPaymentRowInput[];
  notices: readonly { year: number; sentAt: string }[];
  /** Approved work documents: the payslips and the CUs. */
  approved: readonly ApprovedWorkDocument[];
  /** Fund statement documents, and the ones you dismissed. */
  statementDocuments: readonly StatementDocument[];
  dismissed: ReadonlySet<string>;
  today: string;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

function dateOf(value: unknown): string | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function amountOf(value: unknown): number | null {
  const n = numberOf(value as string | number | null);
  return n === null ? null : round2(n);
}

/** What a fund statement document prints (see PENSION_STATEMENT_KEYS). */
export function readStatement(
  doc: StatementDocument,
): Omit<PendingPensionStatementDto, 'fundId' | 'missing'> {
  const f = doc.fields ?? {};
  const K = PENSION_STATEMENT_KEYS;
  const year = numberOf(f[K.year] as string | number | null);
  return {
    uploadId: doc.uploadId,
    title: doc.title,
    fundName: text(f[K.fundName]),
    date:
      dateOf(f[K.statementDate]) ??
      (year !== null && year >= 1990 && year <= 2100
        ? `${Math.round(year)}-12-31`
        : null),
    value: amountOf(f[K.value]),
    paidIn: amountOf(f[K.paidIn]),
    employee: amountOf(f[K.employee]),
    employer: amountOf(f[K.employer]),
    tfr: amountOf(f[K.tfr]),
    investmentLine: text(f[K.investmentLine]),
    memberSince: dateOf(f[K.memberSince]),
    returnPct: amountOf(f[K.returnPct]),
  };
}

/** The fund a name is about: same name, or one name inside the other ("Cometa" in "Fondo Cometa"). */
export function matchFund<T extends { id: string; name: string }>(
  name: string | null,
  funds: readonly T[],
): T | null {
  const wanted = normalizeName(name)
    ?.replace(/\bFONDO( PENSIONE)?\b/g, '')
    .trim();
  if (!wanted) return funds.length === 1 ? funds[0] : null;
  const clean = (n: string) =>
    normalizeName(n)
      ?.replace(/\bFONDO( PENSIONE)?\b/g, '')
      .trim() ?? '';
  return (
    funds.find((f) => clean(f.name) === wanted) ??
    funds.find((f) => {
      const c = clean(f.name);
      return c !== '' && (c.includes(wanted) || wanted.includes(c));
    }) ??
    null
  );
}

interface YearAcc {
  payslips: number;
  employee: number;
  employer: number;
  tfr: number;
  direct: number;
  family: number;
  taxable: number;
  taxableMonths: number;
  /** Regular payslips with a fund line, for the projection. */
  months: Set<string>;
  cuDeducted: number | null;
  cuNotDeducted: number | null;
  cuIncome: number | null;
}

const emptyYear = (): YearAcc => ({
  payslips: 0,
  employee: 0,
  employer: 0,
  tfr: 0,
  direct: 0,
  family: 0,
  taxable: 0,
  taxableMonths: 0,
  months: new Set(),
  cuDeducted: null,
  cuNotDeducted: null,
  cuIncome: null,
});

const add = (a: number | null, b: number | null) =>
  a === null && b === null ? null : round2((a ?? 0) + (b ?? 0));

/** Payslip fund lines in a year (employee + employer), projected to December. */
function projection(acc: YearAcc): number {
  const counted = acc.employee + acc.employer + acc.direct + acc.family;
  const months = acc.months.size;
  if (!months) return round2(counted);
  const perMonth = (acc.employee + acc.employer) / months;
  const left = Math.max(0, 12 - months);
  return round2(counted + perMonth * left);
}

export function buildPension(input: PensionInput): PensionOverviewDto {
  const thisYear = +input.today.slice(0, 4);
  const fundName = new Map(input.funds.map((f) => [f.id, f.name]));
  const years = new Map<number, YearAcc>();
  const yearOf = (year: number) => {
    let acc = years.get(year);
    if (!acc) years.set(year, (acc = emptyYear()));
    return acc;
  };

  // Payslips: each counted once, every workplace (the fund follows you).
  const payslips = countedPayslips(input.approved).filter(
    (d) => d.reading.type === 'PAYSLIP' && d.reading.period,
  );
  let onPayslips = false;
  for (const p of payslips) {
    const r = p.reading;
    const year = +r.period!.slice(0, 4);
    const employee = r.pensionFundEmployee ?? 0;
    const employer = r.pensionFundEmployer ?? 0;
    const tfr = r.tfrToFund ?? 0;
    if (r.taxable !== null) {
      const acc = yearOf(year);
      acc.taxable += r.taxable;
      acc.taxableMonths++;
    }
    if (employee <= 0 && employer <= 0 && tfr <= 0) continue;
    onPayslips = true;
    const acc = yearOf(year);
    acc.payslips++;
    acc.employee += employee;
    acc.employer += employer;
    acc.tfr += tfr;
    if ((r.payslipKind ?? 'regular') === 'regular') acc.months.add(r.period!);
  }

  // Your own payments.
  for (const p of input.payments) {
    const acc = yearOf(+p.date.slice(0, 4));
    if (p.kind === 'family') acc.family += p.amount;
    else acc.direct += p.amount;
  }

  // The CUs: what the employer deducted, and your income for the bracket.
  const certificates: PensionDocumentDto[] = [];
  const seenCu = new Set<string>();
  for (const d of input.approved) {
    const cu = d.reading.certificate;
    if (d.reading.type !== 'CERTIFICAZIONE_UNICA' || !cu?.year) continue;
    const key = `${d.workplaceId}|${cu.year}`;
    if (seenCu.has(key)) continue;
    seenCu.add(key);
    const hasFund =
      cu.pensionFundDeducted !== null || cu.pensionFundNotDeducted !== null;
    const acc = hasFund || years.has(cu.year) ? yearOf(cu.year) : null;
    if (!acc) continue;
    acc.cuIncome = add(acc.cuIncome, cu.income);
    if (!hasFund) continue;
    acc.cuDeducted = add(acc.cuDeducted, cu.pensionFundDeducted);
    acc.cuNotDeducted = add(acc.cuNotDeducted, cu.pensionFundNotDeducted);
    certificates.push({
      uploadId: d.uploadId,
      title: d.title,
      kind: 'certificate',
      date: d.reading.date,
      summary: `CU ${cu.year}: ${euroText(cu.pensionFundDeducted ?? 0)} deducted by the employer (punto 412)${cu.pensionFundNotDeducted ? `, ${euroText(cu.pensionFundNotDeducted)} not (punto 413)` : ''}`,
    });
  }

  if (input.funds.some((f) => f.status === 'active')) yearOf(thisYear);

  const notices = new Map(input.notices.map((n) => [n.year, n.sentAt]));
  const yearDtos: PensionYearDto[] = [...years.entries()]
    .filter(
      ([year, acc]) =>
        year === thisYear ||
        acc.payslips ||
        acc.direct ||
        acc.family ||
        acc.cuDeducted !== null ||
        acc.cuNotDeducted !== null,
    )
    .sort(([a], [b]) => b - a)
    .map(([year, acc]) => {
      const counted = round2(
        acc.employee + acc.employer + acc.direct + acc.family,
      );
      const limit = pensionDeductionLimit(year);
      const running = year >= thisYear;
      const projected = running ? projection(acc) : null;
      const basis = projected ?? counted;
      // The CU is what the employer declared: when it is there, it wins.
      const cuTotal =
        acc.cuDeducted !== null || acc.cuNotDeducted !== null
          ? round2((acc.cuDeducted ?? 0) + (acc.cuNotDeducted ?? 0))
          : null;
      const declared =
        cuTotal !== null ? round2(cuTotal + acc.direct + acc.family) : basis;
      const over = round2(Math.max(0, declared - limit));
      const room = round2(Math.max(0, limit - declared));
      // The year's taxable income: the CU's, else the payslips' (a part year scaled to twelve months).
      const taxable =
        acc.cuIncome ??
        (acc.taxableMonths >= 12
          ? acc.taxable
          : acc.taxableMonths >= 1
            ? (acc.taxable / acc.taxableMonths) * 12
            : null);
      const bracket = taxable ? marginalBracket(taxable, year) : null;
      const deductible = Math.min(declared, limit);
      const e27Deducted = acc.cuDeducted ?? round2(acc.employee + acc.employer);
      return {
        year,
        payslips: acc.payslips,
        employee: round2(acc.employee),
        employer: round2(acc.employer),
        tfr: round2(acc.tfr),
        direct: round2(acc.direct),
        family: round2(acc.family),
        counted,
        limit,
        room,
        over,
        cuDeducted: acc.cuDeducted,
        cuNotDeducted: acc.cuNotDeducted,
        running,
        projected,
        marginalRatePct: bracket?.ratePct ?? null,
        taxSaved: bracket ? round2((deductible * bracket.ratePct) / 100) : null,
        e27Deducted,
        e27NotDeducted: round2(
          (acc.cuNotDeducted ?? 0) + acc.direct + acc.family,
        ),
        noticeDue: over > 0 ? pensionNoticeDeadline(year) : null,
        noticeSentAt: notices.get(year) ?? null,
      };
    });

  const current = yearDtos.find((y) => y.year === thisYear) ?? null;
  const thisYearDto: PensionThisYearDto | null =
    current && input.funds.some((f) => f.status === 'active')
      ? {
          year: thisYear,
          counted: current.counted,
          projected: current.projected ?? current.counted,
          limit: current.limit,
          room: current.room,
          marginalRatePct: current.marginalRatePct,
          saving:
            current.marginalRatePct !== null
              ? round2((current.room * current.marginalRatePct) / 100)
              : null,
          deadline: `${thisYear}-12-31`,
        }
      : null;

  // Statements, newest first, and each fund's latest.
  const statements: PensionStatementDto[] = [...input.statements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((s) => ({
      id: s.id,
      fundId: s.fundId,
      fundName: fundName.get(s.fundId) ?? '',
      date: s.date,
      value: s.value,
      paidIn: s.paidIn,
      employee: s.employee,
      employer: s.employer,
      tfr: s.tfr,
      returnPct: s.returnPct,
      sourceUploadId: s.sourceUploadId,
      notes: s.notes,
      gain: s.paidIn !== null ? round2(s.value - s.paidIn) : null,
    }));

  // Payslip lines go to the fund when you have only one active.
  const active = input.funds.filter((f) => f.status === 'active');
  const payslipFund = active.length === 1 ? active[0].id : null;
  const payslipTotal = round2(
    [...years.values()].reduce(
      (s, y) => s + y.employee + y.employer + y.tfr,
      0,
    ),
  );
  const funds: PensionFundDto[] = input.funds
    .map((f) => {
      const latest = statements.find((s) => s.fundId === f.id) ?? null;
      const yearsMember = pensionYearsMember(f.memberSince, input.today);
      const ownPayments = round2(
        input.payments
          .filter((p) => p.fundId === f.id)
          .reduce((s, p) => s + p.amount, 0),
      );
      const recorded = round2(
        ownPayments + (payslipFund === f.id ? payslipTotal : 0),
      );
      const paidIn = latest?.paidIn ?? (recorded > 0 ? recorded : null);
      const gain =
        latest && paidIn !== null ? round2(latest.value - paidIn) : null;
      return {
        id: f.id,
        name: f.name,
        kind: f.kind,
        memberSince: f.memberSince,
        investmentLine: f.investmentLine,
        employeePct: f.employeePct,
        employerPct: f.employerPct,
        tfrPct: f.tfrPct,
        firstJob: f.firstJob,
        memberCode: f.memberCode,
        url: f.url,
        notes: f.notes,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        yearsMember,
        exitTaxPct: pensionExitTaxPct(yearsMember),
        value: latest?.value ?? null,
        valueDate: latest?.date ?? null,
        paidIn,
        paidInSource:
          latest?.paidIn != null
            ? 'statement'
            : paidIn !== null
              ? 'records'
              : null,
        gain,
        gainPct: gain !== null && paidIn ? round2((gain / paidIn) * 100) : null,
      } satisfies PensionFundDto;
    })
    .sort(
      (a, b) =>
        Number(a.status !== 'active') - Number(b.status !== 'active') ||
        a.name.localeCompare(b.name),
    );

  const payments: PensionPaymentDto[] = [...input.payments]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({
      id: p.id,
      fundId: p.fundId,
      fundName: fundName.get(p.fundId) ?? '',
      date: p.date,
      amount: p.amount,
      kind: p.kind,
      note: p.note,
    }));

  // Statement documents: confirmed ones are documents, the rest wait for you.
  const used = new Set(
    input.statements.map((s) => s.sourceUploadId).filter(Boolean),
  );
  const documents: PensionDocumentDto[] = [];
  const pending: PendingPensionStatementDto[] = [];
  for (const doc of input.statementDocuments) {
    const read = readStatement(doc);
    if (used.has(doc.uploadId)) {
      documents.push({
        uploadId: doc.uploadId,
        title: doc.title,
        kind: 'statement',
        date: read.date,
        summary: `Statement${read.fundName ? ` of ${read.fundName}` : ''}${read.value !== null ? `: ${euroText(read.value)}` : ''}`,
      });
      continue;
    }
    if (input.dismissed.has(doc.uploadId)) continue;
    const missing: string[] = [];
    if (!read.date) missing.push('the date');
    if (read.value === null) missing.push('the value of your position');
    pending.push({
      ...read,
      fundId: matchFund(read.fundName, input.funds)?.id ?? null,
      missing,
    });
  }
  documents.push(...certificates);
  // The newest payslip of each year with a fund line.
  const byYear = new Map<number, ApprovedWorkDocument>();
  for (const p of payslips) {
    const r = p.reading;
    if (!(r.pensionFundEmployee || r.pensionFundEmployer || r.tfrToFund))
      continue;
    const year = +r.period!.slice(0, 4);
    const kept = byYear.get(year);
    if (!kept || kept.reading.period! < r.period!) byYear.set(year, p);
  }
  for (const [year, p] of byYear) {
    const acc = years.get(year)!;
    documents.push({
      uploadId: p.uploadId,
      title: p.title,
      kind: 'payslip',
      date: p.reading.date,
      summary: `Latest of ${acc.payslips} payslip${acc.payslips === 1 ? '' : 's'} of ${year} with a fund line: ${euroText(round2(acc.employee + acc.employer + acc.tfr))} into the fund that year`,
    });
  }
  documents.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const values = funds.filter((f) => f.value !== null);
  return {
    funds,
    statements,
    payments,
    years: yearDtos,
    thisYear: thisYearDto,
    pending,
    documents,
    onPayslips,
    totalPaidIn: round2(funds.reduce((s, f) => s + (f.paidIn ?? 0), 0)),
    totalValue: values.length
      ? round2(values.reduce((s, f) => s + (f.value ?? 0), 0))
      : null,
    limit: pensionDeductionLimit(thisYear),
    sources: PENSION_FUND_SOURCES,
  };
}

/**
 * The pension fund's dates for the Agenda: the last day to top up for this
 * year's deduction, and the notice of what you did not deduct.
 */
export function pensionDeadlines(
  pension: PensionOverviewDto,
  window: { from: string; to: string },
): DeadlineDto[] {
  const out: DeadlineDto[] = [];
  const t = pension.thisYear;
  if (t && t.room >= 50)
    out.push({
      id: `pension-topup-${t.year}`,
      module: 'work',
      kind: 'pension_topup',
      title: 'Pension fund: last day to use this year’s deduction',
      detail: `About ${euroText(t.room)} of the ${euroText(t.limit)} limit is still free${t.saving !== null ? `: a transfer to your fund would save about ${euroText(t.saving)} of IRPEF` : ''}.`,
      date: t.deadline,
      amount: t.room,
      path: '/work?tab=pension#work-pension',
    });
  for (const y of pension.years)
    if (y.noticeDue && !y.noticeSentAt && !y.running)
      out.push({
        id: `pension-notice-${y.year}`,
        module: 'work',
        kind: 'pension_notice',
        title: `Pension fund: tell the fund what you did not deduct in ${y.year}`,
        detail: `${euroText(y.over)} was over the limit: send the fund the "comunicazione dei contributi non dedotti", or it is taxed again when you retire.`,
        date: y.noticeDue,
        amount: y.over,
        path: '/work?tab=pension#work-pension',
      });
  return out.filter((d) => d.date >= window.from && d.date <= window.to);
}

// As the Work pages write amounts: 2.673,10 € (grouping forced, plain spaces).
