import {
  CATEGORY_ID_PATTERN,
  templateFieldSchema,
  type CategoryTemplate,
  type TemplateField,
} from '@life-island/contracts';
import type {
  CategoryDefinition,
  ProposedCategory,
} from './parsers/document-parser.js';

/** `Electricity bill` → `ELECTRICITY_BILL`; null when nothing usable is left. */
export function normalizeCategoryId(raw: string): string | null {
  const id = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return CATEGORY_ID_PATTERN.test(id) ? id : null;
}

/** A loose key to catch near-duplicates: `BILLS`, `BILL` and `Bill` all match. */
function looseKey(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/IES$/, 'Y')
    .replace(/(?<!S)S$/, '');
}

/** Keeps the valid fields of a proposed template, dropping duplicates and broken ones. */
export function cleanTemplate(template: {
  fields: unknown[];
}): CategoryTemplate {
  const fields: TemplateField[] = [];
  for (const candidate of template.fields ?? []) {
    const parsed = templateFieldSchema.safeParse(candidate);
    if (
      parsed.success &&
      !fields.some((field) => field.key === parsed.data.key)
    )
      fields.push(parsed.data);
  }
  return { fields: fields.slice(0, 40) };
}

export interface DiscoveryFilterContext {
  categories: CategoryDefinition[];
  pending: CategoryDefinition[];
  rejectedIds: string[];
}

export interface DiscoveryFilterResult {
  accepted: ProposedCategory[];
  dropped: { id: string; reason: string }[];
}

/**
 * The server-side guard on what the model proposes: ids are normalized,
 * anything that matches an existing category (by id, loosely, or by title)
 * or one you rejected is dropped, and a proposal that matches a pending
 * suggestion reuses its id, so the two documents share one suggestion.
 */
export function filterSuggestions(
  proposed: ProposedCategory[],
  context: DiscoveryFilterContext,
): DiscoveryFilterResult {
  const accepted: ProposedCategory[] = [];
  const dropped: DiscoveryFilterResult['dropped'] = [];
  const existing = context.categories.map((category) => ({
    id: category.id,
    keys: [looseKey(category.id), looseKey(category.title)],
  }));
  const rejected = new Set(context.rejectedIds.map(looseKey));

  for (const suggestion of proposed) {
    const id = normalizeCategoryId(suggestion.id);
    if (!id) {
      dropped.push({ id: suggestion.id, reason: 'invalid id' });
      continue;
    }
    const keys = [looseKey(id), looseKey(suggestion.title)];
    const match = existing.find((category) =>
      category.keys.some((key) => keys.includes(key)),
    );
    if (match) {
      dropped.push({ id, reason: `already exists as ${match.id}` });
      continue;
    }
    if (rejected.has(looseKey(id))) {
      dropped.push({ id, reason: 'rejected before' });
      continue;
    }
    const pending = context.pending.find(
      (candidate) =>
        looseKey(candidate.id) === keys[0] ||
        looseKey(candidate.title) === keys[1],
    );
    const finalId = pending?.id ?? id;
    if (
      accepted.some(
        (item) =>
          looseKey(item.id) === looseKey(finalId) ||
          looseKey(item.title) === keys[1],
      )
    ) {
      dropped.push({ id, reason: 'proposed twice' });
      continue;
    }
    accepted.push({
      id: finalId,
      title: (pending?.title ?? suggestion.title).trim().slice(0, 100),
      description: (pending?.description ?? suggestion.description)
        .trim()
        .slice(0, 1000),
      template: pending?.template ?? cleanTemplate(suggestion.template),
      reason: suggestion.reason.trim().slice(0, 1000),
    });
  }
  return { accepted, dropped };
}
