import {
  CORE_FIELDS,
  coreFieldKey,
  findTarget,
  GENERAL_TARGET_KEY,
  normalizeFieldValue,
  type ExtractedField,
  type ExtractedFields,
  type FieldStatus,
  type TargetDefinition,
  orderFieldKeys,
  type TemplateField,
} from '@life-island/contracts';
import type { CategoryDefinition } from './parsers/document-parser.js';

export { normalizeFieldValue, parseNumber } from '@life-island/contracts';

/** A template field to extract, with the categories that ask for it. */
export interface PlannedField extends TemplateField {
  categories: string[];
}

/** What the EXTRACT step asks for: the merged template fields and the target schema. */
export interface ExtractionPlan {
  fields: PlannedField[];
  target: TargetDefinition;
  /** Problems found while merging templates (same key, different types). */
  warnings: string[];
}

/** One field as the model reports it, before validation. */
export interface RawFieldResult {
  key: string;
  status: Exclude<FieldStatus, 'invalid'>;
  value: string | null;
  candidates: string[];
  note: string | null;
}

/**
 * Merges the templates of every assigned category into one list of fields.
 * Templates share keys for the same meaning (`total_amount`, `issue_date`), so
 * a document that is both a BILL and a WATER_BILL is asked for its total once.
 * When two templates use one key with different types, the first category
 * keeps it and the clash is reported instead of guessed.
 */
export function buildExtractionPlan(
  categories: CategoryDefinition[],
  targetKey: string,
): ExtractionPlan {
  const byKey = new Map<string, PlannedField>();
  const warnings: string[] = [];
  for (const category of categories) {
    for (const field of category.template.fields) {
      const existing = byKey.get(field.key);
      if (!existing) {
        byKey.set(field.key, { ...field, categories: [category.id] });
        continue;
      }
      existing.categories.push(category.id);
      if (existing.type !== field.type) {
        warnings.push(
          `Field "${field.key}" is a ${existing.type} in ${existing.categories[0]} but a ${field.type} in ${category.id}; extracted as ${existing.type}`,
        );
        continue;
      }
      existing.required ||= field.required;
      if (!existing.description && field.description)
        existing.description = field.description;
      existing.unit ??= field.unit;
      if (field.options)
        existing.options = [
          ...new Set([...(existing.options ?? []), ...field.options]),
        ];
    }
  }
  // The common record: asked of every document, unless a template already
  // asks for the same fact under one of its aliases.
  for (const core of CORE_FIELDS)
    if (!coreFieldKey(core, byKey.keys()))
      byKey.set(core.key, {
        key: core.key,
        label: core.label,
        type: core.type,
        description: core.description,
        required: false,
        categories: [],
      });
  return {
    fields: orderFieldKeys([...byKey.keys()]).map((key) => byKey.get(key)!),
    target: findTarget(targetKey) ?? findTarget(GENERAL_TARGET_KEY)!,
    warnings,
  };
}

/**
 * Turns the model's answer into the stored result: every planned field is
 * present, values are validated, and anything missing, unreadable or
 * contradictory is kept as such (never filled in) and listed in `warnings`.
 */
export function buildExtractedFields(
  plan: ExtractionPlan,
  reported: RawFieldResult[],
): ExtractedFields {
  const warnings = [...plan.warnings];
  const fields: Record<string, ExtractedField> = {};
  for (const field of plan.fields) {
    const answer = reported.find((item) => item.key === field.key);
    const base = {
      label: field.label,
      type: field.type,
      required: field.required,
      categories: field.categories,
      ...(field.unit ? { unit: field.unit } : {}),
    };
    if (!answer) {
      fields[field.key] = {
        ...base,
        value: null,
        status: 'missing',
        note: 'Not reported by the model',
      };
    } else if (answer.status === 'found') {
      const normalized = normalizeFieldValue(field, answer.value ?? '');
      fields[field.key] = normalized.ok
        ? {
            ...base,
            value: normalized.value,
            status: 'found',
            ...(answer.value?.trim() !== String(normalized.value)
              ? { raw: answer.value }
              : {}),
            note: answer.note,
          }
        : {
            ...base,
            value: null,
            status: 'invalid',
            raw: answer.value,
            note: normalized.reason,
          };
    } else {
      fields[field.key] = {
        ...base,
        value: null,
        status: answer.status,
        ...(answer.candidates.length ? { candidates: answer.candidates } : {}),
        note: answer.note,
      };
    }
    const saved = fields[field.key];
    if (saved.status === 'conflicting' || saved.status === 'ambiguous')
      warnings.push(
        `${field.label}: ${saved.status}${saved.candidates?.length ? ` (${saved.candidates.join(' / ')})` : ''}`,
      );
    else if (saved.status === 'invalid')
      warnings.push(`${field.label}: "${saved.raw}" ${saved.note}`);
    else if (field.required && saved.status !== 'found')
      warnings.push(`${field.label} is required but ${saved.status}`);
  }
  return { fields, warnings };
}

/**
 * Combines the fields read from several chunks of one long document. A value
 * found in one chunk wins over "missing" in the others; different values
 * become a conflict to review rather than a silent choice.
 */
export function mergeChunkResults(
  chunks: RawFieldResult[][],
): RawFieldResult[] {
  const keys = [...new Set(chunks.flat().map((item) => item.key))];
  return keys.map((key) => {
    const answers = chunks.flatMap((chunk) =>
      chunk.filter((item) => item.key === key),
    );
    const found = answers.filter(
      (item) => item.status === 'found' && item.value?.trim(),
    );
    const distinct = [
      ...new Map(
        found.map((item) => [
          item.value!.trim().toLowerCase(),
          item.value!.trim(),
        ]),
      ).values(),
    ];
    if (distinct.length === 1)
      return {
        key,
        status: 'found',
        value: distinct[0],
        candidates: [],
        note: null,
      };
    if (distinct.length > 1)
      return {
        key,
        status: 'conflicting',
        value: null,
        candidates: distinct,
        note: 'Different parts of the document give different values',
      };
    const notMissing = answers.find((item) => item.status !== 'missing');
    return (
      notMissing ?? {
        key,
        status: 'missing',
        value: null,
        candidates: [],
        note: null,
      }
    );
  });
}

/** Splits long text into chunks at paragraph, then line, boundaries. */
export function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = window.lastIndexOf('\n\n');
    if (cut < maxChars / 2) cut = window.lastIndexOf('\n');
    if (cut < maxChars / 2) cut = maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * The record details of a general document, made to agree with the template
 * fields read from the same document. The amount the review shows and the
 * amount Bills counts must be one number: the focused `total_amount` field
 * (the total to pay, read as printed) wins over the details' "main amount",
 * which a model can take from any line. Its date, issuer and currency fill
 * gaps only. Other targets keep their details as they are.
 */
export function alignDetails(
  targetKey: string | null,
  details: unknown,
  extracted: ExtractedFields,
): unknown {
  if (targetKey !== GENERAL_TARGET_KEY) return details;
  if (typeof details !== 'object' || details === null) return details;
  const found = (key: string) => {
    const field = extracted.fields[key];
    return field?.status === 'found' ? field.value : null;
  };
  const core = (key: string) => {
    const field = CORE_FIELDS.find((candidate) => candidate.key === key)!;
    for (const name of [field.key, ...field.aliases]) {
      const value = found(name);
      if (value !== null) return value;
    }
    return null;
  };
  const record = { ...(details as Record<string, unknown>) };
  const total = core('total_amount');
  if (typeof total === 'number') record['amount'] = total;
  const fillIn = (target: string, key: string) => {
    if (record[target] !== undefined && record[target] !== '') return;
    const value = core(key);
    if (typeof value === 'string' && value) record[target] = value;
  };
  fillIn('currency', 'currency');
  fillIn('issuer', 'issuer');
  fillIn('date', 'issue_date');
  return record;
}
