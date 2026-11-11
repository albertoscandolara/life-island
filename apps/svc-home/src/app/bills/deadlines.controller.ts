import { Controller, Get, Inject, Query } from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  deadlinesQuerySchema,
  deadlineWindow,
  inDeadlineWindow,
  isoToday,
  type DeadlineDto,
  type UtilityKind,
} from '@life-island/contracts';
import { BillsService } from './bills.service.js';

const UTILITY_NAMES: Record<UtilityKind, string> = {
  ELECTRICITY: 'Electricity',
  GAS: 'Gas',
  WATER: 'Water',
};

/** The bills' due dates, for the Agenda (`GET /deadlines`). */
@Controller()
export class HomeDeadlinesController {
  constructor(@Inject(BillsService) private readonly bills: BillsService) {}

  @Get('deadlines')
  async deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    const window = deadlineWindow(
      parseOrThrow(deadlinesQuerySchema, query),
      isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome'),
    );
    const bills = await this.bills.list({ utility: undefined });
    return bills.flatMap((bill): DeadlineDto[] =>
      inDeadlineWindow(bill.dueDate, window)
        ? [
            {
              id: `bill:${bill.id}:${bill.dueDate}`,
              module: 'home',
              kind: 'bill',
              title: `${UTILITY_NAMES[bill.utility]} bill due${bill.provider ? ` · ${bill.provider}` : ''}`,
              detail: bill.invoiceNumber
                ? `Invoice ${bill.invoiceNumber}. Nothing to do if it is paid by direct debit.`
                : 'Nothing to do if it is paid by direct debit.',
              date: bill.dueDate,
              amount: bill.totalDue ?? bill.amount,
              path: '/home',
            },
          ]
        : [],
    );
  }
}
