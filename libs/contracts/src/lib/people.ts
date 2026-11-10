import { z } from 'zod';

/*
 * The People area (svc-people, mfe-people): the people your ID documents
 * belong to, their documents version by version, the review of new or
 * different personal data, and expiry warnings.
 */

/** The ID document types: categories of svc-ingestion's migration 0010. */
export const ID_DOCUMENT_TYPES = [
  'IDENTITY_CARD',
  'PASSPORT',
  'HEALTH_CARD',
  'DRIVING_LICENCE',
] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

/** Their root category; an ID document filed only under it has no specific type. */
export const ID_DOCUMENT_ROOT = 'ID_DOCUMENT';

export const ID_DOCUMENT_TYPE_LABELS: Record<IdDocumentType, string> = {
  IDENTITY_CARD: 'Identity card',
  PASSPORT: 'Passport',
  HEALTH_CARD: 'Health card',
  DRIVING_LICENCE: 'Driving licence',
};

/**
 * How long before it expires the latest version of each type is flagged as
 * expiring: a passport needs six months left to enter many countries, a CIE
 * takes weeks to arrive, a licence needs a medical check booked first.
 */
export const EXPIRY_WARNING_DAYS: Record<IdDocumentType, number> = {
  PASSPORT: 180,
  IDENTITY_CARD: 90,
  DRIVING_LICENCE: 90,
  HEALTH_CARD: 60,
};

/**
 * The person data an ID document prints, with the template field key it is
 * read from. Every ID template uses these same keys, so the documents of one
 * person merge field by field.
 */
export const PERSON_FIELDS = [
  'lastName',
  'firstName',
  'taxCode',
  'birthDate',
  'birthPlace',
  'sex',
  'citizenship',
  'residenceAddress',
] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

export const PERSON_FIELD_KEYS: Record<PersonField, string> = {
  lastName: 'last_name',
  firstName: 'first_name',
  taxCode: 'tax_code',
  birthDate: 'birth_date',
  birthPlace: 'birth_place',
  sex: 'sex',
  citizenship: 'citizenship',
  residenceAddress: 'residence_address',
};

export const PERSON_FIELD_LABELS: Record<PersonField, string> = {
  lastName: 'Last name',
  firstName: 'First name',
  taxCode: 'Tax code',
  birthDate: 'Birth date',
  birthPlace: 'Birth place',
  sex: 'Sex',
  citizenship: 'Citizenship',
  residenceAddress: 'Residence',
};

/** The document facts every ID template asks for, with their template keys. */
export const ID_DOCUMENT_FIELD_KEYS = {
  documentNumber: 'document_number',
  issuer: 'issuer',
  issuingCountry: 'issuing_country',
  issueDate: 'issue_date',
  expiryDate: 'expiry_date',
} as const;

/**
 * Where a version stands in its series. The latest approved one is current
 * (or expired once past its date); older ones are superseded. Lost, stolen
 * and withdrawn are set by you.
 */
export const ID_DOCUMENT_STATUSES = [
  'current',
  'expired',
  'superseded',
  'lost',
  'stolen',
  'withdrawn',
] as const;
export type IdDocumentStatus = (typeof ID_DOCUMENT_STATUSES)[number];
export const MARKABLE_STATUSES = ['lost', 'stolen', 'withdrawn'] as const;

export const ID_DOCUMENT_STATUS_LABELS: Record<IdDocumentStatus, string> = {
  current: 'Current',
  expired: 'Expired',
  superseded: 'Replaced by a newer one',
  lost: 'Lost',
  stolen: 'Stolen',
  withdrawn: 'Withdrawn',
};

const personValues = z.object({
  lastName: z.string().nullable(),
  firstName: z.string().nullable(),
  taxCode: z.string().nullable(),
  birthDate: z.string().nullable(),
  birthPlace: z.string().nullable(),
  sex: z.string().nullable(),
  citizenship: z.string().nullable(),
  residenceAddress: z.string().nullable(),
});
export type PersonValues = z.infer<typeof personValues>;

/**
 * Whether the printed values say who the holder is: a name or a tax code.
 * A document read as nothing (a photo the offline parser cannot read) does
 * not, so it can be filed under someone you pick but never makes a person.
 */
export function identifiesSomeone(holder: PersonValues): boolean {
  return !!(holder.lastName || holder.firstName || holder.taxCode);
}

/** A category of a driving licence (field 9), with its own dates (10 and 11). */
export interface LicenceCategoryDto {
  category: string;
  /** What it lets you drive, or null for a code Life Island does not know. */
  meaning: string | null;
  /** Its own expiry when printed, else the licence's. */
  expiryDate: string | null;
}

/** A restriction code of a driving licence (field 12), explained. */
export interface RestrictionCodeDto {
  code: string;
  meaning: string | null;
}

/**
 * What only some ID documents print, beyond the holder and the dates. Every
 * value is null when it is not printed (or not read).
 */
export interface IdDocumentDetailsDto {
  heightCm: number | null;
  /** Identity card: electronic (CIE) or paper. */
  cardFormat: 'electronic' | 'paper' | null;
  /** CIE: the 6-digit card access number, needed to use it with a phone. */
  cardAccessNumber: string | null;
  /** False when printed "non valida per l'espatrio". */
  validForTravel: boolean | null;
  passportType: string | null;
  eyeColor: string | null;
  /** Health card: tessera sanitaria or tesserino codice fiscale. */
  healthCardKind: string | null;
  /** Health card: the institution code on the back, which makes it a European health card (TEAM / EHIC). */
  institutionCode: string | null;
  licenceCategories: LicenceCategoryDto[];
  restrictionCodes: RestrictionCodeDto[];
}

export interface IdDocumentVersionDto {
  uploadId: string;
  title: string;
  type: IdDocumentType | null;
  version: number;
  status: IdDocumentStatus;
  documentNumber: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  uploadedAt: string;
  reviewedAt: string;
  details: IdDocumentDetailsDto;
}

/** One kind of document of one person, newest version first. */
export interface IdDocumentSeriesDto {
  type: IdDocumentType | null;
  versions: IdDocumentVersionDto[];
}

export type ExpiryAlertLevel = 'expired' | 'expiring';

/** The latest version of a series is expired or about to be. */
export interface ExpiryAlertDto {
  level: ExpiryAlertLevel;
  personId: string;
  personName: string;
  uploadId: string;
  type: IdDocumentType | null;
  /**
   * A driving licence category whose own expiry date (field 11) comes before
   * the licence's, e.g. "C"; null for the document itself.
   */
  category: string | null;
  expiryDate: string;
  /** Negative once expired. */
  daysLeft: number;
}

/**
 * Whether the tax code agrees with the person: its check character, and the
 * name, birth date and sex it encodes. The birth place is not checked (it is
 * encoded as a cadastral code).
 */
export type TaxCodeCheckStatus = 'valid' | 'mismatch' | 'invalid' | 'unknown';

export interface TaxCodeCheckDto {
  status: TaxCodeCheckStatus;
  /** What disagrees, in words: "The birth date encoded is 1 Jan 1980". */
  problems: string[];
}

/** How a person is related to another, from this person's side. */
export const RELATION_KINDS = [
  'partner',
  'parent',
  'child',
  'sibling',
  'other',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_LABELS: Record<RelationKind, string> = {
  partner: 'Partner',
  parent: 'Parent',
  child: 'Child',
  sibling: 'Sibling',
  other: 'Family',
};

export interface RelationDto {
  personId: string;
  /** What the other person is to this one: "parent" means they are this person's parent. */
  kind: RelationKind;
}

/** Something worth knowing about a person, worked out from their data and documents. */
export interface PersonNoticeDto {
  level: 'info' | 'warning';
  text: string;
}

export interface PersonDto extends PersonValues {
  id: string;
  /**
   * The house of the Home area this person lives in, when you picked one for
   * Residence; `residenceAddress` then holds that house's address.
   */
  residencePropertyId: string | null;
  createdAt: string;
  updatedAt: string;
  series: IdDocumentSeriesDto[];
  alerts: ExpiryAlertDto[];
  taxCodeCheck: TaxCodeCheckDto;
  /** Whole years today, from the birth date. */
  age: number | null;
  relations: RelationDto[];
  /** The person this one is a fiscal dependent of (familiare a carico), for the 730. */
  taxDependentOf: string | null;
  notices: PersonNoticeDto[];
}

export type ChangeKind = 'new_value' | 'different_value';
export type ChangeSuggestion = 'accept' | 'keep_current' | 'check';

export interface ProposedChangeDto {
  field: PersonField;
  kind: ChangeKind;
  current: string | null;
  proposed: string;
  suggestion: ChangeSuggestion;
}

/** How the holder of a document was matched to the people you have. */
export type PersonMatch = 'tax_code' | 'name_and_birth_date' | 'none';

/** An ID document waiting for you: whose it is and what it would change. */
export interface PendingReviewDto {
  uploadId: string;
  title: string;
  type: IdDocumentType | null;
  uploadedAt: string;
  holder: PersonValues;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** The person it was matched to; null: a new person. */
  personId: string | null;
  match: PersonMatch;
  /** Against the matched person (for a new person, every printed value). */
  changes: ProposedChangeDto[];
  /** Expired, or older than the version you already have: suggests keeping your data. */
  outdated: boolean;
  /** The printed tax code against the printed name, birth date and sex (the matched person's where not printed). */
  taxCodeCheck: TaxCodeCheckDto;
}

/** Decided ID documents that are not about anyone (rejected). */
export interface RejectedDocumentDto {
  uploadId: string;
  title: string;
  type: IdDocumentType | null;
  decidedAt: string;
}

export interface PeopleOverviewDto {
  people: PersonDto[];
  reviews: PendingReviewDto[];
  alerts: ExpiryAlertDto[];
  rejected: RejectedDocumentDto[];
}

/** What the island hub shows on the People card: what needs you. */
export interface PeopleAttentionDto {
  expired: number;
  expiring: number;
  toReview: number;
}

export const approveReviewRequestSchema = z.object({
  /** The person it belongs to; null creates a new person from it. */
  personId: z.uuid().nullable(),
  /** The fields whose printed value you take; the others keep the person's value. */
  accept: z.array(z.enum(PERSON_FIELDS)).default([]),
});
export type ApproveReviewRequest = z.input<typeof approveReviewRequestSchema>;

export const markDocumentRequestSchema = z.object({
  /** Lost, stolen or withdrawn; null puts it back to what its dates say. */
  status: z.enum(MARKABLE_STATUSES).nullable(),
});
export type MarkDocumentRequest = z.input<typeof markDocumentRequestSchema>;

/**
 * A change to a person. Residence is a house picked from the Home area
 * (`residencePropertyId`, with its address in `residenceAddress`) or a typed
 * address: sending `residenceAddress` without `residencePropertyId` unlinks
 * the house.
 */
export const updatePersonRequestSchema = personValues.partial().extend({
  residencePropertyId: z.uuid().nullable().optional(),
  /** The person this one is a fiscal dependent of; null: nobody's. */
  taxDependentOf: z.uuid().nullable().optional(),
});
export type UpdatePersonRequest = z.input<typeof updatePersonRequestSchema>;

/**
 * Merges a duplicate into this person: its ID documents move here, this
 * person's details stay, and only the ones still unknown are taken from it.
 */
export const mergePeopleRequestSchema = z.object({
  /** The duplicate, removed once its documents have moved. */
  from: z.uuid(),
});
/** Sets how another person is related to this one (replacing what was there). */
export const setRelationRequestSchema = z.object({
  personId: z.uuid(),
  /** What the other person is to this one. */
  kind: z.enum(RELATION_KINDS),
});
export type SetRelationRequest = z.input<typeof setRelationRequestSchema>;

/** The latest driving licence of a person, for the Cars area. */
export interface PersonLicenceDto {
  status: 'valid' | 'expiring' | 'expired' | 'unusable';
  expiryDate: string | null;
  daysLeft: number | null;
  categories: string[];
}

/** A person in short, for other areas to pick (the Houses area offers them as owners). */
export interface PersonSummaryDto {
  id: string;
  lastName: string | null;
  firstName: string | null;
  taxCode: string | null;
  residencePropertyId: string | null;
  /** The person this one is a fiscal dependent of (familiare a carico). */
  taxDependentOf: string | null;
  /** Their latest driving licence; null when they have none on file. */
  drivingLicence: PersonLicenceDto | null;
}

/** A house of the Home area, as People offers it for Residence. */
export interface ResidenceHouseDto {
  id: string;
  name: string;
  /** Address and city as one line, or null when the house has neither. */
  address: string | null;
}

export interface ResidenceHousesDto {
  houses: ResidenceHouseDto[];
  /** False when the Home service could not be reached: Residence is typed for now. */
  available: boolean;
}

export type MergePeopleRequest = z.input<typeof mergePeopleRequestSchema>;
