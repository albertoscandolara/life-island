import type { BankPaymentDto } from './payables.js';
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
   * Every supply point code it has had: POD (electricity), PDR (gas), the
   * water supply code, typed by you or read from its bills. Never a
   * customer code: that belongs to a supply contract.
   */
  supplyCodes: string[];
  /**
   * Its supply point of each utility, one each: the one its newest bill of
   * that utility is for, else the code you typed. A new bill of the same
   * supply never asks again; only a different code is suggested.
   */
  supplyPoints: Record<UtilityKind, string | null>;
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
const supplyCode = z
  .string()
  .trim()
  .min(6, 'a supply point code has at least 6 characters')
  .max(40)
  .nullable();
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
  /**
   * Its supply point of a utility (POD, PDR, water code); null takes the
   * current one off the house. Its bills, past and future, follow the code.
   */
  supplyPoints: z
    .object({
      ELECTRICITY: supplyCode,
      GAS: supplyCode,
      WATER: supplyCode,
    })
    .partial()
    .optional(),
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
export const COMPANY_SOURCES = [
  'ORGANIZATION',
  'BILL',
  'HOUSE',
  'WORK',
] as const;
export type CompanySource = (typeof COMPANY_SOURCES)[number];

/** A company already known to the Houses area, to pick instead of typing it again. */
export interface KnownCompanyDto {
  /** The organization, when the company is one; null for a name seen only as text. */
  id: string | null;
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
  'electricityPoint',
  'gasPoint',
  'waterPoint',
  'owners',
] as const;
export type HouseField = (typeof HOUSE_FIELDS)[number];

/** Fields that add to a list rather than replace a value. */
export const HOUSE_LIST_FIELDS: readonly HouseField[] = ['owners'];

/** The house field holding the supply point of each utility: one each. */
export const SUPPLY_POINT_FIELDS: Record<UtilityKind, HouseField> = {
  ELECTRICITY: 'electricityPoint',
  GAS: 'gasPoint',
  WATER: 'waterPoint',
};

/** The utility of a supply point field, or null for another field. */
export function supplyPointUtility(field: HouseField): UtilityKind | null {
  return (
    UTILITY_KINDS.find((kind) => SUPPLY_POINT_FIELDS[kind] === field) ?? null
  );
}

/**
 * The utility a supply code is for, by its shape: a POD is IT, 3 digits, E
 * and more (IT001E12345678), a PDR is 14 digits. A water code has no fixed
 * shape: null.
 */
export function supplyCodeUtility(code: string): UtilityKind | null {
  const plain = code.replace(/[\s\-./]/g, '').toUpperCase();
  if (/^IT\d{3}E[0-9A-Z]{5,}$/.test(plain)) return 'ELECTRICITY';
  if (/^\d{14}$/.test(plain)) return 'GAS';
  return null;
}

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
  electricityPoint: 'Electricity supply point (POD)',
  gasPoint: 'Gas supply point (PDR)',
  waterPoint: 'Water supply code',
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
  'SUPPLY_CODE', // its POD/PDR/customer code is one of the property's
  'ADDRESS', // an address on it contains one of the property's match terms
] as const;
export type BillAssignment = (typeof BILL_ASSIGNMENTS)[number];

export interface BillDto {
  /** The bill entity's id; `uploadId` is the document it was read from. */
  id: string;
  uploadId: string;
  title: string;
  utility: UtilityKind;
  /** Whether the utility came from your correction rather than the document's categories. */
  utilityOverridden: boolean;
  propertyId: string | null;
  assignment: BillAssignment | null;
  provider: string | null;
  customerId: string | null;
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
  /** Invoice number as printed; with the supplier, the bill's natural key. */
  invoiceNumber: string | null;
  /** What was left to pay, when it differs from the total (credits, earlier bills). */
  totalDue: number | null;
  supplierId: string | null;
  supplyPointId: string | null;
  contractId: string | null;
  /** What the bill prints on how it is paid: direct debit (true), another way (false), nothing (null). */
  directDebit: boolean | null;
  /**
   * Paid on its own (direct debit on your bank account): its due date is
   * never a warning. Your choice on its supply contract wins, then what the
   * bill prints, then what the contract's latest bill printed.
   */
  autoPaid: boolean;
  /**
   * The bank payments you matched to it in Money (docs/guides/money-matching.md);
   * null when none is.
   */
  bankPayment: BillPaymentDto | null;
}

/** What Money says was paid of a bill, from the movements you matched. */
export type BillPaymentDto = BankPaymentDto;

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

// ---------------------------------------------------------------------------
// Bills as entities: organizations, supply points, supply contracts
//
// The model of life-island-docs/entities: a house has supply points (POD for
// electricity, PDR for gas, the water code), each supplied under contracts
// with a supplier, and every bill points to its supply point and contract.
// A bill reaches its house through its supply point, never by a copy.

/**
 * What a company is to you. EMPLOYER is set on its own for the company that
 * issues your payslips, Certificazione Unica or employment contract; BANK
 * for one whose name says it is a bank or that issues your bank statements;
 * INSURANCE for one whose name says it is an insurer or that issues your
 * insurance policies (car, house...); PUBLIC_BODY for one whose name says it
 * is a public body (a ministry, a town, an agency, INPS...); PROFESSIONAL for
 * one whose name says it is a professional service (a notary, a lawyer, an
 * accountant, a real estate agent, a consultant...).
 */
export const ORGANIZATION_ROLES = [
  'ENERGY_SUPPLIER',
  'DISTRIBUTOR',
  'CONTRACTOR',
  'EMPLOYER',
  'BANK',
  'INSURANCE',
  'PUBLIC_BODY',
  'PROFESSIONAL',
  'OTHER',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * PENDING: a document named it and it waits for you. CONFIRMED: you know it,
 * and every mention links to its page. DISMISSED: not a company (a misread
 * name), never suggested again.
 */
export const ORGANIZATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'DISMISSED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** A company or public office, whatever its role: one row, referenced by id. */
/**
 * A company that looks like another. When only a name one of them is also
 * printed as looks like the other, that name is said: it is the name that is
 * in the wrong company (a wrong merge), not the whole company.
 */
export interface PossibleDuplicateDto {
  id: string;
  name: string;
  /** This company's other name that looks like that company: it may belong there. */
  mine?: string;
  /** That company's other name that looks like this company: it may belong here. */
  theirs?: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  /** Codice fiscale; the natural key when printed. */
  taxCode: string | null;
  vatNumber: string | null;
  roles: OrganizationRole[];
  status: OrganizationStatus;
  /** Other names documents print for it. */
  aliases: string[];
  billCount: number;
  /** Documents whose issuer is this company. */
  documentCount: number;
  /**
   * Companies whose name is only a typo or two away from this one's: maybe
   * the same company, for you to merge (names that differ only in case,
   * accents, punctuation, legal form or spacing are merged on their own).
   */
  possibleDuplicates: PossibleDuplicateDto[];
  /** Its website, as you typed it (always http or https). */
  website: string | null;
  /** A few words of your own on it: what it does for you, a branch, a contact. */
  description: string | null;
  /**
   * Its logo and background (cover) image: when each was last changed, to
   * bust the cache of its URL, or null when it has none.
   */
  images: Record<OrganizationImageKind, string | null>;
}

/**
 * The pictures that make a company recognizable at a glance: a logo (square,
 * shown beside its name) and a background image (wide, behind its page's
 * heading). Uploaded by you, kept in svc-home's bucket, never in the database.
 */
export const ORGANIZATION_IMAGE_KINDS = ['logo', 'cover'] as const;
export type OrganizationImageKind = (typeof ORGANIZATION_IMAGE_KINDS)[number];
/** Image types accepted (no SVG: it can carry scripts). */
export const ORGANIZATION_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export type OrganizationImageType = (typeof ORGANIZATION_IMAGE_TYPES)[number];
/** Largest image accepted, in bytes. */
export const ORGANIZATION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** A document a company issued, on the company's page. */
export interface OrganizationDocumentDto {
  uploadId: string;
  title: string;
  /** The document date when read, else the upload day. */
  date: string;
  /** The total it prints, when read. */
  amount: number | null;
}

/** A house a company supplies (through a supply contract) or worked on. */
export interface OrganizationHouseDto {
  id: string;
  name: string;
  /** "Electricity supplier", "Contractor"... */
  role: string;
}

/** A company's page: what it is, its documents and the houses it is tied to. */
export interface OrganizationDetailDto extends OrganizationDto {
  documents: OrganizationDocumentDto[];
  houses: OrganizationHouseDto[];
}

/**
 * Merges a duplicate into this company: its bills, contracts and supply
 * points move here, its names become aliases, and it is removed.
 */
export const mergeOrganizationRequestSchema = z.object({
  from: z.uuid(),
});
export type MergeOrganizationRequest = z.input<
  typeof mergeOrganizationRequestSchema
>;

/**
 * Undoes a merge: `name`, one of the names a company is also printed as,
 * is not that company. It goes to the company `into`, or to its own company
 * (the one already called that, or a new one), with the documents, bills and
 * codes printed with it.
 */
export const splitOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  into: z.uuid().nullable().optional(),
});
export type SplitOrganizationRequest = z.input<
  typeof splitOrganizationRequestSchema
>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  taxCode: z.string().trim().max(32).nullable().optional(),
  vatNumber: z.string().trim().max(32).nullable().optional(),
  /** Every other name documents print for it; replaces the list. */
  aliases: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  roles: z
    .array(z.enum(ORGANIZATION_ROLES))
    .max(ORGANIZATION_ROLES.length)
    .optional(),
  /** "acme.it" is read as https://acme.it; empty clears it. */
  website: z
    .string()
    .trim()
    .max(300)
    .transform((v) =>
      v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v,
    )
    .pipe(
      z.union([
        z.literal(''),
        z.url({ protocol: /^https?$/, hostname: /^[^.\s]+(\.[^.\s]+)+$/ }),
      ]),
    )
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Empty clears it. */
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null)
    .nullable()
    .optional(),
});
export type UpdateOrganizationRequest = z.input<
  typeof updateOrganizationRequestSchema
>;

/**
 * A supply contract: one supplier, one customer code (codice cliente), one
 * supply point. How Italian customer codes behave:
 * - the supplier gives the code to one contract, not to you or the house:
 *   electricity and gas are separate contracts with separate codes, even
 *   with the same supplier;
 * - an offer change with the same supplier (fixed to variable price) keeps
 *   the contract and its code: only the offer changes;
 * - a new supplier, a subentro after the meter was closed, or a voltura to
 *   another holder start a new contract with a new code;
 * - the POD or PDR names the meter and stays through all of this, so it
 *   belongs to the house, and the customer code never does.
 */
export interface SupplyContractDto {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  customerCode: string | null;
  offerName: string | null;
  /** First and last bill period seen under it. */
  firstDay: string | null;
  lastDay: string | null;
  /**
   * ACTIVE: the contract billed last on its supply point. ENDED: a later
   * contract took the supply point over (new supplier, subentro, voltura).
   */
  status: 'ACTIVE' | 'ENDED';
  billCount: number;
  /** Your choice: its bills are paid on their own (true) or not (false); null follows its bills. */
  autoPay: boolean | null;
  /** What its latest bill printed: paid by direct debit (true), another way (false), nothing (null). */
  directDebit: boolean | null;
  /** Whether its bills count as paid on their own: `autoPay`, else `directDebit`. */
  autoPaid: boolean;
}

/**
 * Your choice on a supply contract: `autoPay` true when its bills are
 * charged to your bank account (domiciliazione, SDD), so their due dates
 * never show as late; false when you pay them yourself; null goes back to
 * what the bills print.
 */
export const updateSupplyContractRequestSchema = z.object({
  autoPay: z.boolean().nullable(),
});
export type UpdateSupplyContractRequest = z.input<
  typeof updateSupplyContractRequestSchema
>;

/** Where electricity, gas or water is delivered: it belongs to a house and outlives contracts. */
export interface SupplyPointDto {
  id: string;
  utility: UtilityKind;
  /** POD, PDR or water customer code, without spaces. */
  code: string;
  /** The house it delivers to; null until one is known. Its bills follow it. */
  propertyId: string | null;
  distributorId: string | null;
  distributorName: string | null;
  contracts: SupplyContractDto[];
  billCount: number;
}

export const updateSupplyPointRequestSchema = z.object({
  /** Moves the supply point, and every bill of it, to this house (null: none). */
  propertyId: z.uuid().nullable(),
});
export type UpdateSupplyPointRequest = z.input<
  typeof updateSupplyPointRequestSchema
>;

// ---------------------------------------------------------------------------
// What else your documents say about a house: its internet line and its
// insurances. Read from the documents you uploaded (an internet contract or
// bill, a home insurance policy), never typed: you only correct the house.

/** Whether a document about a house service is its contract (or policy) or a bill of it. */
export const HOUSE_SERVICE_DOCUMENT_ROLES = ['CONTRACT', 'BILL'] as const;
export type HouseServiceDocumentRole =
  (typeof HOUSE_SERVICE_DOCUMENT_ROLES)[number];

export interface HouseServiceDocumentDto {
  uploadId: string;
  title: string;
  role: HouseServiceDocumentRole;
  /** The day it speaks of: its period end, issue date, else its upload. */
  date: string;
  amount: number | null;
  /** You picked its house by hand. */
  manual: boolean;
}

/** One internet line of a house: a provider and its customer or line code. */
export interface HouseInternetDto {
  /** Stable while the same provider and code: provider key | code. */
  key: string;
  propertyId: string | null;
  provider: string | null;
  /** The offer, e.g. "Fibra 2.5 Giga". */
  offerName: string | null;
  /** Customer code, line number or contract number, as printed. */
  customerCode: string | null;
  /** The phone number of the line, when printed. */
  lineNumber: string | null;
  /** The monthly fee of the contract, else of its last bill period. */
  monthlyCost: number | null;
  firstDay: string;
  lastDay: string;
  /** The line billed last on its house; the others ended (you changed provider). */
  status: 'ACTIVE' | 'ENDED';
  lastBill: { date: string; amount: number } | null;
  /** What its bills cost in the last 12 months. */
  yearCost: number;
  documents: HouseServiceDocumentDto[];
}

/** One insurance policy of a house (home, fire, theft, family liability). */
export interface HouseInsuranceDto {
  /** Stable while the same insurer and policy number. */
  key: string;
  propertyId: string | null;
  insurer: string | null;
  policyNumber: string | null;
  /** What it covers, as printed: "Incendio e furto", "Responsabilità civile". */
  coverage: string | null;
  startDate: string | null;
  endDate: string | null;
  /** The yearly premium, else the last amount paid. */
  premium: number | null;
  /** ACTIVE until its end date; UNKNOWN when no end date is printed. */
  status: 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';
  documents: HouseServiceDocumentDto[];
}

export interface HouseServicesDto {
  internet: HouseInternetDto[];
  insurances: HouseInsuranceDto[];
}

/**
 * Your correction to an internet or insurance document: `propertyId` puts
 * it on a house (null: on none), `automaticProperty` matches it again,
 * `excluded` says it is not about a house (a car insurance).
 */
export const updateHouseServiceDocumentRequestSchema = z.object({
  propertyId: z.uuid().nullable().optional(),
  automaticProperty: z.literal(true).optional(),
  excluded: z.boolean().optional(),
});
export type UpdateHouseServiceDocumentRequest = z.input<
  typeof updateHouseServiceDocumentRequestSchema
>;

// ---------------------------------------------------------------------------
// 730 home expenses: renovations, energy efficiency and furniture you claim
// in the 730 (svc-tax730), shown under Renovations of their house.

/** The 730 expense types that are work on a house. */
export const HOUSE_TAX_EXPENSE_TYPES = [
  'renovation',
  'energy_efficiency',
  'furniture',
] as const;
export type HouseTaxExpenseType = (typeof HOUSE_TAX_EXPENSE_TYPES)[number];

export const HOUSE_TAX_EXPENSE_LABELS: Record<HouseTaxExpenseType, string> = {
  renovation: 'Renovation (bonus casa)',
  energy_efficiency: 'Energy efficiency (ecobonus)',
  furniture: 'Furniture and appliances (bonus mobili)',
};

/** Why a 730 expense sits under its house. */
export const HOUSE_TAX_EXPENSE_MATCHES = [
  'MANUAL', // you picked it
  'WORK', // one of its documents is filed under a work of the house
  'DOCUMENT', // its invoice names the house (address, supply code, category)
  'ONLY_HOUSE', // you have one house only
] as const;
export type HouseTaxExpenseMatch = (typeof HOUSE_TAX_EXPENSE_MATCHES)[number];

export interface HouseTaxExpenseDto {
  /** The expense in svc-tax730. */
  expenseId: string;
  taxYear: number;
  expenseType: HouseTaxExpenseType;
  date: string;
  amount: number;
  issuer: string;
  description: string | null;
  documentNumber: string | null;
  /** Paid by bank transfer or card: home bonuses need a "bonifico parlante". */
  traceablePayment: boolean | null;
  /** The invoice and payments: its own and those of the expenses paired with it. */
  documents: { uploadId: string; title: string | null; role: string }[];
  propertyId: string | null;
  match: HouseTaxExpenseMatch | null;
  /** The work it is part of, when it is one. */
  workId: string | null;
}

export interface HouseTaxExpensesDto {
  /** False when the 730 service could not be reached. */
  available: boolean;
  expenses: HouseTaxExpenseDto[];
}

/** Put a 730 expense on a house and maybe a work of it; `automaticProperty` matches it again. */
export const updateHouseTaxExpenseRequestSchema = z.object({
  propertyId: z.uuid().nullable().optional(),
  automaticProperty: z.literal(true).optional(),
  workId: z.uuid().nullable().optional(),
});
export type UpdateHouseTaxExpenseRequest = z.input<
  typeof updateHouseTaxExpenseRequestSchema
>;

export const listHouseTaxExpensesQuerySchema = z.object({
  property: z.uuid().optional(),
});

/** Makes a work of a 730 expense, on its house unless another is given. */
export const createWorkFromTaxExpenseRequestSchema = z.object({
  propertyId: z.uuid().optional(),
});
export type CreateWorkFromTaxExpenseRequest = z.input<
  typeof createWorkFromTaxExpenseRequestSchema
>;
