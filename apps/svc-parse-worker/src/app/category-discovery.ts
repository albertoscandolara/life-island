import {
  CATEGORY_DIMENSIONS,
  CATEGORY_ID_PATTERN,
  namesVehicle,
  samePlace,
  templateFieldSchema,
  type CategoryDimension,
  type CategoryTemplate,
  type TemplateField,
} from '@life-island/contracts';
import type {
  CategoryDefinition,
  DiscoveryContext,
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

/**
 * Where a proposal goes: under an existing category (taking its dimension,
 * as every subcategory does), or at the top level in the dimension it
 * names. An unknown parent or dimension is dropped, never invented.
 */
function placementOf(
  proposal: Pick<CategoryDefinition, 'parentId' | 'dimension'>,
  categories: CategoryDefinition[],
  id: string,
): { parentId: string | null; dimension: CategoryDimension | null } {
  const parentId = proposal.parentId
    ? normalizeCategoryId(proposal.parentId)
    : null;
  const parent =
    parentId && parentId !== id
      ? categories.find((category) => category.id === parentId)
      : undefined;
  if (parent)
    return { parentId: parent.id, dimension: parent.dimension ?? null };
  const dimension = (CATEGORY_DIMENSIONS as readonly string[]).includes(
    proposal.dimension ?? '',
  )
    ? (proposal.dimension as CategoryDimension)
    : null;
  return { parentId: null, dimension };
}

/** Legal forms that are not part of a company's name: `S.p.A.`, `S.c.a r.l.`, `GmbH`... */
const LEGAL_FORMS = new Set(
  'SPA SRL SRLS SAPA SCARL SCRL SCPA SC SNC SAS SS COOP ONLUS SA AG GMBH LTD LLC INC PLC BV NV SL SARL'.split(
    ' ',
  ),
);

/** `Acque Veronesi S.c.a r.l.` → `Acque Veronesi`: the name without its legal form. */
export function issuerName(printed: string): string {
  const words = printed
    .trim()
    .replace(/[\s,;]+$/, '')
    .split(/\s+/);
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    for (let take = Math.min(4, words.length - 1); take >= 1; take--) {
      const tail = words
        .slice(-take)
        .join('')
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
      if (LEGAL_FORMS.has(tail)) {
        words.splice(-take);
        changed = true;
        break;
      }
    }
  }
  return words.join(' ').replace(/[\s,;.-]+$/, '');
}

/**
 * The safety net for the issuer (the ENEL / ACQUE_VERONESI case): when the
 * classifier read who issued the document, none of its categories is an
 * issuer and the model proposed none, the issuer is proposed anyway, as an
 * ISSUER category named as printed. filterSuggestions still drops it when it
 * exists already (by id or title) or you rejected it.
 */
export function withIssuerFallback(
  proposed: ProposedCategory[],
  context: Pick<DiscoveryContext, 'categories' | 'analysis' | 'assignedIds'>,
): ProposedCategory[] {
  const printed = context.analysis.issuer?.trim();
  if (!printed) return proposed;
  const assignedIssuer = context.categories.some(
    (category) =>
      category.dimension === 'ISSUER' &&
      context.assignedIds.includes(category.id),
  );
  if (assignedIssuer || proposed.some((item) => item.dimension === 'ISSUER'))
    return proposed;
  const title = issuerName(printed).slice(0, 100);
  const id = normalizeCategoryId(title);
  if (!id) return proposed;
  return [
    ...proposed,
    {
      id,
      title,
      description: `Documents issued by ${title}.`,
      reason: `The document is issued by ${printed}`,
      dimension: 'ISSUER',
      parentId: null,
      template: {
        fields: [
          {
            key: 'customer_id',
            label: 'Customer or account id',
            type: 'string',
            description: `Your customer, contract or account code with ${title}`,
            required: false,
          },
        ],
      },
    },
  ];
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
    let placement = placementOf(
      pending?.parentId || pending?.dimension ? pending : suggestion,
      context.categories,
      finalId,
    );
    if (placement.dimension === 'PROPERTY') {
      // "Via Ponzilovo" when "Via Ponzilovo 9" exists: one place, not two.
      const place = context.categories.find(
        (category) =>
          category.dimension === 'PROPERTY' &&
          samePlace(category.title, suggestion.title),
      );
      if (place) {
        dropped.push({ id, reason: `the same place as ${place.id}` });
        continue;
      }
      // A car is never a place: its plate files it under SUBJECT.
      if (!placement.parentId && namesVehicle({ id, title: suggestion.title }))
        placement = { parentId: null, dimension: 'SUBJECT' };
    }
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
      ...placement,
    });
  }
  return { accepted, dropped };
}
