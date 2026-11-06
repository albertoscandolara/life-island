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
  expiryDate: string;
  /** Negative once expired. */
  daysLeft: number;
}

export interface PersonDto extends PersonValues {
  id: string;
  createdAt: string;
  updatedAt: string;
  series: IdDocumentSeriesDto[];
  alerts: ExpiryAlertDto[];
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

export const updatePersonRequestSchema = personValues.partial();
export type UpdatePersonRequest = z.input<typeof updatePersonRequestSchema>;
