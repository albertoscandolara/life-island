import { z } from 'zod';
import { isIsoDate } from './validators.js';

export const TAX730_EXPENSE_TYPES = [
  'medical',
  'medicines',
  'medical_devices',
  'veterinary',
  'education',
  'sport_kids',
  'mortgage_interest',
  'insurance',
  'renovation',
  'other',
] as const;
export type Tax730ExpenseType = (typeof TAX730_EXPENSE_TYPES)[number];

/** How each expense type reads in the app (English) and in the commercialista's files (Italian). */
export const TAX730_EXPENSE_TYPE_LABELS: Record<
  Tax730ExpenseType,
  { en: string; it: string }
> = {
  medical: { en: 'Medical', it: 'Spese sanitarie' },
  medicines: { en: 'Medicines', it: 'Medicinali' },
  medical_devices: { en: 'Medical devices', it: 'Dispositivi medici' },
  veterinary: { en: 'Veterinary', it: 'Spese veterinarie' },
  education: { en: 'Education', it: 'Istruzione' },
  sport_kids: { en: "Children's sport", it: 'Sport ragazzi' },
  mortgage_interest: { en: 'Mortgage interest', it: 'Interessi mutuo' },
  insurance: { en: 'Insurance', it: 'Assicurazioni' },
  renovation: { en: 'Home renovation', it: 'Ristrutturazione e bonus casa' },
  other: { en: 'Other', it: 'Altro' },
};

/** tax730.expense@1: an expense that may be deductible in the Italian 730 return. */
export const Tax730ExpenseV1 = z
  .object({
    taxYear: z.number().int().describe('Year the expense counts for'),
    expenseType: z.enum(TAX730_EXPENSE_TYPES),
    frame730: z
      .string()
      .optional()
      .describe(
        'Suggested 730 section/row, e.g. "E1"; always reviewed by a human',
      ),
    date: z
      .string()
      .describe('Expense date, YYYY-MM-DD')
      .refine(isIsoDate, 'expected YYYY-MM-DD'),
    amount: z.number(),
    beneficiaryFiscalCode: z
      .string()
      .optional()
      .describe('Codice fiscale of the beneficiary'),
    traceablePayment: z
      .boolean()
      .optional()
      .describe('Paid by card or bank transfer'),
    issuer: z
      .string()
      .describe('Who issued the document (pharmacy, doctor, school...)'),
    documentNumber: z.string().optional(),
  })
  .superRefine((expense, ctx) => {
    const year = Number(expense.date.slice(0, 4));
    if (year && expense.taxYear !== year) {
      ctx.addIssue({
        code: 'custom',
        path: ['taxYear'],
        message: `tax year ${expense.taxYear} does not match the expense date`,
      });
    }
  });
export type Tax730ExpenseV1 = z.infer<typeof Tax730ExpenseV1>;
