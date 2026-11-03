import { Inject, Injectable } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  listExpensesQuerySchema,
  type ExpenseDto,
  type Page,
} from '@life-island/contracts';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import { expenses } from '../db/schema.js';
import { toExpenseDto } from './expense-dto.js';

type ListExpenses = z.output<typeof listExpensesQuerySchema>;

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
}
