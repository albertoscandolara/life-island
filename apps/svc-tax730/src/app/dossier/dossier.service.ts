import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  TAX730_ATTACHMENT_ROLES,
  TAX_CERTIFICATE_KEYS,
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
  type TaxYearDossierDto,
  type TaxYearDto,
  type UpdateExpenseRequest,
} from '@life-island/contracts';
import {
  and,
  arrayContains,
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
import { toDocumentDto } from '../documents/document-view.js';
import { scorePaymentCandidate } from '../documents/payment-candidates.js';
import { toExpenseDto } from '../expenses/expense-dto.js';
import {
  expenseKind,
  pairExpenses,
  type PairableExpense,
  type PairingDecision,
} from '../expenses/expense-pairing.js';

type ListDocuments = z.output<typeof listTax730DocumentsQuerySchema>;

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
  };
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
  async dossiers(years: number[] = []): Promise<TaxYearDossierDto[]> {
    const db = this.svc.db;
    const [expenseRows, attachmentRows, certificateRows] = await Promise.all([
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
      // Your Certificazioni Uniche: the income and tax of each year.
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
            arrayContains(documents.categories, [CERTIFICATE_CATEGORY]),
          ),
        ),
    ]);
    const documentsById = await this.documentsById([
      ...expenseRows.map((row) => row.uploadId),
      ...attachmentRows.map((row) => row.uploadId),
      ...certificateRows.map((row) => row.uploadId),
    ]);
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
      members.set(pair.primaryId, [
        ...(members.get(pair.primaryId) ?? []),
        row,
      ]);
    }
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
    const traceable = (row: ExpenseRow, group: ExpenseRow[]) =>
      [row, ...group].some((e) => kindOf(e) === 'PAYMENT')
        ? true
        : row.traceablePayment;

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
      const dto: DossierExpenseDto = {
        ...toExpenseDto(row),
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
        })),
      };
      const list = expensesByYear.get(row.taxYear) ?? [];
      list.push(dto);
      expensesByYear.set(row.taxYear, list);
    }

    // A year shows once it has an expense, a document of its own or a CU.
    const certificateYears = certificateRows
      .map((row) => Number(row.fields?.[TAX_CERTIFICATE_KEYS.incomeYear]))
      .filter(
        (year) =>
          Number.isInteger(year) && (!years.length || years.includes(year)),
      );
    const allYears = new Set<number>([
      ...expensesByYear.keys(),
      ...byYear.keys(),
      ...certificateYears,
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
        ),
      );
  }

  private summarize(
    taxYear: number,
    yearExpenses: DossierExpenseDto[],
    yearDocuments: Tax730AttachmentDto[],
    estimated: EstimatedExpense[],
    certificateRows: CertificateSource[] = [],
    documentOf: (uploadId: string) => Tax730DocumentDto | null = () => null,
  ): TaxYearDossierDto {
    const certificates = certificatesOf(taxYear, certificateRows);
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
      pairsToReviewCount: yearExpenses.filter((e) =>
        e.paired.some((p) => p.automatic),
      ).length,
      deductions: estimateDeductions(taxYear, estimated, certificates),
      byMonth,
      expenses: yearExpenses,
      yearDocuments: [...found, ...yearDocuments].sort(byRole),
    };
  }

  async updateExpense(
    id: string,
    request: UpdateExpenseRequest,
  ): Promise<ExpenseDto> {
    const changes: Partial<Pick<ExpenseRow, 'description' | 'notes'>> = {};
    if (request.description !== undefined)
      changes.description = request.description || null;
    if (request.notes !== undefined) changes.notes = request.notes || null;
    const row = Object.keys(changes).length
      ? (
          await this.svc.db
            .update(expenses)
            .set(changes)
            .where(eq(expenses.id, id))
            .returning()
        )[0]
      : await this.expense(id);
    if (!row) throw new NotFoundException(`Expense ${id} not found`);
    return toExpenseDto(row);
  }

  /** Files a document with an expense; filing it again changes its role. */
  async addExpenseAttachment(
    expenseId: string,
    request: AddAttachmentRequest,
  ): Promise<DossierExpenseDto> {
    const expense = await this.expense(expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (request.role === 'CERTIFICATION')
      throw new BadRequestException(
        'A certification belongs to the whole year, not to one expense',
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
        .set({ pairedWith: null, pairing: 'SEPARATE' })
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
        .set({ pairedWith: null, pairing: null })
        .where(and(eq(expenses.id, targetId), eq(expenses.pairedWith, id)));
      await tx
        .update(expenses)
        .set({ pairedWith: targetId })
        .where(
          and(eq(expenses.pairedWith, id), eq(expenses.pairing, 'CONFIRMED')),
        );
      await tx
        .update(expenses)
        .set({ pairedWith: targetId, pairing: 'CONFIRMED' })
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
      // Its confirmed payments go back to being paired automatically.
      await tx
        .update(expenses)
        .set({ pairedWith: null, pairing: null })
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
      .set({ pairedWith: null, pairing: null })
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
    const automatic = group.paired.filter((p) => p.automatic).map((p) => p.id);
    if (automatic.length)
      await this.svc.db
        .update(expenses)
        .set({ pairedWith: group.id, pairing: 'CONFIRMED' })
        .where(inArray(expenses.id, automatic));
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
