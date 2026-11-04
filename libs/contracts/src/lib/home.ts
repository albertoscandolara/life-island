import { z } from 'zod';

/*
 * The Home area (svc-home): your properties, the utility bills of each one
 * (electricity, gas, water) and the works done on them (renovations, repairs).
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
// Properties

/** How many properties get a colour of their own in charts (the rest fold into "Other"). */
export const PROPERTY_COLOR_SLOTS = 3;

export interface PropertyDto {
  id: string;
  /** What you call it, e.g. "Via Ponzilovo". */
  name: string;
  address: string | null;
  city: string | null;
  /** Fixed chart colour slot (0-based); follows the property, never its rank. */
  colorSlot: number;
  /**
   * Words that identify its documents: an address on a bill that contains one
   * of them belongs here (case and accents ignored), e.g. "ponzilovo".
   */
  matchTerms: string[];
  /** Supply point codes (POD, PDR, water customer code) printed on its bills. */
  supplyCodes: string[];
  /** Document categories (usually of the PROPERTY dimension) that mean "this home". */
  categoryIds: string[];
  notes: string | null;
  createdAt: string;
}

const terms = z
  .array(z.string().trim().min(2).max(80))
  .max(20)
  .transform((values) => [...new Set(values)]);

export const createPropertyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  matchTerms: terms.optional(),
  supplyCodes: terms.optional(),
  categoryIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CreatePropertyRequest = z.input<typeof createPropertyRequestSchema>;

export const updatePropertyRequestSchema =
  createPropertyRequestSchema.partial();
export type UpdatePropertyRequest = z.input<typeof updatePropertyRequestSchema>;

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
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

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
