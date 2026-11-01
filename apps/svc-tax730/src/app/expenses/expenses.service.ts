import { Inject, Injectable } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  listExpensesQuerySchema,
  type ExpenseDto,
  type Page,
  type TaxYearDto,
} from '@life-island/contracts';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import { expenses, type ExpenseRow } from '../db/schema.js';

type ListExpenses = z.output<typeof listExpensesQuerySchema>;

function toExpenseDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    sourceStagingId: row.sourceStagingId,
    uploadId: row.uploadId,
    taxYear: row.taxYear,
    expenseType: row.expenseType as ExpenseDto['expenseType'],
    frame730: row.frame730,
    date: row.date,
    amount: row.amount,
    beneficiaryFiscalCode: row.beneficiaryFiscalCode,
    traceablePayment: row.traceablePayment,
    issuer: row.issuer,
    documentNumber: row.documentNumber,
  };
}

@Injectable()
export class ExpensesService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(query: ListExpenses): Promise<Page<ExpenseDto>> {
    const conditions: SQL[] = [];
    if (query.taxYear) conditions.push(eq(expenses.taxYear, query.taxYear));
    if (query.expenseType)
      conditions.push(eq(expenses.expenseType, query.expenseType));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.svc.db
        .select()
        .from(expenses)
        .where(where)
        .orderBy(desc(expenses.date), desc(expenses.id))
        .limit(query.limit)
        .offset(query.offset),
      this.svc.db.select({ total: count() }).from(expenses).where(where),
    ]);
    return {
      items: rows.map(toExpenseDto),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** Totals per tax year and expense type, newest year first. */
  async taxYears(): Promise<TaxYearDto[]> {
    const { rows } = await this.svc.db.execute<{
      tax_year: number;
      expense_type: string;
      total: string;
      count: number;
      untraceable: number;
    }>(sql`
      select tax_year, expense_type, sum(amount) as total, count(*)::int as count,
             count(*) filter (where traceable_payment is false)::int as untraceable
        from ${expenses}
       group by tax_year, expense_type
       order by tax_year desc, sum(amount) desc`);
    const years = new Map<number, TaxYearDto>();
    for (const row of rows) {
      const year = years.get(row.tax_year) ?? {
        taxYear: row.tax_year,
        total: 0,
        expenseCount: 0,
        byType: [],
        untraceableCount: 0,
      };
      const total = Number(row.total);
      year.total = Math.round((year.total + total) * 100) / 100;
      year.expenseCount += row.count;
      year.untraceableCount += row.untraceable;
      year.byType.push({
        expenseType: row.expense_type,
        total,
        count: row.count,
      });
      years.set(row.tax_year, year);
    }
    return [...years.values()];
  }
}
