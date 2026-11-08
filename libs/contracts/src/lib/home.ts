import { z } from 'zod';

/*
 * The Home area (svc-home): your properties, the utility bills of each one
 * (electricity, gas, water) and the works done on them (renovations, repairs).
 * A house is an entity like a person in People: what documents say about it
 * is suggested, and reaches the house only once you approve it.
 * Bills are read from the documents you confirmed with a bill category; works
 * are records you keep yourself, with their invoices attached from your documents.
 */

// ---------------------------------------------------------------------------
// Utilities

export const UTILITY_KINDS = ['ELECTRICITY', 'GAS', 'WATER'] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];
export const utilityKindSchema = z.enum(UTILITY_KINDS);

export interface UtilityInfo {
  label: string;
  /** Unit of the consumption printed on the bill. */
  unit: string;
  /** The document category that marks a bill of this utility (its descendants count too). */
  categoryId: string;
  /** Template field holding the consumption, in `unit`. */
  consumptionField: string;
}

export const UTILITIES: Record<UtilityKind, UtilityInfo> = {
  ELECTRICITY: {
    label: 'Electricity',
    unit: 'kWh',
    categoryId: 'ELECTRICITY_BILL',
    consumptionField: 'electricity_consumption',
  },
  GAS: {
    label: 'Gas',
    unit: 'Smc',
    categoryId: 'GAS_BILL',
    consumptionField: 'gas_consumption',
  },
  WATER: {
    label: 'Water',
    unit: 'm³',
    categoryId: 'WATER_BILL',
    consumptionField: 'water_consumption',
  },
};

// ---------------------------------------------------------------------------
// Houses (the `properties` of svc-home)

/** How many properties get a colour of their own in charts (the rest fold into "Other"). */
export const PROPERTY_COLOR_SLOTS = 3;

export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT',
  'GARAGE',
  'LAND',
  'OTHER',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  HOUSE: 'House',
  APARTMENT: 'Apartment',
  GARAGE: 'Garage',
  LAND: 'Land',
  OTHER: 'Other',
};

/** Whether the house is yours, rented, or neither (a parent's house you look after). */
export const PROPERTY_TENURES = ['OWNED', 'RENTED', 'OTHER'] as const;
export type PropertyTenure = (typeof PROPERTY_TENURES)[number];
export const PROPERTY_TENURE_LABELS: Record<PropertyTenure, string> = {
  OWNED: 'Owned',
  RENTED: 'Rented',
  OTHER: 'Other',
};

/**
 * An owner of a house: a person of the People area (`personId`, with their
 * name as it was when picked) or just a name you typed (`personId` null).
 */
export interface PropertyOwnerDto {
  personId: string | null;
  name: string;
  /** Share of the ownership in percent, e.g. 50; null when not known. */
  share: number | null;
}

/** The companies a house deals with, each one picked from those known or typed. */
export const PROPERTY_COMPANY_FIELDS = [
  'electricitySupplier',
  'gasSupplier',
  'waterSupplier',
  'condoManager',
  'insurer',
] as const;
export type PropertyCompanyField = (typeof PROPERTY_COMPANY_FIELDS)[number];

/** The 3D model of a house, uploaded by you; shown instead of the drawn house. */
export const MODEL_FORMATS = ['GLB', 'GLTF', 'OBJ'] as const;
export type ModelFormat = (typeof MODEL_FORMATS)[number];
export const MODEL_EXTENSIONS: Record<ModelFormat, string> = {
  GLB: '.glb',
  GLTF: '.gltf',
  OBJ: '.obj',
};
/** Largest model accepted, in bytes. */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;

/** The format of a model file from its name, or null when it is not one. */
export function modelFormatOf(filename: string): ModelFormat | null {
  const lower = filename.toLowerCase();
  return (
    MODEL_FORMATS.find((format) => lower.endsWith(MODEL_EXTENSIONS[format])) ??
    null
  );
}

export interface PropertyModelDto {
  filename: string;
  format: ModelFormat;
  sizeBytes: number;
  uploadedAt: string;
}

export interface PropertyDto {
  id: string;
  /** What you call it, e.g. "Via Ponzilovo". */
  name: string;
  type: PropertyType;
  tenure: PropertyTenure;
  /** The house you live in. You can own many houses, but only one is your residence. */
  isResidence: boolean;
  /** Street and number, e.g. "Via Ponzilovo 9". */
  address: string | null;
  postalCode: string | null;
  city: string | null;
  /** Province code, e.g. "VR". */
  province: string | null;
  /** ISO 3166-1 alpha-2, e.g. "IT". */
  country: string | null;
  /** Floor area in square metres. */
  areaSqm: number | null;
  /** Rooms (vani catastali). */
  rooms: number | null;
  yearBuilt: number | null;
  /** Catasto: foglio, particella (mappale), subalterno, categoria, rendita. */
  cadastralSheet: string | null;
  cadastralParcel: string | null;
  cadastralSubunit: string | null;
  cadastralCategory: string | null;
  cadastralIncome: number | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  owners: PropertyOwnerDto[];
  electricitySupplier: string | null;
  gasSupplier: string | null;
  waterSupplier: string | null;
  condoManager: string | null;
  insurer: string | null;
  /** Fixed chart colour slot (0-based); follows the property, never its rank. */
  colorSlot: number;
  /**
   * Words that identify its documents: an address on a bill that contains one
   * of them belongs here (case and accents ignored), e.g. "ponzilovo".
   */
  matchTerms: string[];
  /**
   * Its supply points: the POD (electricity) and PDR (gas) of its meters. They
   * belong to the house and never change with the supplier or the contract.
   * The customer code (codice cliente) is not here: it belongs to one supply
   * contract, see `SupplyContractDto`.
   */
  supplyCodes: string[];
  /** Document categories (usually of the PROPERTY dimension) that mean "this home". */
  categoryIds: string[];
  notes: string | null;
  model: PropertyModelDto | null;
  createdAt: string;
}

const terms = z
  .array(z.string().trim().min(2).max(80))
  .max(20)
  .transform((values) => [...new Set(values)]);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const optionalNumber = (max: number) =>
  z.number().min(0).max(max).nullable().optional();

export const propertyOwnerSchema = z.object({
  personId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(160),
  share: z.number().gt(0).max(100).nullable(),
});

export const createPropertyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(PROPERTY_TYPES).optional(),
  tenure: z.enum(PROPERTY_TENURES).optional(),
  isResidence: z.boolean().optional(),
  address: optionalText(200),
  postalCode: optionalText(16),
  city: optionalText(80),
  province: optionalText(8),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'a two-letter country code, e.g. IT')
    .transform((code) => code.toUpperCase())
    .nullable()
    .optional(),
  areaSqm: optionalNumber(100_000),
  rooms: optionalNumber(1000),
  yearBuilt: z.number().int().min(1000).max(2200).nullable().optional(),
  cadastralSheet: optionalText(20),
  cadastralParcel: optionalText(20),
  cadastralSubunit: optionalText(20),
  cadastralCategory: optionalText(10),
  cadastralIncome: optionalNumber(10_000_000),
  purchaseDate: z.iso.date().nullable().optional(),
  purchasePrice: optionalNumber(1_000_000_000),
  owners: z.array(propertyOwnerSchema).max(20).optional(),
  electricitySupplier: optionalText(160),
  gasSupplier: optionalText(160),
  waterSupplier: optionalText(160),
  condoManager: optionalText(160),
  insurer: optionalText(160),
  matchTerms: terms.optional(),
  supplyCodes: terms.optional(),
  categoryIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  notes: optionalText(2000),
});
export type CreatePropertyRequest = z.input<typeof createPropertyRequestSchema>;

export const updatePropertyRequestSchema =
  createPropertyRequestSchema.partial();
export type UpdatePropertyRequest = z.input<typeof updatePropertyRequestSchema>;

/** A person of the People area, offered as an owner (and shown as a resident). */
export interface HomePersonDto {
  id: string;
  name: string;
  taxCode: string | null;
  /** The house picked as their Residence in People, if any. */
  residencePropertyId: string | null;
}

export interface HomePeopleDto {
  people: HomePersonDto[];
  /** False when the People service could not be reached: owners are typed for now. */
  available: boolean;
}

/** Where a known company was seen. */
export const COMPANY_SOURCES = ['BILL', 'HOUSE', 'WORK'] as const;
export type CompanySource = (typeof COMPANY_SOURCES)[number];

/** A company already known to the Houses area, to pick instead of typing it again. */
export interface KnownCompanyDto {
  name: string;
  sources: CompanySource[];
  /** How many bills, houses and works name it. */
  uses: number;
}

// ---------------------------------------------------------------------------
// House suggestions: houses and house data read from your documents

/** The house data a document can print, each one reviewed before it reaches a house. */
export const HOUSE_FIELDS = [
  'address',
  'postalCode',
  'city',
  'province',
  'areaSqm',
  'rooms',
  'cadastralSheet',
  'cadastralParcel',
  'cadastralSubunit',
  'cadastralCategory',
  'cadastralIncome',
  'electricitySupplier',
  'gasSupplier',
  'waterSupplier',
  'condoManager',
  'insurer',
  'supplyCodes',
  'owners',
] as const;
export type HouseField = (typeof HOUSE_FIELDS)[number];

/** Fields that add to a list rather than replace a value. */
export const HOUSE_LIST_FIELDS: readonly HouseField[] = [
  'supplyCodes',
  'owners',
];

export const HOUSE_FIELD_LABELS: Record<HouseField, string> = {
  address: 'Address',
  postalCode: 'Postal code',
  city: 'City',
  province: 'Province',
  areaSqm: 'Floor area (m²)',
  rooms: 'Rooms',
  cadastralSheet: 'Cadastral sheet (foglio)',
  cadastralParcel: 'Cadastral parcel (particella)',
  cadastralSubunit: 'Cadastral subunit (subalterno)',
  cadastralCategory: 'Cadastral category',
  cadastralIncome: 'Cadastral income (rendita)',
  electricitySupplier: 'Electricity supplier',
  gasSupplier: 'Gas supplier',
  waterSupplier: 'Water supplier',
  condoManager: 'Condominium manager',
  insurer: 'Insurer',
  supplyCodes: 'Supply point (POD/PDR)',
  owners: 'Owner',
};

export type HouseChangeKind = 'new_value' | 'different_value' | 'add';

export interface HouseProposedChangeDto {
  field: HouseField;
  kind: HouseChangeKind;
  /** What the house has (a list joined with commas); null when nothing. */
  current: string | null;
  proposed: string;
}

export interface HouseSuggestionDocumentDto {
  uploadId: string;
  title: string;
  uploadedAt: string;
}

/**
 * Something your documents say about a house: a house you do not have yet
 * (`new_house`, grouped by address), or new or different data of one you
 * have (`new_info`, grouped when several documents say the same thing).
 */
export interface HouseSuggestionDto {
  /** Stable while the same documents say the same thing. */
  key: string;
  kind: 'new_house' | 'new_info';
  /** The house it was matched to; null for a new house. */
  propertyId: string | null;
  /** For a new house: the name it would get, e.g. "Via Roma 5". */
  name: string | null;
  documents: HouseSuggestionDocumentDto[];
  /** Against the matched house (for a new house, every value read). */
  changes: HouseProposedChangeDto[];
}

export const approveHouseSuggestionRequestSchema = z.object({
  /** The documents of the suggestion, as listed. */
  uploadIds: z.array(z.uuid()).min(1).max(500),
  /** The house they are about; null creates a new house from them. */
  propertyId: z.uuid().nullable(),
  /** The fields whose read value you take; the others keep the house's value. */
  accept: z.array(z.enum(HOUSE_FIELDS)).default([]),
  /** For a new house: its name, else the suggested one. */
  name: z.string().trim().min(1).max(80).optional(),
});
export type ApproveHouseSuggestionRequest = z.input<
  typeof approveHouseSuggestionRequestSchema
>;

export const dismissHouseSuggestionRequestSchema = z.object({
  uploadIds: z.array(z.uuid()).min(1).max(500),
});
export type DismissHouseSuggestionRequest = z.input<
  typeof dismissHouseSuggestionRequestSchema
>;

// ---------------------------------------------------------------------------
// Bills

/** Why a bill sits under its property. */
export const BILL_ASSIGNMENTS = [
  'MANUAL', // you picked it
  'CATEGORY', // the document has one of the property's categories
  'SUPPLY_CODE', // its POD or PDR is one of the property's supply points
  'SUPPLY_CONTRACT', // another bill of its supply contract (same supplier and customer code) is on the property
  'ADDRESS', // an address on it contains one of the property's match terms
] as const;
export type BillAssignment = (typeof BILL_ASSIGNMENTS)[number];

export interface BillDto {
  uploadId: string;
  title: string;
  utility: UtilityKind;
  /** Whether the utility came from your correction rather than the document's categories. */
  utilityOverridden: boolean;
  propertyId: string | null;
  assignment: BillAssignment | null;
  provider: string | null;
  /** Codice cliente: the supplier's code of the supply contract it bills. */
  customerCode: string | null;
  /** POD (electricity) or PDR (gas) of the supply point, when printed. */
  supplyPointCode: string | null;
  /** The offer (piano tariffario) billed, when printed. */
  offer: string | null;
  /** First and last day billed (both null when the bill prints no period). */
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amount: number;
  currency: string;
  /** Consumption in the utility's unit; null when the bill does not print it. */
  consumption: number | null;
  unit: string;
}

/**
 * A supply contract, read from its bills: one supplier, one customer code
 * (codice cliente), one supply. How Italian customer codes behave:
 * - The supplier gives the code to one contract, not to you or to the house:
 *   electricity and gas are separate contracts, so they have different codes
 *   even with the same supplier.
 * - Changing offer with the same supplier (fixed to variable price) keeps the
 *   contract, so the code stays and only the offer changes.
 * - Changing supplier, closing the meter and reactivating it (subentro), or
 *   changing the holder (voltura) starts a new contract with a new code.
 * - The POD or PDR stays the same through all of this: it is the meter's,
 *   so it belongs to the house.
 * So a contract is told apart by utility, supplier and customer code, and is
 * valid from its first billed day to its last.
 */
export interface SupplyContractDto {
  /** `<utility>:<supplier>:<customer code>`, stable while its bills say the same. */
  key: string;
  utility: UtilityKind;
  supplier: string | null;
  customerCode: string;
  /** The POD or PDR its bills print, if any. */
  supplyPointCode: string | null;
  /** The house its bills are on; null when they are on none. */
  propertyId: string | null;
  /** First and last day billed. */
  from: string | null;
  to: string | null;
  /**
   * ACTIVE: the latest contract of its utility on its house. REPLACED: a later
   * contract of the same utility on the same house took over (new supplier,
   * a subentro or a voltura).
   */
  status: 'ACTIVE' | 'REPLACED';
  /** The offers billed under it, oldest first: an offer change keeps the code. */
  offers: { name: string; from: string | null; to: string | null }[];
  billCount: number;
}

export const listBillsQuerySchema = z.object({
  /** A property id, `unassigned`, or nothing for every property. */
  property: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  utility: z
    .union([utilityKindSchema, z.array(utilityKindSchema)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
  /** Bills whose period (or date) ends on or after this day. */
  from: z.iso.date().optional(),
  /** Bills whose period (or date) starts on or before this day. */
  to: z.iso.date().optional(),
});
export type ListBillsQuery = z.input<typeof listBillsQuerySchema>;

/**
 * Your corrections to a bill. `propertyId` null takes it off any property;
 * `utility` null goes back to what the categories say; `excluded` hides it
 * from Bills (e.g. a document that is not really a bill).
 */
export const updateBillRequestSchema = z.object({
  propertyId: z.uuid().nullable().optional(),
  /** Forget the manual property choice and match it automatically again. */
  automaticProperty: z.literal(true).optional(),
  utility: utilityKindSchema.nullable().optional(),
  excluded: z.boolean().optional(),
});
export type UpdateBillRequest = z.input<typeof updateBillRequestSchema>;

// ---------------------------------------------------------------------------
// Works: renovations, repairs and maintenance

export const WORK_KINDS = [
  'RENOVATION',
  'REPAIR',
  'MAINTENANCE',
  'IMPROVEMENT',
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  RENOVATION: 'Renovation',
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance',
  IMPROVEMENT: 'Improvement',
};

export const WORK_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

export interface WorkDocumentDto {
  uploadId: string;
  title: string;
  date: string | null;
  amount: number | null;
  /** The document was deleted from your documents after you attached it. */
  deleted: boolean;
}

export interface WorkDto {
  id: string;
  propertyId: string;
  title: string;
  kind: WorkKind;
  status: WorkStatus;
  /** Where in the home, e.g. "Bathroom", "Roof", "Boiler". */
  area: string | null;
  contractor: string | null;
  startDate: string | null;
  endDate: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  notes: string | null;
  documents: WorkDocumentDto[];
  createdAt: string;
  updatedAt: string;
}

const money = z.number().min(0).max(10_000_000).nullable().optional();

export const createWorkRequestSchema = z
  .object({
    propertyId: z.uuid(),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(WORK_KINDS),
    status: z.enum(WORK_STATUSES).default('PLANNED'),
    area: optionalText(80),
    contractor: optionalText(120),
    startDate: z.iso.date().nullable().optional(),
    endDate: z.iso.date().nullable().optional(),
    estimatedCost: money,
    actualCost: money,
    notes: optionalText(4000),
  })
  .refine(
    (work) =>
      !work.startDate || !work.endDate || work.startDate <= work.endDate,
    { path: ['endDate'], message: 'ends before it starts' },
  );
export type CreateWorkRequest = z.input<typeof createWorkRequestSchema>;

export const updateWorkRequestSchema = z.object({
  propertyId: z.uuid().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(WORK_KINDS).optional(),
  status: z.enum(WORK_STATUSES).optional(),
  area: optionalText(80),
  contractor: optionalText(120),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  estimatedCost: money,
  actualCost: money,
  notes: optionalText(4000),
});
export type UpdateWorkRequest = z.input<typeof updateWorkRequestSchema>;

export const listWorksQuerySchema = z.object({
  property: z.uuid().optional(),
  status: z.enum(WORK_STATUSES).optional(),
});
export type ListWorksQuery = z.input<typeof listWorksQuerySchema>;

export const attachWorkDocumentRequestSchema = z.object({
  uploadId: z.uuid(),
});
export type AttachWorkDocumentRequest = z.input<
  typeof attachWorkDocumentRequestSchema
>;

/** A document you could attach to a work (an invoice, a quote, a photo). */
export interface HomeDocumentDto {
  uploadId: string;
  title: string;
  categories: string[];
  date: string | null;
  amount: number | null;
  uploadedAt: string;
}

export const listHomeDocumentsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
