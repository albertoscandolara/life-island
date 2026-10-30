import {
  normalizeFieldValue,
  type CategoryTemplate,
  type ExtractedField,
  type ExtractedFields,
  type TemplateField,
} from '@life-island/contracts';

/** A field's warnings start with its label: "Total amount: conflicting", "Total amount is required but missing". */
function withoutWarningsFor(warnings: string[], label: string): string[] {
  return warnings.filter(
    (warning) =>
      !warning.startsWith(`${label}:`) &&
      !warning.startsWith(`${label} is required`),
  );
}

export class FieldEditError extends Error {}

/**
 * Applies your values to extracted fields. A value is checked against the
 * field's type like the parser's are, and stored as found, with the parser's
 * reading kept in `raw`; null clears the field. `templates` are the template
 * fields of the document's categories, for enum options and patterns. Throws
 * FieldEditError for an unknown key or a value that does not fit.
 */
export function editFieldValues(
  extracted: ExtractedFields | null,
  values: Record<string, string | number | boolean | null>,
  templates: TemplateField[] = [],
  now = new Date(),
): ExtractedFields {
  if (!extracted)
    throw new FieldEditError(
      'The fields of this document have not been extracted yet',
    );
  const fields = { ...extracted.fields };
  let warnings = [...extracted.warnings];
  for (const [key, input] of Object.entries(values)) {
    const field = fields[key];
    if (!field) throw new FieldEditError(`This document has no field "${key}"`);
    const parserReading =
      field.editedAt !== undefined && field.editedAt !== null
        ? (field.raw ?? null)
        : (field.raw ?? (field.value === null ? null : String(field.value)));
    warnings = withoutWarningsFor(warnings, field.label);
    let next: ExtractedField;
    if (input === null || input === '') {
      next = {
        ...field,
        value: null,
        status: 'missing',
        raw: parserReading,
        candidates: [],
        note: 'Cleared by you',
        editedAt: now.toISOString(),
      };
      if (field.required)
        warnings.push(`${field.label} is required but missing`);
    } else {
      const template = templates.find((candidate) => candidate.key === key);
      const normalized = normalizeFieldValue(
        {
          type: field.type,
          options: template?.options,
          pattern: template?.pattern,
        },
        String(input),
      );
      if (!normalized.ok)
        throw new FieldEditError(`${field.label}: ${normalized.reason}`);
      next = {
        ...field,
        value: normalized.value,
        status: 'found',
        raw: parserReading,
        candidates: [],
        note: 'Edited by you',
        editedAt: now.toISOString(),
      };
    }
    fields[key] = next;
  }
  return { fields, warnings };
}

/**
 * Keeps the extracted fields in line with the document's categories after
 * you change them: a new category's template fields are added as missing
 * (for you to fill in, or for a later re-extraction), and fields that no
 * remaining category asks for are dropped unless they hold a value.
 */
export function syncTemplateFields(
  extracted: ExtractedFields | null,
  categories: { id: string; template: CategoryTemplate }[],
): ExtractedFields | null {
  if (!extracted) return null;
  const fields: Record<string, ExtractedField> = {};
  const assigned = new Set(categories.map((category) => category.id));
  for (const [key, field] of Object.entries(extracted.fields)) {
    const remaining = field.categories.filter((id) => assigned.has(id));
    if (remaining.length || field.value !== null)
      fields[key] = { ...field, categories: remaining };
  }
  for (const category of categories) {
    for (const templateField of category.template.fields) {
      const existing = fields[templateField.key];
      if (existing) {
        if (!existing.categories.includes(category.id))
          existing.categories = [...existing.categories, category.id];
        existing.required = existing.required || templateField.required;
        continue;
      }
      fields[templateField.key] = {
        label: templateField.label,
        type: templateField.type,
        value: null,
        status: 'missing',
        note: `Added with ${category.id}; not read from the document yet`,
        ...(templateField.unit ? { unit: templateField.unit } : {}),
        required: templateField.required,
        categories: [category.id],
      };
    }
  }
  const labels = new Set(Object.values(fields).map((field) => field.label));
  const warnings = extracted.warnings.filter(
    (warning) =>
      [...labels].some((label) => warning.startsWith(label)) ||
      !Object.values(extracted.fields).some((field) =>
        warning.startsWith(field.label),
      ),
  );
  return { fields, warnings };
}
