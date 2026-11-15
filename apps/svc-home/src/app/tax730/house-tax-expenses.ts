import {
  HOUSE_TAX_EXPENSE_TYPES,
  type DossierExpenseDto,
  type HouseTaxExpenseDto,
  type HouseTaxExpenseMatch,
  type HouseTaxExpenseType,
} from '@life-island/contracts';
import type {
  DocumentLike,
  ParentOf,
  PropertyLike,
} from '../bills/bill-reader.js';
import { documentHouse } from '../houses/house-reader.js';

const HOME_TYPES = new Set<string>(HOUSE_TAX_EXPENSE_TYPES);

/** Whether a 730 expense is work on a house: a renovation, ecobonus or bonus mobili. */
export const isHouseExpense = (expense: { expenseType: string }): boolean =>
  HOME_TYPES.has(expense.expenseType);

export interface TaxExpenseLinkLike {
  expenseId: string;
  manualProperty: boolean;
  propertyId: string | null;
  workId: string | null;
}

export interface PlaceContext {
  properties: readonly PropertyLike[];
  parentOf: ParentOf;
  /** The documents mirrored here, by upload id. */
  documents: ReadonlyMap<string, DocumentLike>;
  /** Works by id, with their house. */
  works: ReadonlyMap<string, { propertyId: string }>;
  /** The work each document is filed under. */
  workOfUpload: ReadonlyMap<string, string>;
  links: ReadonlyMap<string, TaxExpenseLinkLike>;
}

/**
 * Where a 730 home expense belongs: your choice wins; then a work one of its
 * documents is filed under; then the house its invoice names (an address, a
 * supply code, a category of the house); then, with one house only, that
 * one. Pure, for tests.
 */
export function placeTaxExpense(
  expense: DossierExpenseDto,
  context: PlaceContext,
): HouseTaxExpenseDto {
  const ids = [expense.id, ...expense.paired.map((p) => p.id)];
  const link = ids
    .map((id) => context.links.get(id))
    .find((l): l is TaxExpenseLinkLike => !!l);
  const uploads = [
    expense.uploadId,
    ...expense.attachments.map((a) => a.uploadId),
  ].filter((id, i, all) => all.indexOf(id) === i);

  let workId = link?.workId ?? null;
  if (workId && !context.works.has(workId)) workId = null;
  if (!workId && !link?.manualProperty)
    workId =
      uploads
        .map((id) => context.workOfUpload.get(id))
        .find((id): id is string => !!id && context.works.has(id)) ?? null;

  let propertyId: string | null = null;
  let match: HouseTaxExpenseMatch | null = null;
  if (link?.manualProperty) {
    propertyId = link.propertyId;
    match = propertyId ? 'MANUAL' : null;
  } else if (workId) {
    propertyId = context.works.get(workId)?.propertyId ?? null;
    match = 'WORK';
  } else {
    for (const id of uploads) {
      const document = context.documents.get(id);
      if (!document) continue;
      const found = documentHouse(
        document,
        context.properties,
        context.parentOf,
        null,
      );
      if (found) {
        propertyId = found;
        match = 'DOCUMENT';
        break;
      }
    }
    if (!propertyId && context.properties.length === 1) {
      propertyId = context.properties[0].id;
      match = 'ONLY_HOUSE';
    }
  }
  // A work of another house is not this expense's any more.
  if (workId && context.works.get(workId)?.propertyId !== propertyId)
    workId = null;

  return {
    expenseId: expense.id,
    taxYear: expense.taxYear,
    expenseType: expense.expenseType as HouseTaxExpenseType,
    date: expense.date,
    amount: expense.amount,
    issuer: expense.issuer,
    description: expense.description,
    documentNumber: expense.documentNumber,
    traceablePayment: expense.traceablePayment,
    documents: [
      ...expense.attachments.map((a) => ({
        uploadId: a.uploadId,
        role: a.role as string,
      })),
      { uploadId: expense.uploadId, role: expense.kind as string },
    ]
      .filter(
        (d, i, all) => all.findIndex((o) => o.uploadId === d.uploadId) === i,
      )
      .map((d) => ({
        ...d,
        title: context.documents.get(d.uploadId)?.title ?? null,
      })),
    propertyId,
    match,
    workId,
  };
}
