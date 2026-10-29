import {
  findTarget,
  GENERAL_TARGET_KEY,
  type ExtractedField,
  type ExtractedFields,
  type FieldStatus,
  type TargetDefinition,
  type TemplateField,
} from '@life-island/contracts';
import type { CategoryDefinition } from './parsers/document-parser.js';

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
  return {
    fields: [...byKey.values()],
    target: findTarget(targetKey) ?? findTarget(GENERAL_TARGET_KEY)!,
    warnings,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Reads `1.234,56`, `1,234.56`, `12,5` or `€ 7.47` as a number. */
export function parseNumber(raw: string): number | null {
  let text = raw.replace(/[^\d,.\-+]/g, '');
  if (!/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one.
    text =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    const commas = text.split(',').length - 1;
    text =
      commas === 1 && decimals !== 3
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
  } else if ((text.match(/\./g) ?? []).length > 1) {
    text = text.replace(/\./g, '');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

type Normalized =
  | { ok: true; value: string | number | boolean }
  | { ok: false; reason: string };

/**
 * Checks a value the model read against the field's type and returns it in a
 * standard format (ISO dates, numbers, upper-case currency codes). A value
 * that does not fit is never coerced into something it does not say.
 */
export function normalizeFieldValue(
  field: {
    type: TemplateField['type'];
    options?: readonly string[];
    pattern?: string;
  },
  raw: string,
): Normalized {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty value' };
  let result: Normalized;
  switch (field.type) {
    case 'string':
    case 'text':
      result = { ok: true, value: text };
      break;
    case 'number':
    case 'amount':
    case 'integer': {
      const value = parseNumber(text);
      if (value === null) return { ok: false, reason: 'not a number' };
      if (field.type === 'integer' && !Number.isInteger(value))
        return { ok: false, reason: 'not a whole number' };
      if (field.type === 'amount' && Math.round(value * 100) !== value * 100)
        return { ok: false, reason: 'more than two decimals for an amount' };
      result = { ok: true, value };
      break;
    }
    case 'currency': {
      const code = text.toUpperCase();
      const symbols: Record<string, string> = {
        '€': 'EUR',
        $: 'USD',
        '£': 'GBP',
      };
      const value = symbols[code] ?? code;
      if (!/^[A-Z]{3}$/.test(value))
        return { ok: false, reason: 'not an ISO 4217 currency code' };
      result = { ok: true, value };
      break;
    }
    case 'date':
      if (!isRealDate(text))
        return { ok: false, reason: 'expected YYYY-MM-DD' };
      result = { ok: true, value: text };
      break;
    case 'datetime': {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(
          text,
        ) ||
        !isRealDate(text.slice(0, 10))
      )
        return { ok: false, reason: 'expected an ISO 8601 date and time' };
      result = { ok: true, value: text };
      break;
    }
    case 'period': {
      const [from, to, extra] = text.split('/');
      if (
        extra !== undefined ||
        !isRealDate(from ?? '') ||
        !isRealDate(to ?? '')
      )
        return { ok: false, reason: 'expected YYYY-MM-DD/YYYY-MM-DD' };
      if (from > to)
        return { ok: false, reason: 'the period ends before it starts' };
      result = { ok: true, value: text };
      break;
    }
    case 'boolean': {
      const lower = text.toLowerCase();
      if (['true', 'yes', 'si', 'sì'].includes(lower))
        result = { ok: true, value: true };
      else if (['false', 'no'].includes(lower))
        result = { ok: true, value: false };
      else return { ok: false, reason: 'expected true or false' };
      break;
    }
    case 'enum': {
      const option = field.options?.find(
        (candidate) => candidate.toLowerCase() === text.toLowerCase(),
      );
      if (!option)
        return {
          ok: false,
          reason: `not one of ${(field.options ?? []).join(', ')}`,
        };
      result = { ok: true, value: option };
      break;
    }
  }
  if (field.pattern && typeof result.value === 'string') {
    const compact = result.value.replace(/\s+/g, '');
    if (!new RegExp(field.pattern).test(compact))
      return { ok: false, reason: 'does not match the expected format' };
    result = { ok: true, value: compact };
  }
  return result;
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
