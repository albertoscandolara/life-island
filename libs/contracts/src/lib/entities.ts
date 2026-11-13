// ---------------------------------------------------------------------------
// Entities: the things documents talk about (people, houses, cars, companies,
// workplaces), each owned by one area and shown everywhere by the same link.
//
// Every area that owns entities publishes them at `GET /entities` (as every
// area publishes its dates at `GET /deadlines`). A page that names one, by id
// when it has it or by the name printed on a document, resolves it through
// that directory and links it to the entity's own page. An entity a document
// suggested and you have not confirmed yet is `pending`: it is shown as such
// and links to where you confirm it, never to a page of its own.

/** The kinds of entity, each owned by one area. */
export const ENTITY_KINDS = [
  'person',
  'house',
  'vehicle',
  'organization',
  'workplace',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: 'Person',
  house: 'House',
  vehicle: 'Car',
  organization: 'Company',
  workplace: 'Workplace',
};

/**
 * confirmed: you approved it (or created it), and it has a page. pending: a
 * document suggested it, and it waits for you to confirm it.
 */
export const ENTITY_STATUSES = ['confirmed', 'pending'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/** One entity as every page shows it: a name that links to its page. */
export interface EntityRefDto {
  kind: EntityKind;
  /** Its id in the owning area; for a pending one, the id of the suggestion. */
  id: string;
  name: string;
  status: EntityStatus;
  /** One line under the name: an address, a plate, a tax code. */
  detail: string | null;
  /**
   * Other ways documents print it, so a name read from a document finds it:
   * a tax code, a plate, an address, a document category, a former name.
   */
  aliases: string[];
}

/** The areas that publish `GET /entities`, through the gateway. */
export const ENTITY_DIRECTORY_SOURCES = [
  '/api/people/entities',
  '/api/home/entities',
  '/api/cars/entities',
  '/api/work/entities',
] as const;

/** Where each kind lives: its own page, and where its suggestions are confirmed. */
const ENTITY_ROUTES: Record<
  EntityKind,
  { page: string; param: string; confirm: string }
> = {
  person: { page: '/people', param: 'person', confirm: '/people' },
  house: { page: '/home', param: 'houses', confirm: '/home' },
  vehicle: { page: '/cars', param: 'car', confirm: '/cars' },
  organization: {
    page: '/home/companies',
    param: 'company',
    confirm: '/home/companies',
  },
  workplace: { page: '/work', param: 'workplace', confirm: '/work' },
};

/** The page of an entity (in the Life Island app), with the query that opens it. */
export function entityLink(ref: Pick<EntityRefDto, 'kind' | 'id' | 'status'>): {
  path: string;
  query: Record<string, string>;
} {
  const route = ENTITY_ROUTES[ref.kind];
  return ref.status === 'confirmed'
    ? { path: route.page, query: { [route.param]: ref.id } }
    : { path: route.confirm, query: { review: 'entities' } };
}

/** The same link as one URL path: `/home?houses=<id>`. */
export function entityPath(
  ref: Pick<EntityRefDto, 'kind' | 'id' | 'status'>,
): string {
  const { path, query } = entityLink(ref);
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/** The query param each kind's page reads to open one entity. */
export function entityParam(kind: EntityKind): string {
  return ENTITY_ROUTES[kind].param;
}

const LEGAL_FORMS = new Set([
  'spa',
  'srl',
  'srls',
  'snc',
  'sas',
  'sapa',
  'scarl',
  'scrl',
  'coop',
  'ltd',
  'inc',
  'gmbh',
  'ag',
  'sa',
]);

/**
 * A name as every area compares it: no case, accents, punctuation or legal
 * form, and nothing after the legal form ("EDILRENSO SNC DI RENSO MASSIMO E
 * C." = "Edilrenso"; "Banca Widiba S.p.A." = "Banca Widiba"). Category ids
 * read the same way: VIA_PONZILOVO_9 = "Via Ponzilovo 9".
 */
export function entityKey(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "S.p.A." and "s.r.l." are one word each, before punctuation goes.
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const cut = words.findIndex((word, i) => i > 0 && LEGAL_FORMS.has(word));
  const kept = cut > 0 ? words.slice(0, cut) : words;
  return kept.join(' ');
}

/** An Italian plate (AB123CD), or another short code of letters and digits. */
const PLATE = /^[a-z]{2}\d{3}[a-z]{2}$/;

/**
 * The entity a text names: one whose name or alias reads the same, or, for a
 * car, whose plate the text contains ("Fiat Punto EJ560PZ"). A text that
 * would fit two entities finds none: a guess would link the wrong page.
 */
export function findEntity(
  text: string | null | undefined,
  entities: readonly EntityRefDto[],
  kind?: EntityKind | readonly EntityKind[],
): EntityRefDto | null {
  if (!text) return null;
  const key = entityKey(text);
  if (!key) return null;
  const kinds = kind === undefined ? null : ([] as EntityKind[]).concat(kind);
  const candidates = kinds
    ? entities.filter((e) => kinds.includes(e.kind))
    : entities;
  const exact = unique(
    candidates.filter((e) =>
      [e.name, ...e.aliases].some((name) => entityKey(name) === key),
    ),
  );
  if (exact !== undefined) return exact;
  const words = new Set(key.split(' '));
  return (
    unique(
      candidates.filter(
        (e) =>
          e.kind === 'vehicle' &&
          e.aliases.some((alias) => {
            const plate = entityKey(alias).replace(/ /g, '');
            return PLATE.test(plate) && words.has(plate);
          }),
      ),
    ) ?? null
  );
}

/**
 * The one entity of a list (the same entity listed twice counts once);
 * null when several different ones; undefined when none.
 */
function unique(
  found: readonly EntityRefDto[],
): EntityRefDto | null | undefined {
  if (!found.length) return undefined;
  const first = found[0];
  if (found.every((e) => e.kind === first.kind && e.id === first.id))
    return first;
  // A confirmed entity wins over pending suggestions of the same name.
  const confirmed = found.filter((e) => e.status === 'confirmed');
  return confirmed.length === 1 ? confirmed[0] : null;
}

/** Drops empty aliases, the name itself and repeats (as `entityKey` reads them). */
export function cleanAliases(
  name: string,
  aliases: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set([entityKey(name)]);
  const out: string[] = [];
  for (const alias of aliases) {
    const key = alias ? entityKey(alias) : '';
    if (!alias || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}
