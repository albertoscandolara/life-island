import { Controller, Get, Inject, Query } from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  listExpensesQuerySchema,
  type ExpenseDto,
  type Page,
  type TaxYearDto,
} from '@life-island/contracts';
import { ExpensesService } from './expenses.service.js';

@Controller()
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
  ) {}

  @Get('expenses')
  list(@Query() query: unknown): Promise<Page<ExpenseDto>> {
    return this.expenses.list(parseOrThrow(listExpensesQuerySchema, query));
  }

  /** Deductible totals per tax year, by expense type. */
  @Get('tax-years')
  taxYears(): Promise<TaxYearDto[]> {
    return this.expenses.taxYears();
  }
}
