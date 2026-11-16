import { z } from 'zod';
import { GeneralDocumentV1 } from './general-document.js';
import { GroceryReceiptV1 } from './grocery-receipt.js';
import { Tax730ExpenseV1 } from './tax730-expense.js';

/**
 * A place where extracted data can go. `category` is the module that loads it
 * (and so the schema and table it lands in); `targetKey` names the versioned
 * shape of the details JSON.
 */
export interface TargetDefinition<TSchema extends z.ZodType = z.ZodType> {
  targetKey: string;
  category: string;
  label: string;
  /** Read by the classifier: when does a document belong here? */
  description: string;
  schema: TSchema;
}

export const GENERAL_TARGET_KEY = 'general.document@1';

/**
 * The target catalog. Today it lives here; once the domain services exist,
 * each registers its own targets at startup (`catalog.target.registered`) and
 * the review service serves the merged catalog.
 */
export const TARGET_CATALOG: readonly TargetDefinition[] = [
  {
    targetKey: 'grocery.receipt@1',
    category: 'groceries',
    label: 'Grocery receipt',
    description:
      'A receipt (scontrino) from a supermarket, grocery store, bakery, butcher or pharmacy listing purchased items and a total.',
    schema: GroceryReceiptV1,
  },
  {
    targetKey: 'tax730.expense@1',
    category: 'tax730',
    label: '730 deductible expense',
    description:
      'A document proving an expense that can be deducted in the Italian 730 tax return: medical visits, medicines (pharmacy receipts with a codice fiscale), school fees, kids sport, insurance, mortgage interest, renovations, energy-efficiency works, furniture and appliances for a renovated home, estate agent fees. Only the invoice, receipt or payment of one expense: never a tax return itself (Modello 730, 730-3, Redditi PF or Unico, which list expenses and building bonus instalments already declared), a Certificazione Unica, a payslip or an F24.',
    schema: Tax730ExpenseV1,
  },
  {
    targetKey: GENERAL_TARGET_KEY,
    category: 'other',
    label: 'Other document',
    description: 'Anything that does not fit the targets above.',
    schema: GeneralDocumentV1,
  },
];

/**
 * Document types that are never one deductible expense, whatever the
 * classifier says: a tax return lists expenses (and the building bonus
 * instalments, RP41) already declared, a CU or a payslip lists income.
 * Classified as one of these, a document goes to the general target.
 */
export const NOT_AN_EXPENSE_CATEGORIES: readonly string[] = [
  'TAX_RETURN',
  'CERTIFICAZIONE_UNICA',
  'PAYSLIP',
];

export const CATEGORIES = [...new Set(TARGET_CATALOG.map((t) => t.category))];

export function findTarget(targetKey: string): TargetDefinition | undefined {
  return TARGET_CATALOG.find((target) => target.targetKey === targetKey);
}

/** Catalog entry as served over HTTP, with the details shape as JSON Schema. */
export interface TargetCatalogEntryDto {
  targetKey: string;
  category: string;
  label: string;
  description: string;
  jsonSchema: unknown;
}

export function catalogForApi(): TargetCatalogEntryDto[] {
  return TARGET_CATALOG.map(({ schema, ...entry }) => ({
    ...entry,
    jsonSchema: z.toJSONSchema(schema, {
      io: 'output',
      unrepresentable: 'any',
    }),
  }));
}
