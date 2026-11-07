import {
  HOUSE_FIELDS,
  type HouseField,
  type HouseProposedChangeDto,
  type PropertyDto,
  type UtilityKind,
} from '@life-island/contracts';
import {
  billingPeriod,
  matchProperty,
  normalizeCode,
  normalizeText,
  toNumber,
  utilityOf,
  type DocumentLike,
  type OverrideLike,
  type ParentOf,
  type PropertyLike,
} from '../bills/bill-reader.js';

/** The house data that is one value (the others, supply codes and owners, add to a list). */
export type HouseScalarField = Exclude<HouseField, 'supplyCodes' | 'owners'>;

const NUMBER_FIELDS: ReadonlySet<HouseField> = new Set([
  'areaSqm',
  'rooms',
  'cadastralIncome',
]);

const SUPPLIER_OF: Record<UtilityKind, HouseScalarField> = {
  ELECTRICITY: 'electricitySupplier',
  GAS: 'gasSupplier',
  WATER: 'waterSupplier',
};

export interface ParsedAddress {
  /** Street and number, e.g. "Via dei Bandi 10". */
  street: string;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}

/** What one document says about a house. */
export interface HouseReading {
  uploadId: string;
  title: string;
  uploadedAt: string;
  /** The day it speaks of: its billing period end, issue date, else its upload. */
  day: string;
  /** The house it is about (your manual choice for a bill wins), null when none matches. */
  propertyId: string | null;
  /** The utility, for a bill: its supplier is taken only from the newest bill. */
  utility: UtilityKind | null;
  address: ParsedAddress | null;
  values: Partial<Record<HouseScalarField, string>>;
  supplyCodes: string[];
  owners: string[];
}

type Fields = NonNullable<DocumentLike['fields']>;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ')
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : null;

/** Words kept lower case inside an Italian place name ("Via dei Bandi"). */
const PARTICLES = new Set([
  'di',
  'de',
  'dei',
  'del',
  'della',
  'delle',
  'dello',
  'degli',
  'da',
  'al',
  'alla',
  'alle',
  'e',
  'in',
  'sul',
  'sulla',
]);

/** "VIA DEI BANDI" → "Via dei Bandi", "RONCO ALL'ADIGE" → "Ronco all'Adige"; mixed case is kept. */
export function tidyName(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (i > 0 && PARTICLES.has(word)) return word;
      const apostrophe = /^([a-z]+')(.+)$/.exec(word);
      if (apostrophe)
        return (
          (i > 0 ? apostrophe[1] : cap(apostrophe[1])) + cap(apostrophe[2])
        );
      return cap(word);
    })
    .join(' ');
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Splits an address printed on one line: "Via dei Bandi 10, 37039 Tregnago
 * (VR)", "VIA PONZILOVO 9 - 37055 RONCO ALL'ADIGE VR". Null when it does not
 * look like a street (a passport prints only the town).
 */
export function parseAddress(value: string): ParsedAddress | null {
  const clean = value.replace(/\s+/g, ' ').trim();
  const cap = /\b(\d{5})\b/.exec(clean);
  let street = clean;
  let rest = '';
  if (cap) {
    street = clean.slice(0, cap.index);
    rest = clean.slice(cap.index + cap[0].length);
  } else {
    const comma = clean.indexOf(',');
    // "Via Roma, 5, Verona": the number may follow the first comma.
    const parts = comma > 0 ? clean.split(',').map((p) => p.trim()) : [clean];
    const numberPart = parts.length > 1 && /^\d+[a-z]?$/i.test(parts[1]);
    street = numberPart ? `${parts[0]} ${parts[1]}` : parts[0];
    rest = parts.slice(numberPart ? 2 : 1).join(', ');
  }
  street = street
    .replace(/[\s,\-–]+$/, '')
    .replace(/,\s*(\d+[a-z]?)$/i, ' $1')
    .replace(/\s+n(r|\.)?\s*(?=\d)/i, ' ')
    .trim();
  let province: string | null = null;
  const prov = /\(([A-Za-z]{2})\)|(?:^|\s)([A-Z]{2})\s*$/.exec(rest);
  if (prov) {
    province = (prov[1] ?? prov[2]).toUpperCase();
    rest = rest.replace(prov[0], ' ');
  }
  const city = rest.replace(/^[\s,\-–]+|[\s,\-–]+$/g, '').trim() || null;
  // A street names a street: letters, and a street word or a number.
  const words = normalizeText(street);
  if (
    street.length < 4 ||
    !/[a-z]{3}/i.test(street) ||
    !(
      /\d/.test(street) ||
      /^(via|viale|piazza|piazzale|corso|vicolo|strada|largo|localita|loc|contrada|frazione)\b/.test(
        words,
      )
    )
  )
    return null;
  return {
    street: tidyName(street),
    postalCode: cap?.[1] ?? null,
    city: city ? tidyName(city) : null,
    province,
  };
}

/** Where the house is: the supply address of a bill, a property's address, a holder's residence. */
const HOUSE_ADDRESS_KEY =
  /^(supply_address|property_address|residence_address|pod_address|pdr_address)$|ubicazione|immobile|fornitura/;
const FIELD_KEYS: [HouseScalarField, RegExp][] = [
  ['areaSqm', /floor_area|surface|superficie|area_sqm|^sqm$|^m2$/],
  ['rooms', /^rooms$|^vani$|consistenza/],
  ['cadastralSheet', /cadastral_sheet|foglio/],
  ['cadastralParcel', /cadastral_parcel|particella|mappale/],
  ['cadastralSubunit', /cadastral_subunit|subalterno/],
  ['cadastralCategory', /cadastral_category|categoria_catastale/],
  ['cadastralIncome', /cadastral_income|rendita/],
  ['condoManager', /condo_manager|amministratore/],
  ['insurer', /^insurer$|insurance_company|compagnia_assicurativa/],
];
const OWNER_KEY = /^owners?(_names?)?$|proprietari|property_owner/;

function firstText(fields: Fields, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(fields[key]);
    if (value) return value;
  }
  return null;
}

/**
 * What a document says about a house, or null when it says nothing: a bill
 * gives the supply address, code and supplier; a cadastral survey or a deed
 * the address, floor area, rooms, cadastral data and owners; an ID document
 * the holder's residence.
 */
export function readHouse(
  document: DocumentLike & { uploadedAt: Date | string },
  properties: readonly PropertyLike[],
  parentOf: ParentOf,
  override: OverrideLike | null,
): HouseReading | null {
  const fields: Fields = document.fields ?? {};
  const utility = override?.excluded
    ? null
    : ((override?.utility as UtilityKind | null) ??
      utilityOf(document.categories, fields, parentOf));

  let address: ParsedAddress | null = null;
  for (const [key, value] of Object.entries(fields)) {
    if (!HOUSE_ADDRESS_KEY.test(key)) continue;
    const printed = text(value);
    address = printed ? parseAddress(printed) : null;
    if (address) break;
  }
  const values: HouseReading['values'] = {};
  if (address) {
    values.address = address.street;
    if (address.postalCode) values.postalCode = address.postalCode;
    if (address.city) values.city = address.city;
    if (address.province) values.province = address.province;
  }
  for (const [field, key] of FIELD_KEYS)
    for (const [name, value] of Object.entries(fields)) {
      if (!key.test(name)) continue;
      const read = NUMBER_FIELDS.has(field)
        ? toNumber(value)?.toString()
        : text(value);
      if (read) {
        values[field] = read;
        break;
      }
    }
  const supplyCodes: string[] = [];
  if (utility) {
    const supplier = firstText(fields, [
      'provider',
      'issuer',
      'supplier',
      'merchant_name',
    ]);
    if (supplier) values[SUPPLIER_OF[utility]] = supplier;
    const code = firstText(fields, ['pod', 'pdr', 'customer_id']);
    if (code) supplyCodes.push(code.replace(/\s+/g, '').toUpperCase());
  }
  const owners = Object.entries(fields)
    .filter(([key]) => OWNER_KEY.test(key))
    .flatMap(([, value]) => (text(value) ?? '').split(/\s*[;\n]\s*/))
    .filter((name) => name.length > 1)
    .map(tidyName);

  if (!Object.keys(values).length && !supplyCodes.length && !owners.length)
    return null;

  const period = billingPeriod(fields);
  const uploadedAt =
    typeof document.uploadedAt === 'string'
      ? document.uploadedAt
      : document.uploadedAt.toISOString();
  const day =
    period?.end ??
    firstText(fields, ['issue_date', 'document_date', 'date'])?.slice(0, 10) ??
    uploadedAt.slice(0, 10);

  return {
    uploadId: document.uploadId,
    title: document.title,
    uploadedAt,
    day,
    propertyId: houseOf(document, address, properties, parentOf, override),
    utility,
    address,
    values,
    supplyCodes,
    owners,
  };
}

/**
 * The house a document is about: what Bills decides (your choice, a supply
 * code, the supply address, a category), else a house whose words appear
 * in the address read (an ID document's residence, a deed's address).
 */
function houseOf(
  document: DocumentLike,
  address: ParsedAddress | null,
  properties: readonly PropertyLike[],
  parentOf: ParentOf,
  override: OverrideLike | null,
): string | null {
  const matched = matchProperty(document, properties, parentOf, override);
  if (matched.propertyId || override?.manualProperty) return matched.propertyId;
  if (!address) return null;
  const street = ` ${normalizeText(address.street)} `;
  const hits = properties.filter((p) =>
    p.matchTerms.some((term) => {
      const needle = normalizeText(term);
      return needle.length > 1 && street.includes(` ${needle} `);
    }),
  );
  return hits.length === 1 ? hits[0].id : null;
}

/** Equal for the house: case, accents and punctuation ignored; numbers by value. */
export function sameValue(
  field: HouseField,
  a: string | number | null,
  b: string,
): boolean {
  if (a === null || a === '') return false;
  if (NUMBER_FIELDS.has(field)) return toNumber(a) === toNumber(b);
  return normalizeText(String(a)) === normalizeText(b);
}

/** What a house has in a field, as text. */
export function houseValue(
  house: PropertyDto,
  field: HouseField,
): string | null {
  if (field === 'supplyCodes') return house.supplyCodes.join(', ') || null;
  if (field === 'owners')
    return house.owners.map((o) => o.name).join(', ') || null;
  const value = house[field];
  return value === null || value === undefined ? null : String(value);
}

/** The read values of several documents together: the newest wins a value, lists add up. */
export interface HouseFacts {
  values: Partial<Record<HouseScalarField, string>>;
  supplyCodes: string[];
  owners: string[];
}

export function mergeReadings(readings: readonly HouseReading[]): HouseFacts {
  const newestFirst = [...readings].sort((a, b) =>
    (b.day + b.uploadedAt).localeCompare(a.day + a.uploadedAt),
  );
  const values: HouseFacts['values'] = {};
  for (const reading of newestFirst)
    for (const [field, value] of Object.entries(reading.values) as [
      HouseScalarField,
      string,
    ][])
      values[field] ??= value;
  const unique = (list: string[], key: (v: string) => string) => {
    const seen = new Map<string, string>();
    for (const value of list)
      if (!seen.has(key(value))) seen.set(key(value), value);
    return [...seen.values()];
  };
  return {
    values,
    supplyCodes: unique(
      newestFirst.flatMap((r) => r.supplyCodes),
      normalizeCode,
    ),
    owners: unique(
      newestFirst.flatMap((r) => r.owners),
      normalizeText,
    ),
  };
}

/** What the facts would change on a house (or, without one, every fact as new). */
export function proposeHouseChanges(
  facts: HouseFacts,
  house: PropertyDto | null,
): HouseProposedChangeDto[] {
  const changes: HouseProposedChangeDto[] = [];
  for (const field of HOUSE_FIELDS) {
    if (field === 'supplyCodes' || field === 'owners') {
      const have =
        field === 'supplyCodes'
          ? new Set(house?.supplyCodes.map(normalizeCode) ?? [])
          : new Set(house?.owners.map((o) => normalizeText(o.name)) ?? []);
      const key = field === 'supplyCodes' ? normalizeCode : normalizeText;
      const added = facts[field].filter((value) => !have.has(key(value)));
      if (added.length)
        changes.push({
          field,
          kind: 'add',
          current: house ? houseValue(house, field) : null,
          proposed: added.join(', '),
        });
      continue;
    }
    const proposed = facts.values[field];
    if (!proposed) continue;
    const current = house ? houseValue(house, field) : null;
    if (current !== null && sameValue(field, current, proposed)) continue;
    changes.push({
      field,
      kind: current === null ? 'new_value' : 'different_value',
      current,
      proposed,
    });
  }
  return changes;
}

/** The supplier field of a utility. */
export const supplierField = (utility: UtilityKind): HouseScalarField =>
  SUPPLIER_OF[utility];
