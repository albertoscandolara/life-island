import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  deadlineWindow,
  isoAddDays,
  isoToday,
  PAYSLIP_KEYS,
  TAX730_ATTACHMENT_ROLES,
  TAX_CERTIFICATE_KEYS,
  TAX_RETURN_CATEGORY,
  type DeadlineDto,
  type LifeAttentionDto,
  type DeadlinesQuery,
  type Tax730FiledReturnDto,
  type AddAttachmentRequest,
  type DossierExpenseDto,
  type ExpenseDto,
  type listTax730DocumentsQuerySchema,
  type Tax730AttachmentDto,
  type Tax730AttachmentRole,
  type Tax730DocumentCandidateDto,
  type Tax730DocumentDto,
  type Tax730PairingDecision,
  type SetExpensePairingRequest,
  type SharedPaymentExpenseDto,
  type TaxYearDossierDto,
  type TaxYearDto,
  type UpdateExpenseChanges,
  bankPaymentOf,
  type PayableDto,
  type PayablesQuery,
} from '@life-island/contracts';
import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  attachments,
  documents,
  expenses,
  payments,
  type PaymentRow,
  taxYears,
  type AttachmentRow,
  type DocumentRow,
  type ExpenseRow,
} from '../db/schema.js';
import {
  estimateDeductions,
  type EstimatedExpense,
} from '../deductions/deduction-estimate.js';
import {
  CERTIFICATE_CATEGORY,
  certificatesOf,
  type CertificateSource,
} from '../deductions/income.js';
import {
  deadlinesOf,
  forecastOf,
  PAYSLIP_CATEGORY,
  payslipsOf,
  returnsOf,
  taxReturnOf,
} from '../deductions/returns.js';
import { documentAmount, toDocumentDto } from '../documents/document-view.js';
import { sharePayments } from '../expenses/shared-payments.js';
import { scorePaymentCandidate } from '../documents/payment-candidates.js';
import { toExpenseDto } from '../expenses/expense-dto.js';
import { expenseIdOfPayable, expensePayables } from '../expenses/payables.js';
import {
  expenseKind,
  isBankIssuer,
  pairExpenses,
  type PairableExpense,
  type PairingDecision,
} from '../expenses/expense-pairing.js';

type ListDocuments = z.output<typeof listTax730DocumentsQuerySchema>;

/** Today in Italy, where the deadlines are. */
export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const round = (value: number) => Math.round(value * 100) / 100;

/** The words of a search, without the separators of file names: "a - b.pdf" → [a, b, pdf]. */
export function searchWords(search: string | undefined): string[] {
  return (search ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12);
}

/** What pairing reads of an expense: its numbers and what its document says. */
function pairableOf(
  row: ExpenseRow,
  documentsById: Map<string, DocumentRow>,
): PairableExpense {
  const source = documentsById.get(row.uploadId);
  return {
    id: row.id,
    taxYear: row.taxYear,
    date: row.date,
    amount: row.amount,
    issuer: row.issuer,
    text: [row.documentNumber, source?.title, source?.originalFilename]
      .filter(Boolean)
      .join(' '),
    details: [row.description, source?.description].filter(Boolean).join(' '),
    pairedWith: row.pairedWith,
    pairing: row.pairing as PairingDecision | null,
    paysToo: row.paysToo,
  };
}
/** Keys a document's issuer is read under, in order of preference. */
const ISSUER_KEYS = [
  'issuer',
  'supplier_name',
  'provider',
  'merchant_name',
] as const;

/** Who issued a document, as its fields say; null when they don't. */
export function documentIssuer(
  document: Pick<DocumentRow, 'fields'> | undefined,
): string | null {
  for (const key of ISSUER_KEYS) {
    const value = document?.fields?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Who was paid. A transfer receipt is issued by the bank: the supplier is the
 * first other name that is not a bank's (the invoice it pays, an expense of
 * its group, a document filed with it as invoice).
 */
export function supplierOf(
  issuer: string,
  others: (string | null | undefined)[],
): string {
  if (!isBankIssuer(issuer)) return issuer;
  return (
    others.find((other): other is string => !!other && !isBankIssuer(other)) ??
    issuer
  );
}

const ROLE_ORDER = new Map(TAX730_ATTACHMENT_ROLES.map((role, i) => [role, i]));

function byRole(a: Tax730AttachmentDto, b: Tax730AttachmentDto): number {
  return (ROLE_ORDER.get(a.role) ?? 9) - (ROLE_ORDER.get(b.role) ?? 9);
}

@Injectable()
export class DossierService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  /** Totals per tax year, newest year first. */
  async taxYears(): Promise<TaxYearDto[]> {
    const dossiers = await this.dossiers();
    return dossiers.map((dossier) => {
      const year: TaxYearDto & Partial<TaxYearDossierDto> = { ...dossier };
      delete year.expenses;
      delete year.yearDocuments;
      return year;
    });
  }

  /** One year's expenses with their documents, oldest expense first. */
  async dossier(taxYear: number): Promise<TaxYearDossierDto> {
    const [dossier] = await this.dossiers([taxYear]);
    return dossier ?? this.summarize(taxYear, [], [], []);
  }

  /** The dossiers of the given years (all years when empty), newest first. */
  /** The expenses to pay, for Money matching (`GET /payables`). */
  async payables(query: PayablesQuery): Promise<PayableDto[]> {
    return expensePayables(
      (await this.dossiers()).flatMap((year) => year.expenses),
      query,
    );
  }

  async dossiers(years: number[] = []): Promise<TaxYearDossierDto[]> {
    const db = this.svc.db;
    const [expenseRows, attachmentRows, certificateRows, paymentRows] =
      await Promise.all([
        // Every year: pairing needs them all, and home bonuses of earlier
        // years still bring instalments.
        db
          .select()
          .from(expenses)
          .orderBy(asc(expenses.date), asc(expenses.createdAt)),
        db
          .select()
          .from(attachments)
          .where(years.length ? inArray(attachments.taxYear, years) : undefined)
          .orderBy(asc(attachments.createdAt)),
        // Your Certificazioni Uniche, returns and payslips: the income and
        // tax of each year, filed or forecast.
        db
          .select({
            uploadId: documents.uploadId,
            title: documents.title,
            categories: documents.categories,
            fields: documents.fields,
            uploadedAt: documents.uploadedAt,
          })
          .from(documents)
          .where(
            and(
              isNull(documents.deletedAt),
              arrayOverlaps(documents.categories, [
                CERTIFICATE_CATEGORY,
                TAX_RETURN_CATEGORY,
                PAYSLIP_CATEGORY,
              ]),
            ),
          ),
        // The bank payments matched in Money, still linked.
        db.select().from(payments).where(isNull(payments.unlinkedAt)),
      ]);
    const paymentsByExpense = new Map<string, PaymentRow[]>();
    for (const payment of paymentRows) {
      const id = expenseIdOfPayable(payment.payableKey);
      if (id)
        paymentsByExpense.set(id, [
          ...(paymentsByExpense.get(id) ?? []),
          payment,
        ]);
    }
    /** An expense's matched payments, with those of the expenses paired with it. */
    const bankPaymentOfGroup = (row: ExpenseRow, group: ExpenseRow[]) =>
      bankPaymentOf(
        row.amount,
        [row, ...group].flatMap((e) => paymentsByExpense.get(e.id) ?? []),
      );
    const documentsById = await this.documentsById([
      ...expenseRows.map((row) => row.uploadId),
      ...attachmentRows.map((row) => row.uploadId),
      ...certificateRows
        .filter((row) => !row.categories.includes(PAYSLIP_CATEGORY))
        .map((row) => row.uploadId),
    ]);
    const returns = returnsOf(certificateRows);
    const attachmentDto = (row: AttachmentRow): Tax730AttachmentDto => {
      const document = documentsById.get(row.uploadId);
      return {
        uploadId: row.uploadId,
        role: row.role as Tax730AttachmentRole,
        document: document ? toDocumentDto(document) : null,
      };
    };

    const byExpense = new Map<string, Tax730AttachmentDto[]>();
    const byYear = new Map<number, Tax730AttachmentDto[]>();
    const chosen = new Set(
      attachmentRows
        .filter((row) => row.chosen && row.expenseId)
        .map((row) => `${row.expenseId}:${row.uploadId}`),
    );
    for (const row of attachmentRows) {
      if (row.expenseId) {
        const list = byExpense.get(row.expenseId) ?? [];
        list.push(attachmentDto(row));
        byExpense.set(row.expenseId, list);
      } else {
        const list = byYear.get(row.taxYear) ?? [];
        list.push(attachmentDto(row));
        byYear.set(row.taxYear, list);
      }
    }

    // One document, one expense: pair the invoices with their payments.
    const pairables = expenseRows.map((row) => pairableOf(row, documentsById));
    const kinds = new Map(pairables.map((e) => [e.id, expenseKind(e)]));
    const pairs = pairExpenses(pairables);
    const members = new Map<string, ExpenseRow[]>();
    for (const row of expenseRows) {
      const pair = pairs.get(row.id);
      if (!pair) continue;
      // One transfer for several invoices: it is shown with each of them.
      for (const primaryId of [pair.primaryId, ...pair.alsoPays]) {
        if (primaryId !== pair.primaryId && pairs.has(primaryId)) continue;
        members.set(primaryId, [...(members.get(primaryId) ?? []), row]);
      }
    }
    const rowsById = new Map(expenseRows.map((row) => [row.id, row]));
    const kindOf = (row: ExpenseRow) => kinds.get(row.id) ?? 'INVOICE';
    // The document an expense was read from is its invoice, or its payment
    // proof when it was read from a transfer receipt; a role you chose wins.
    const filesOf = (row: ExpenseRow) =>
      (byExpense.get(row.id) ?? []).map((file) =>
        file.uploadId === row.uploadId &&
        file.role === 'INVOICE' &&
        kindOf(row) === 'PAYMENT' &&
        !chosen.has(`${row.id}:${file.uploadId}`)
          ? { ...file, role: 'PAYMENT' as const }
          : file,
      );
    const descriptionOf = (row: ExpenseRow) => {
      const source = documentsById.get(row.uploadId);
      return (
        row.description ?? (source && !source.deletedAt ? source.title : null)
      );
    };
    const sharedDto = (id: string): SharedPaymentExpenseDto[] => {
      const row = rowsById.get(id);
      return row
        ? [
            {
              id: row.id,
              date: row.date,
              amount: row.amount,
              issuer: row.issuer,
              description: descriptionOf(row),
            },
          ]
        : [];
    };
    /** The other invoices a payment paid, seen from one of them. */
    const paysTooOf = (paymentId: string, seenFrom: string) => {
      const pair = pairs.get(paymentId);
      if (!pair?.alsoPays.length) return [];
      return [pair.primaryId, ...pair.alsoPays]
        .filter((id) => id !== seenFrom)
        .flatMap(sharedDto);
    };
    // A payment receipt, or a bank movement matched in Money, proves it was
    // paid traceably; otherwise what was read (or you said) stands.
    const traceable = (row: ExpenseRow, group: ExpenseRow[]) =>
      [row, ...group].some((e) => kindOf(e) === 'PAYMENT') ||
      bankPaymentOfGroup(row, group) !== null
        ? true
        : row.traceablePayment;

    // The issuer of each document read as an expense, as you approved it.
    const issuerByUpload = new Map(
      expenseRows
        .filter((row) => !isBankIssuer(row.issuer))
        .map((row) => [row.uploadId, row.issuer]),
    );
    const primaries = expenseRows.filter((row) => !pairs.has(row.id));
    const estimated: EstimatedExpense[] = primaries.map((row) => ({
      taxYear: row.taxYear,
      expenseType: row.expenseType,
      amount: row.amount,
      traceablePayment: traceable(row, members.get(row.id) ?? []),
      beneficiaryFiscalCode: row.beneficiaryFiscalCode,
    }));

    const expensesByYear = new Map<number, DossierExpenseDto[]>();
    for (const row of primaries) {
      if (years.length && !years.includes(row.taxYear)) continue;
      const group = members.get(row.id) ?? [];
      const seen = new Set<string>();
      const files = [row, ...group]
        .flatMap(filesOf)
        .filter((file) => !seen.has(file.uploadId) && seen.add(file.uploadId))
        .sort(byRole);
      const invoiceUploads = files
        .filter((file) => file.role === 'INVOICE')
        .map((file) => file.uploadId);
      const dto: DossierExpenseDto = {
        ...toExpenseDto(row),
        issuer: supplierOf(row.issuer, [
          ...group.map((member) => member.issuer),
          ...invoiceUploads.flatMap((id) => [
            issuerByUpload.get(id),
            documentIssuer(documentsById.get(id)),
          ]),
        ]),
        traceablePayment: traceable(row, group),
        // Until you write one, the invoice's title says what it was for.
        description: descriptionOf(row),
        attachments: files,
        hasInvoice: files.some((file) => file.role === 'INVOICE'),
        hasPaymentProof: files.some((file) => file.role === 'PAYMENT'),
        kind: kindOf(row),
        pairing: row.pairing as Tax730PairingDecision | null,
        paired: group.map((member) => ({
          id: member.id,
          date: member.date,
          amount: member.amount,
          issuer: member.issuer,
          description: descriptionOf(member),
          kind: kindOf(member),
          automatic: pairs.get(member.id)?.automatic ?? true,
          paysToo: paysTooOf(member.id, row.id),
        })),
        paidTogetherWith: [],
        bankPayment: bankPaymentOfGroup(row, group),
      };
      const list = expensesByYear.get(row.taxYear) ?? [];
      list.push(dto);
      expensesByYear.set(row.taxYear, list);
    }

    // One transfer filed as the payment proof of several invoices.
    for (const list of expensesByYear.values())
      this.sharePaymentDocuments(list, documentsById);

    // A year shows once it has an expense, a document of its own, a CU, a
    // return or a payslip (its return is then forecast).
    const certificateYears = certificateRows
      .map((row) =>
        row.categories.includes(CERTIFICATE_CATEGORY)
          ? Number(row.fields?.[TAX_CERTIFICATE_KEYS.incomeYear])
          : row.categories.includes(PAYSLIP_CATEGORY)
            ? Number(
                String(row.fields?.[PAYSLIP_KEYS.period] ?? '').slice(0, 4),
              )
            : NaN,
      )
      .filter(
        (year) =>
          Number.isInteger(year) &&
          year > 0 &&
          (!years.length || years.includes(year)),
      );
    const allYears = new Set<number>([
      ...expensesByYear.keys(),
      ...byYear.keys(),
      ...certificateYears,
      ...[...returns.keys()].filter(
        (year) => !years.length || years.includes(year),
      ),
    ]);
    return [...allYears]
      .sort((a, b) => b - a)
      .map((year) =>
        this.summarize(
          year,
          expensesByYear.get(year) ?? [],
          (byYear.get(year) ?? []).sort(byRole),
          estimated,
          certificateRows,
          (uploadId) => {
            const document = documentsById.get(uploadId);
            return document ? toDocumentDto(document) : null;
          },
          returns,
        ),
      );
  }

  /**
   * Shows a payment document that paid several expenses with each of them:
   * filed with several by you, or offered to the invoices it adds up with.
   * Sets `paidTogetherWith` from these and from shared payment expenses.
   */
  private sharePaymentDocuments(
    list: DossierExpenseDto[],
    documentsById: Map<string, DocumentRow>,
  ): void {
    const byId = new Map(list.map((e) => [e.id, e]));
    const shared = sharePayments(
      list.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        issuer: e.issuer,
        text: [e.description, e.documentNumber].filter(Boolean).join(' '),
        paymentUploads: e.attachments
          .filter((a) => a.role === 'PAYMENT')
          .map((a) => a.uploadId),
      })),
      (uploadId) => {
        const document = documentsById.get(uploadId);
        if (!document || document.deletedAt) return undefined;
        return {
          amount: documentAmount(document.fields),
          text: [
            document.title,
            document.originalFilename,
            documentIssuer(document) ?? '',
          ].join(' '),
        };
      },
    );
    const summary = (e: DossierExpenseDto): SharedPaymentExpenseDto => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      issuer: e.issuer,
      description: e.description,
    });
    for (const payment of shared) {
      const document = documentsById.get(payment.uploadId);
      for (const id of payment.expenseIds) {
        const expense = byId.get(id);
        if (!expense) continue;
        const paysToo = payment.expenseIds
          .filter((other) => other !== id)
          .flatMap((other) => {
            const e = byId.get(other);
            return e ? [summary(e)] : [];
          });
        const filed = expense.attachments.find(
          (a) => a.uploadId === payment.uploadId,
        );
        if (filed)
          expense.attachments = expense.attachments.map((a) =>
            a.uploadId === payment.uploadId ? { ...a, paysToo } : a,
          );
        else
          expense.attachments = [
            ...expense.attachments,
            {
              uploadId: payment.uploadId,
              role: 'PAYMENT' as const,
              document: document ? toDocumentDto(document) : null,
              automatic: true,
              paysToo,
            },
          ].sort(byRole);
        expense.hasPaymentProof = true;
      }
    }
    for (const expense of list) {
      const seen = new Set<string>([expense.id]);
      expense.paidTogetherWith = [
        ...expense.attachments.flatMap((a) => a.paysToo ?? []),
        ...expense.paired.flatMap((p) => p.paysToo),
      ].filter((e) => !seen.has(e.id) && seen.add(e.id));
    }
  }

  /** The filing deadline of each year (and the Redditi PF second advance), for the Agenda. */
  /**
   * What needs you, for the hub badge (`GET /attention`): a return or an
   * advance not done whose date passed in the last year, those due within
   * 30 days, and the expense and payment pairs waiting for you to confirm.
   */
  async attention(day = today()): Promise<LifeAttentionDto> {
    const [past, soon, years] = await Promise.all([
      this.deadlines({ from: isoAddDays(day, -365), to: isoAddDays(day, -1) }),
      this.deadlines({ from: day, to: isoAddDays(day, 30) }),
      this.taxYears(),
    ]);
    return {
      expired: past.filter((d) => !d.done).length,
      expiring: soon.filter((d) => !d.done).length,
      toReview: years.reduce((n, y) => n + y.pairsToReviewCount, 0),
      items: years
        .filter((y) => y.pairsToReviewCount > 0)
        .map((y) => ({
          id: `pairs:${y.taxYear}`,
          kind: 'payment-pairs',
          title: `Confirm ${y.pairsToReviewCount} expense${
            y.pairsToReviewCount === 1 ? '' : 's'
          } paired with ${y.pairsToReviewCount === 1 ? 'its payment' : 'their payments'}`,
          detail: `Tax year ${y.taxYear}, for the 730/${y.filingYear}`,
          since: null,
          path: `/taxes/730?year=${y.taxYear}&view=expenses#payment-pairs`,
          action: 'Confirm',
        })),
    };
  }

  async deadlines(query: DeadlinesQuery): Promise<DeadlineDto[]> {
    const rows = await this.svc.db
      .select({
        uploadId: documents.uploadId,
        title: documents.title,
        categories: documents.categories,
        fields: documents.fields,
        uploadedAt: documents.uploadedAt,
      })
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          arrayOverlaps(documents.categories, [TAX_RETURN_CATEGORY]),
        ),
      );
    return deadlinesOf(deadlineWindow(query, today()), returnsOf(rows));
  }

  private summarize(
    taxYear: number,
    yearExpenses: DossierExpenseDto[],
    yearDocuments: Tax730AttachmentDto[],
    estimated: EstimatedExpense[],
    certificateRows: CertificateSource[] = [],
    documentOf: (uploadId: string) => Tax730DocumentDto | null = () => null,
    returns: ReadonlyMap<number, Tax730FiledReturnDto> = new Map(),
  ): TaxYearDossierDto {
    const certificates = certificatesOf(taxYear, certificateRows);
    const filedReturn = returns.get(taxYear) ?? null;
    // The CUs the estimate uses are documents of the year too, with no need
    // to file them by hand (and nothing to remove: they come from Documents).
    const filed = new Set(yearDocuments.map((a) => a.uploadId));
    const found: Tax730AttachmentDto[] = certificates
      .filter((c) => !filed.has(c.uploadId))
      .map((c) => ({
        uploadId: c.uploadId,
        role: 'CERTIFICATION',
        document: documentOf(c.uploadId),
        automatic: true,
      }));
    // So is the year's return, once you upload it.
    if (filedReturn && !filed.has(filedReturn.uploadId))
      found.push({
        uploadId: filedReturn.uploadId,
        role: 'RETURN',
        document: documentOf(filedReturn.uploadId),
        automatic: true,
      });
    const byMonth = Array.from({ length: 12 }, () => 0);
    for (const expense of yearExpenses) {
      const month = Number(expense.date.slice(5, 7)) - 1;
      if (month >= 0 && month < 12)
        byMonth[month] = round(byMonth[month] + expense.amount);
    }
    const byType = new Map<string, { total: number; count: number }>();
    for (const expense of yearExpenses) {
      const entry = byType.get(expense.expenseType) ?? { total: 0, count: 0 };
      entry.total = round(entry.total + expense.amount);
      entry.count++;
      byType.set(expense.expenseType, entry);
    }
    const deductions = estimateDeductions(taxYear, estimated, certificates);
    const payslips = certificates.length
      ? []
      : payslipsOf(taxYear, certificateRows);
    const now = today();
    const forecast = forecastOf({
      taxYear,
      currentYear: Number(now.slice(0, 4)),
      certificates,
      payslips,
      deductions,
      expenseCount: yearExpenses.length,
      previousReturn: returns.get(taxYear - 1) ?? null,
    });
    return {
      taxYear,
      filingYear: taxYear + 1,
      total: round(yearExpenses.reduce((sum, e) => sum + e.amount, 0)),
      expenseCount: yearExpenses.length,
      byType: [...byType.entries()]
        .map(([expenseType, entry]) => ({ expenseType, ...entry }))
        .sort((a, b) => b.total - a.total),
      untraceableCount: yearExpenses.filter((e) => e.traceablePayment === false)
        .length,
      missingInvoiceCount: yearExpenses.filter((e) => !e.hasInvoice).length,
      missingPaymentCount: yearExpenses.filter((e) => !e.hasPaymentProof)
        .length,
      pairsToReviewCount: yearExpenses.filter(
        (e) =>
          e.paired.some((p) => p.automatic) ||
          e.attachments.some((a) => a.automatic && a.paysToo?.length),
      ).length,
      deductions,
      byMonth,
      taxReturn: taxReturnOf({
        taxYear,
        today: now,
        returns,
        forecast,
        hasCertificates: certificates.length > 0,
        payslipOnly: !certificates.length && payslips.length > 0,
      }),
      expenses: yearExpenses,
      yearDocuments: [...found, ...yearDocuments].sort(byRole),
    };
  }

  async updateExpense(
    id: string,
    request: UpdateExpenseChanges,
  ): Promise<ExpenseDto> {
    const current = await this.expense(id);
    if (!current) throw new NotFoundException(`Expense ${id} not found`);
    if (request.date !== undefined) {
      if (Number.isNaN(Date.parse(request.date)))
        throw new BadRequestException(`date: ${request.date} is not a day`);
      if (Number(request.date.slice(0, 4)) !== current.taxYear)
        throw new BadRequestException(
          `date: ${request.date} is not in ${current.taxYear}, the expense's tax year`,
        );
    }
    const blank = (value: string | null | undefined) =>
      value === undefined ? undefined : value || null;
    const changes: Partial<ExpenseRow> = {
      expenseType: request.expenseType,
      date: request.date,
      amount: request.amount,
      issuer: request.issuer,
      documentNumber: blank(request.documentNumber),
      traceablePayment: request.traceablePayment,
      frame730: blank(request.frame730),
      beneficiaryFiscalCode: blank(request.beneficiaryFiscalCode),
      description: blank(request.description),
      notes: blank(request.notes),
    };
    for (const key of Object.keys(changes) as (keyof ExpenseRow)[])
      if (changes[key] === undefined) delete changes[key];
    if (!Object.keys(changes).length) return toExpenseDto(current);
    const [row] = await this.svc.db
      .update(expenses)
      .set(changes)
      .where(eq(expenses.id, id))
      .returning();
    return toExpenseDto(row);
  }

  /** Files a document with an expense; filing it again changes its role. */
  async addExpenseAttachment(
    expenseId: string,
    request: AddAttachmentRequest,
  ): Promise<DossierExpenseDto> {
    const expense = await this.expense(expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (request.role === 'CERTIFICATION' || request.role === 'RETURN')
      throw new BadRequestException(
        'A certification or a return belongs to the whole year, not to one expense',
      );
    await this.requireDocument(request.uploadId);
    await this.svc.db
      .insert(attachments)
      .values({
        taxYear: expense.taxYear,
        expenseId,
        uploadId: request.uploadId,
        role: request.role,
        chosen: true,
      })
      .onConflictDoUpdate({
        target: [attachments.expenseId, attachments.uploadId],
        targetWhere: sql`${attachments.expenseId} is not null`,
        set: { role: request.role, chosen: true },
      });
    return this.dossierExpense(expense);
  }

  async removeExpenseAttachment(
    expenseId: string,
    uploadId: string,
  ): Promise<DossierExpenseDto> {
    const expense = await this.expense(expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    // The documents of the expenses paired with it are shown, and removed, with it.
    const group = await this.dossierExpense(expense);
    await this.svc.db
      .delete(attachments)
      .where(
        and(
          inArray(attachments.expenseId, [
            expenseId,
            group.id,
            ...group.paired.map((p) => p.id),
          ]),
          eq(attachments.uploadId, uploadId),
        ),
      );
    return this.dossierExpense(expense);
  }

  /**
   * Pairs an expense with another one of its year (it is then counted only
   * through that one), or keeps it apart with `pairedWith: null`. Expenses
   * already confirmed with it follow it to the new one.
   */
  async setPairing(
    id: string,
    request: SetExpensePairingRequest,
  ): Promise<TaxYearDossierDto> {
    const expense = await this.expense(id);
    if (!expense) throw new NotFoundException(`Expense ${id} not found`);
    if (request.pairedWith === null) {
      await this.svc.db
        .update(expenses)
        .set({ pairedWith: null, pairing: 'SEPARATE', paysToo: [] })
        .where(eq(expenses.id, id));
      return this.dossier(expense.taxYear);
    }
    let target = await this.expense(request.pairedWith);
    if (!target)
      throw new NotFoundException(`Expense ${request.pairedWith} not found`);
    // Pair with the expense that is counted, not with one of its payments.
    for (let hops = 0; hops < 10; hops++) {
      if (
        target.pairing !== 'CONFIRMED' ||
        !target.pairedWith ||
        target.pairedWith === id
      )
        break;
      const next = await this.expense(target.pairedWith);
      if (!next) break;
      target = next;
    }
    if (target.id === id)
      throw new BadRequestException('An expense cannot be paired with itself');
    if (target.taxYear !== expense.taxYear)
      throw new BadRequestException(
        'Only expenses of the same tax year can be paired',
      );
    const targetId = target.id;
    await this.svc.db.transaction(async (tx) => {
      // The target was one of this expense's payments: it becomes the one counted.
      await tx
        .update(expenses)
        .set({ pairedWith: null, pairing: null, paysToo: [] })
        .where(and(eq(expenses.id, targetId), eq(expenses.pairedWith, id)));
      await tx
        .update(expenses)
        .set({ pairedWith: targetId })
        .where(
          and(eq(expenses.pairedWith, id), eq(expenses.pairing, 'CONFIRMED')),
        );
      await tx
        .update(expenses)
        .set({ pairedWith: targetId, pairing: 'CONFIRMED', paysToo: [] })
        .where(eq(expenses.id, id));
    });
    return this.dossier(expense.taxYear);
  }

  /**
   * Removes an expense from the 730, with how its documents were filed: the
   * documents stay in your archive and can be filed with another expense.
   * Expenses paired with it are counted on their own again.
   */
  async removeExpense(id: string): Promise<TaxYearDossierDto> {
    const row = await this.svc.db.transaction(async (tx) => {
      // A transfer that paid it with other invoices keeps paying the others.
      await tx
        .update(expenses)
        .set({ paysToo: sql`array_remove(${expenses.paysToo}, ${id}::uuid)` })
        .where(sql`${id}::uuid = any(${expenses.paysToo})`);
      await tx
        .update(expenses)
        .set({
          pairedWith: sql`${expenses.paysToo}[1]`,
          paysToo: sql`${expenses.paysToo}[2:]`,
        })
        .where(
          and(
            eq(expenses.pairedWith, id),
            sql`cardinality(${expenses.paysToo}) > 0`,
          ),
        );
      // Its other confirmed payments go back to being paired automatically.
      await tx
        .update(expenses)
        .set({ pairedWith: null, pairing: null, paysToo: [] })
        .where(eq(expenses.pairedWith, id));
      const [deleted] = await tx
        .delete(expenses)
        .where(eq(expenses.id, id))
        .returning();
      return deleted;
    });
    if (!row) throw new NotFoundException(`Expense ${id} not found`);
    return this.dossier(row.taxYear);
  }

  /** Forgets your decision: the expense is paired automatically again. */
  async resetPairing(id: string): Promise<TaxYearDossierDto> {
    const [row] = await this.svc.db
      .update(expenses)
      .set({ pairedWith: null, pairing: null, paysToo: [] })
      .where(eq(expenses.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Expense ${id} not found`);
    return this.dossier(row.taxYear);
  }

  /** Confirms the payments paired automatically with this expense. */
  async confirmPairing(id: string): Promise<TaxYearDossierDto> {
    const expense = await this.expense(id);
    if (!expense) throw new NotFoundException(`Expense ${id} not found`);
    const group = await this.dossierExpense(expense);
    const automatic = group.paired.filter((p) => p.automatic);
    await this.svc.db.transaction(async (tx) => {
      // A transfer that paid other invoices too keeps paying them.
      for (const payment of automatic)
        await tx
          .update(expenses)
          .set({
            pairedWith: group.id,
            pairing: 'CONFIRMED',
            paysToo: payment.paysToo.map((other) => other.id),
          })
          .where(eq(expenses.id, payment.id));
      // A transfer offered to this invoice is filed with it.
      for (const attachment of group.attachments.filter((a) => a.automatic))
        await tx
          .insert(attachments)
          .values({
            taxYear: expense.taxYear,
            expenseId: group.id,
            uploadId: attachment.uploadId,
            role: attachment.role,
            chosen: true,
          })
          .onConflictDoNothing();
    });
    return this.dossier(expense.taxYear);
  }

  /** Files a document with the whole year, e.g. the Certificazione Unica. */
  async addYearAttachment(
    taxYear: number,
    request: AddAttachmentRequest,
  ): Promise<TaxYearDossierDto> {
    if (request.role === 'INVOICE' || request.role === 'PAYMENT')
      throw new BadRequestException(
        'Invoices and payment proofs belong to an expense',
      );
    await this.requireDocument(request.uploadId);
    await this.svc.db
      .insert(taxYears)
      .values({ taxYear })
      .onConflictDoNothing();
    await this.svc.db
      .insert(attachments)
      .values({ taxYear, uploadId: request.uploadId, role: request.role })
      .onConflictDoUpdate({
        target: [attachments.taxYear, attachments.uploadId],
        targetWhere: sql`${attachments.expenseId} is null`,
        set: { role: request.role },
      });
    return this.dossier(taxYear);
  }

  async removeYearAttachment(
    taxYear: number,
    uploadId: string,
  ): Promise<TaxYearDossierDto> {
    await this.svc.db
      .delete(attachments)
      .where(
        and(
          eq(attachments.taxYear, taxYear),
          isNull(attachments.expenseId),
          eq(attachments.uploadId, uploadId),
        ),
      );
    return this.dossier(taxYear);
  }

  /**
   * Your documents, newest first; with `forExpense`, the ones most likely to
   * prove that expense was paid come first, each with the reasons.
   */
  async documents(query: ListDocuments): Promise<Tax730DocumentCandidateDto[]> {
    const conditions = [isNull(documents.deletedAt)];
    // Every word, wherever it is: "2025-12-16 - 66 - Edilrenso - Fattura.pdf"
    // finds the document titled "2025 12 16 66 Edilrenso Fattura".
    for (const word of searchWords(query.search)) {
      const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        sql`(${documents.title} ilike ${pattern} or ${documents.originalFilename} ilike ${pattern} or ${documents.fields}::text ilike ${pattern})`,
      );
    }
    const rows = await this.svc.db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt))
      .limit(query.forExpense ? 500 : query.limit);
    if (!query.forExpense)
      return rows.map((row) => ({
        ...toDocumentDto(row),
        score: 0,
        reasons: [],
        filedAs: null,
      }));

    const expense = await this.expense(query.forExpense);
    if (!expense)
      throw new NotFoundException(`Expense ${query.forExpense} not found`);
    // What is filed with it, or with the expenses paired with it.
    const group = await this.dossierExpense(expense);
    const filed = new Map<string, Tax730AttachmentRole>(
      group.attachments.map((a) => [a.uploadId, a.role]),
    );
    return (
      rows
        // A search shows what is filed already, so you see why it is not new;
        // the suggestions leave it out.
        .filter((row) => query.search || !filed.has(row.uploadId))
        .map((row) => ({
          ...toDocumentDto(row),
          ...scorePaymentCandidate(expense, row),
          filedAs: filed.get(row.uploadId) ?? null,
        }))
        .filter((candidate) => query.search || candidate.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || b.uploadedAt.localeCompare(a.uploadedAt),
        )
        .slice(0, query.limit)
    );
  }

  /** A document this service knows, for streaming its file. */
  async document(uploadId: string): Promise<DocumentRow | undefined> {
    const [row] = await this.svc.db
      .select()
      .from(documents)
      .where(eq(documents.uploadId, uploadId));
    return row;
  }

  /** Whether any expense or year of the 730 files this document. */
  async isFiled(uploadId: string): Promise<boolean> {
    const [row] = await this.svc.db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.uploadId, uploadId))
      .limit(1);
    return !!row;
  }

  private async expense(id: string): Promise<ExpenseRow | undefined> {
    const [row] = await this.svc.db
      .select()
      .from(expenses)
      .where(eq(expenses.id, id));
    return row;
  }

  private async dossierExpense(
    expense: ExpenseRow,
  ): Promise<DossierExpenseDto> {
    const dossier = await this.dossier(expense.taxYear);
    // A paired expense is shown, and counted, through the one it pairs with.
    const found = dossier.expenses.find(
      (e) => e.id === expense.id || e.paired.some((p) => p.id === expense.id),
    );
    if (!found) throw new NotFoundException(`Expense ${expense.id} not found`);
    return found;
  }

  private async requireDocument(uploadId: string): Promise<void> {
    const document = await this.document(uploadId);
    if (!document || document.deletedAt)
      throw new NotFoundException(
        `Document ${uploadId} not found; upload it in the documents app first`,
      );
  }

  private async documentsById(
    ids: string[],
  ): Promise<Map<string, DocumentRow>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.svc.db
      .select()
      .from(documents)
      .where(inArray(documents.uploadId, unique));
    return new Map(rows.map((row) => [row.uploadId, row]));
  }
}
