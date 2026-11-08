import {
  GENERAL_TARGET_KEY,
  type ExtractedFields,
  type ReviewReason,
} from '@life-island/contracts';
import type { CategoryDefinition } from './parsers/document-parser.js';

/** Below this, the AI's own confidence sends the document to review. */
export const AUTO_CONFIRM_MIN_CONFIDENCE = 0.85;

const UTILITY_BILLS = ['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL'];
/** ID documents: their root and the types below it (or top-level, if you moved them). */
const ID_DOCUMENT_TYPES = [
  'ID_DOCUMENT',
  'IDENTITY_CARD',
  'PASSPORT',
  'HEALTH_CARD',
  'DRIVING_LICENCE',
];
/** Registration certificates: the car data they print is for you to accept. */
const VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION';
const DOUBTFUL = ['ambiguous', 'conflicting', 'invalid', 'illegible'];

export interface ParsedDocument {
  confidence: number;
  flags: string[];
  categories: string[];
  targetKey: string | null;
  extractedFields: ExtractedFields | null;
  /** Category suggestions of this document still waiting for a decision. */
  pendingSuggestions: number;
}

/**
 * Why a parsed document needs a person to look at it. None means there is
 * nothing to check: the AI knows what it is, read every field without doubt,
 * proposes no new category, only the archive (and Bills) read it, and it is
 * not an ID document or a registration certificate.
 */
export function reviewReasons(
  document: ParsedDocument,
  categories: readonly CategoryDefinition[],
): ReviewReason[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const lineage = (id: string): string[] => {
    const chain: string[] = [];
    let current: string | null | undefined = id;
    while (current && !chain.includes(current)) {
      chain.push(current);
      current = byId.get(current)?.parentId;
    }
    return chain;
  };
  const dimensionOf = (id: string) => byId.get(id)?.dimension ?? null;
  const fields = Object.values(document.extractedFields?.fields ?? {});
  const reasons: ReviewReason[] = [];
  if (document.flags.includes('fake_parser')) reasons.push('OFFLINE_PARSER');
  if (document.confidence < AUTO_CONFIRM_MIN_CONFIDENCE)
    reasons.push('LOW_CONFIDENCE');
  if (
    document.flags.includes('needs_attention') ||
    fields.some(
      (field) =>
        DOUBTFUL.includes(field.status) ||
        (field.required && field.status !== 'found'),
    )
  )
    reasons.push('DOUBTFUL_FIELDS');
  if (document.pendingSuggestions > 0) reasons.push('NEW_CATEGORIES');
  if (!document.categories.some((id) => dimensionOf(id) === 'DOCUMENT_TYPE'))
    reasons.push('NO_DOCUMENT_TYPE');
  if ((document.targetKey ?? GENERAL_TARGET_KEY) !== GENERAL_TARGET_KEY)
    reasons.push('MODULE');
  const isBill = document.categories.some((id) =>
    lineage(id).some((ancestor) => UTILITY_BILLS.includes(ancestor)),
  );
  if (
    isBill &&
    !document.categories.some((id) => dimensionOf(id) === 'PROPERTY')
  )
    reasons.push('NO_PROPERTY');
  // Who a document identifies is never confirmed on its own: a new person, or
  // a name, birth date or address that differs, is for you to accept.
  if (
    document.categories.some((id) =>
      lineage(id).some((ancestor) => ID_DOCUMENT_TYPES.includes(ancestor)),
    )
  )
    reasons.push('PERSON_DATA');
  // So is a car's data: a new car, or a plate, VIN or engine that differs.
  if (
    document.categories.some((id) => lineage(id).includes(VEHICLE_REGISTRATION))
  )
    reasons.push('VEHICLE_DATA');
  return reasons;
}
