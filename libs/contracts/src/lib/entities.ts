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

/** How close two names are, from the same to unrelated. */
export type NameMatch = 'same' | 'compact' | 'street' | 'similar';

/** The tiers a name is matched in, the strictest first. */
const TIERS: readonly NameMatch[] = ['same', 'compact', 'street', 'similar'];

/** Street words documents abbreviate: "V.le" is "viale", "P.zza" is "piazza". */
const STREET_WORDS: [RegExp, string][] = [
  [/^\s*v\.?\s*le\b\.?/i, 'viale '],
  [/^\s*p\.?\s*zz?a\b\.?/i, 'piazza '],
  [/^\s*p\.?\s*(zz)?le\b\.?/i, 'piazzale '],
  [/^\s*c\.?\s*so\b\.?/i, 'corso '],
  [/^\s*v\.?\s*lo\b\.?/i, 'vicolo '],
  [/^\s*loc\b\.?/i, 'localita '],
  [/^\s*fraz\b\.?/i, 'frazione '],
  [/^\s*v\.\s*/i, 'via '],
];

/** A house number, with its letter or interior: 9, 10a, 12/b, snc, n 9. */
const NUMBER = /^(\d+[a-z]?|snc|sn|n|nr|civ|int|bis|ter)$/;

/**
 * An address without its house number, with street words written out:
 * "Via dei Bandi, 9", "via dei Bandi" and "V. dei Bandi 10/a" all read
 * "via dei bandi". Null when nothing is left.
 */
export function streetKey(text: string): string | null {
  const parts = streetParts(text);
  return parts ? parts.street : null;
}

/** An address as its street and its house number (null when not printed). */
function streetParts(
  text: string,
): { street: string; number: string | null } | null {
  let written = text;
  for (const [pattern, word] of STREET_WORDS)
    if (pattern.test(written)) {
      written = written.replace(pattern, word);
      break;
    }
  const words = entityKey(written).split(' ').filter(Boolean);
  const number: string[] = [];
  while (words.length > 1 && NUMBER.test(words[words.length - 1]))
    number.unshift(words.pop() as string);
  // "Via Roma 5 a" and "Via Roma 5/b" leave a lone letter after the number.
  while (
    words.length > 2 &&
    words[words.length - 1].length === 1 &&
    /\d/.test(words[words.length - 2])
  )
    number.unshift(...words.splice(-2, 2));
  const digits = number.join('').replace(/\D/g, '');
  return words.length
    ? { street: words.join(' '), number: digits || null }
    : null;
}

const STREET =
  /^(via|viale|piazza|piazzale|corso|vicolo|strada|largo|localita|contrada|frazione|borgo)\b/;

/** Letters changed, added or removed to turn one text into the other. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}

/** Typos a name may have and still be the same: none below 6 letters, then 1, then 2 from 12. */
function typosAllowed(length: number): number {
  return length >= 12 ? 2 : length >= 6 ? 1 : 0;
}

/**
 * How two names compare, or null when they are not the same thing:
 * - same: equal once case, accents, punctuation and legal form are gone
 *   ("Arcoda" = "ARCODA S.R.L.");
 * - compact: equal once spaces go too ("Banca Widiba" = "BancaWidiba",
 *   "EJ 560 PZ" = "EJ560PZ");
 * - street: the same street, with or without its number ("Via dei Bandi" =
 *   "via dei Bandi, 9"), for addresses only;
 * - similar: one or two letters apart in a long enough name ("Elektrosistem"
 *   = "Elektrosystem"). Numbers must match exactly: "Via Roma 5" is not
 *   "Via Roma 6" by typo.
 */
export function compareNames(a: string, b: string): NameMatch | null {
  const ka = entityKey(a);
  const kb = entityKey(b);
  if (!ka || !kb) return null;
  if (ka === kb) return 'same';
  const ca = ka.replace(/ /g, '');
  const cb = kb.replace(/ /g, '');
  if (ca === cb) return 'compact';
  const sa = streetParts(a);
  const sb = streetParts(b);
  if (
    sa &&
    sb &&
    sa.street === sb.street &&
    STREET.test(sa.street) &&
    sa.street.includes(' ') &&
    // "Via Roma" is "Via Roma 5"; "Via Roma 5" is not "Via Roma 6".
    (!sa.number || !sb.number || sa.number === sb.number)
  )
    return 'street';
  const digits = (k: string) => k.replace(/\D/g, '');
  if (digits(ca) !== digits(cb)) return null;
  const allowed = typosAllowed(Math.min(ca.length, cb.length));
  if (allowed && Math.abs(ca.length - cb.length) <= allowed)
    if (editDistance(ca, cb) <= allowed) return 'similar';
  return null;
}

/** Whether two names stand for the same thing, however slightly they differ. */
export function sameName(a: string, b: string): boolean {
  return compareNames(a, b) !== null;
}

/**
 * The one candidate a text names, in the strictest tier that finds any: a
 * text two candidates fit equally well finds none, since a guess would pick
 * the wrong one. `prefer` breaks a tie (a confirmed entity over pending ones).
 */
export function matchName<T>(
  text: string | null | undefined,
  candidates: readonly T[],
  names: (candidate: T) => readonly string[],
  options: {
    same?: (a: T, b: T) => boolean;
    prefer?: (candidate: T) => boolean;
  } = {},
): { found: T; how: NameMatch } | null {
  if (!text || !entityKey(text)) return null;
  const same = options.same ?? ((a: T, b: T) => a === b);
  for (const tier of TIERS) {
    const hits = candidates.filter((c) =>
      names(c).some((name) => compareNames(text, name) === tier),
    );
    if (!hits.length) continue;
    if (hits.every((h) => same(h, hits[0])))
      return { found: hits[0], how: tier };
    const preferred = options.prefer ? hits.filter(options.prefer) : [];
    if (preferred.length && preferred.every((h) => same(h, preferred[0])))
      return { found: preferred[0], how: tier };
    return null;
  }
  return null;
}

/**
 * The entity a text names: one whose name or alias reads the same (case,
 * accents, punctuation, legal form, spacing, a street's number and a typo
 * or two do not count), or, for a car, whose plate the text contains
 * ("Fiat Punto EJ560PZ"). A text that fits two entities finds none.
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
  const sameEntity = (a: EntityRefDto, b: EntityRefDto) =>
    a.kind === b.kind && a.id === b.id;
  const matched = matchName(text, candidates, (e) => [e.name, ...e.aliases], {
    same: sameEntity,
    prefer: (e) => e.status === 'confirmed',
  });
  if (matched) return matched.found;
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
