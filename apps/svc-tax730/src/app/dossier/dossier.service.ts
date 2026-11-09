import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  TAX730_ATTACHMENT_ROLES,
  type AddAttachmentRequest,
  type DossierExpenseDto,
  type ExpenseDto,
  type listTax730DocumentsQuerySchema,
  type Tax730AttachmentDto,
  type Tax730AttachmentRole,
  type Tax730DocumentCandidateDto,
  type TaxYearDossierDto,
  type TaxYearDto,
  type UpdateExpenseRequest,
} from '@life-island/contracts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
import { toDocumentDto } from '../documents/document-view.js';
import { scorePaymentCandidate } from '../documents/payment-candidates.js';
import { toExpenseDto } from '../expenses/expense-dto.js';

type ListDocuments = z.output<typeof listTax730DocumentsQuerySchema>;

const round = (value: number) => Math.round(value * 100) / 100;
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
    const yearFilter = years.length
      ? inArray(expenses.taxYear, years)
      : undefined;
    const [expenseRows, attachmentRows, estimated] = await Promise.all([
      db
        .select()
        .from(expenses)
        .where(yearFilter)
        .orderBy(asc(expenses.date), asc(expenses.createdAt)),
      db
        .select()
        .from(attachments)
        .where(years.length ? inArray(attachments.taxYear, years) : undefined)
        .orderBy(asc(attachments.createdAt)),
      // Every year: home bonuses of earlier years still bring instalments.
      db
        .select({
          taxYear: expenses.taxYear,
          expenseType: expenses.expenseType,
          amount: expenses.amount,
          traceablePayment: expenses.traceablePayment,
          beneficiaryFiscalCode: expenses.beneficiaryFiscalCode,
        })
        .from(expenses),
    ]);
    const documentsById = await this.documentsById(
      attachmentRows.map((row) => row.uploadId),
    );
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

    const expensesByYear = new Map<number, DossierExpenseDto[]>();
    for (const row of expenseRows) {
      const files = (byExpense.get(row.id) ?? []).sort(byRole);
      const invoice = files.find((file) => file.role === 'INVOICE');
      const dto: DossierExpenseDto = {
        ...toExpenseDto(row),
        // Until you write one, the invoice's title says what it was for.
        description:
          row.description ??
          (invoice?.document && !invoice.document.deleted
            ? invoice.document.title
            : null),
        attachments: files,
        hasInvoice: !!invoice,
        hasPaymentProof: files.some((file) => file.role === 'PAYMENT'),
      };
      const list = expensesByYear.get(row.taxYear) ?? [];
      list.push(dto);
      expensesByYear.set(row.taxYear, list);
    }

    // A year shows once it has an expense or a document of its own.
    const allYears = new Set<number>([
      ...expensesByYear.keys(),
      ...byYear.keys(),
    ]);
    return [...allYears]
      .sort((a, b) => b - a)
      .map((year) =>
        this.summarize(
          year,
          expensesByYear.get(year) ?? [],
          (byYear.get(year) ?? []).sort(byRole),
          estimated,
        ),
      );
  }

  private summarize(
    taxYear: number,
    yearExpenses: DossierExpenseDto[],
    yearDocuments: Tax730AttachmentDto[],
    estimated: EstimatedExpense[],
  ): TaxYearDossierDto {
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
      deductions: estimateDeductions(taxYear, estimated),
      byMonth,
      expenses: yearExpenses,
      yearDocuments,
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
      })
      .onConflictDoUpdate({
        target: [attachments.expenseId, attachments.uploadId],
        targetWhere: sql`${attachments.expenseId} is not null`,
        set: { role: request.role },
      });
    return this.dossierExpense(expense);
  }

  async removeExpenseAttachment(
    expenseId: string,
    uploadId: string,
  ): Promise<DossierExpenseDto> {
    const expense = await this.expense(expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    await this.svc.db
      .delete(attachments)
      .where(
        and(
          eq(attachments.expenseId, expenseId),
          eq(attachments.uploadId, uploadId),
        ),
      );
    return this.dossierExpense(expense);
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
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
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
      }));

    const expense = await this.expense(query.forExpense);
    if (!expense)
      throw new NotFoundException(`Expense ${query.forExpense} not found`);
    const filed = new Set(
      (
        await this.svc.db
          .select({ uploadId: attachments.uploadId })
          .from(attachments)
          .where(eq(attachments.expenseId, expense.id))
      ).map((row) => row.uploadId),
    );
    return rows
      .filter(
        (row) => !filed.has(row.uploadId) && row.uploadId !== expense.uploadId,
      )
      .map((row) => ({
        ...toDocumentDto(row),
        ...scorePaymentCandidate(expense, row),
      }))
      .filter((candidate) => query.search || candidate.score > 0)
      .sort(
        (a, b) => b.score - a.score || b.uploadedAt.localeCompare(a.uploadedAt),
      )
      .slice(0, query.limit);
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
    const found = dossier.expenses.find((e) => e.id === expense.id);
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
