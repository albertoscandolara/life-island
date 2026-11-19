import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { requireRow, type RecordCollection } from '@life-island/be-nest';
import { BadRequestException } from '@nestjs/common';
import {
  accountRequestSchema,
  budgetRequestSchema,
  guessMoneyCategory,
  splitsProblem,
  transactionRequestSchema,
  type TransactionRequest,
} from '@life-island/contracts';
import { accounts, budgets, transactions } from '../db/schema.js';

export const RECORDS = Symbol('MoneyRecords');

/** Money's plain records: accounts, movements and budgets. */
export function collections(db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'accounts',
      label: 'Account',
      table: accounts,
      request: accountRequestSchema,
    },
    {
      name: 'transactions',
      label: 'Movement',
      table: transactions,
      request: transactionRequestSchema,
      check: async (request: Partial<TransactionRequest>) => {
        if (request.accountId)
          await requireRow(db, accounts, request.accountId, 'Account');
        const problem =
          request.splits && request.amount !== undefined
            ? splitsProblem(Number(request.amount), request.splits)
            : null;
        if (problem) throw new BadRequestException(problem);
      },
      toValues: (request: Partial<TransactionRequest>) =>
        request.description !== undefined &&
        request.amount !== undefined &&
        !request.category
          ? {
              ...request,
              category: guessMoneyCategory(
                request.description,
                Number(request.amount),
              ),
            }
          : request,
    },
    {
      name: 'budgets',
      label: 'Budget',
      table: budgets,
      request: budgetRequestSchema,
    },
  ];
}
