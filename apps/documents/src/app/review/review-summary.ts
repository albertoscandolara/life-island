import type { ExtractedField } from '@life-island/contracts';
import {
  CORE_FIELDS,
  coreFieldKey,
  LOADING_MODULES,
  MODULE_LABELS,
  orderFieldKeys,
  type CategoryDimension,
} from '@life-island/contracts/constants';

/** A field of the document with its key, as the review shows it. */
export type ReviewField = ExtractedField & { key: string };

/** What the review needs to know about a category. */
export interface CategoryInfo {
  title: string;
  parentId: string | null;
  dimension: CategoryDimension | null;
}
export type CategoryLookup = (id: string) => CategoryInfo | undefined;

/** Statuses that mean the AI is not sure: you have to look. */
const DOUBTFUL = new Set(['ambiguous', 'conflicting', 'invalid', 'illegible']);

/**
 * The fields in three groups, each in reading order (the common record
 * first): the ones to check (unsure, or required and not found), the ones
 * read, and the empty optional ones, which stay folded away.
 */
export function groupFields(
  fields: readonly ReviewField[],
  values: Record<string, string>,
): { doubtful: ReviewField[]; found: ReviewField[]; empty: ReviewField[] } {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const ordered = orderFieldKeys(fields.map((field) => field.key)).map((key) =>
    byKey.get(key)!,
  );
  const filled = (field: ReviewField) =>
    (values[field.key] ?? '').trim() !== '';
  const doubtful = ordered.filter(
    (field) => DOUBTFUL.has(field.status) || (field.required && !filled(field)),
  );
  const rest = ordered.filter((field) => !doubtful.includes(field));
  return {
    doubtful,
    found: rest.filter(filled),
    empty: rest.filter((field) => !filled(field)),
  };
}

/** Bills reads electricity, gas and water bills (and their subcategories). */
const UTILITY_BILLS = ['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL'];

function withAncestors(id: string, lookup: CategoryLookup): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = lookup(current)?.parentId;
  }
  return chain;
}

export interface ReviewSummary {
  /** "Electricity bill", from the document type category; null when it has none. */
  type: string | null;
  issuer: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  /** Homes or places, from the property categories. */
  properties: string[];
  /** Where the document goes once confirmed, e.g. ["Bills", "Documents only"]. */
  destinations: string[];
}

/**
 * The document at a glance: what it is, who issued it, how much, when, and
 * where it goes once you confirm it.
 */
export function summarize(
  categories: readonly string[],
  values: Record<string, string>,
  targetCategory: string | null,
  lookup: CategoryLookup,
): ReviewSummary {
  const core = (key: string): string | null => {
    const field = CORE_FIELDS.find((candidate) => candidate.key === key)!;
    const present = Object.keys(values).filter((name) => values[name]?.trim());
    const name = coreFieldKey(field, present);
    return name ? values[name].trim() : null;
  };
  const ofDimension = (dimension: CategoryDimension) =>
    categories.filter((id) => lookup(id)?.dimension === dimension);
  const amount = core('total_amount');
  const parsed = amount === null ? NaN : Number(amount);
  const isBill = categories.some((id) =>
    withAncestors(id, lookup).some((ancestor) =>
      UTILITY_BILLS.includes(ancestor),
    ),
  );
  const module =
    targetCategory && LOADING_MODULES.includes(targetCategory)
      ? (MODULE_LABELS[targetCategory] ?? targetCategory)
      : null;
  return {
    type:
      ofDimension('DOCUMENT_TYPE').map((id) => lookup(id)!.title)[0] ?? null,
    issuer:
      core('issuer') ??
      ofDimension('ISSUER').map((id) => lookup(id)!.title)[0] ??
      null,
    amount: Number.isFinite(parsed) ? parsed : null,
    currency: core('currency'),
    date: core('issue_date'),
    properties: ofDimension('PROPERTY').map((id) => lookup(id)!.title),
    destinations: [
      ...(isBill ? ['Bills'] : []),
      ...(module ? [module] : []),
      ...(!isBill && !module ? [MODULE_LABELS['other']] : []),
    ],
  };
}
