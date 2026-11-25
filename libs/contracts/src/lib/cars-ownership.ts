/*
 * Who owns a car, apart from who drives it. In Italy ownership is recorded at
 * the Pubblico Registro Automobilistico (PRA, run by ACI), not on the carta di
 * circolazione:
 *
 * - The certificato di proprietà (CdP) proves who owns the car and lists any
 *   lien on it (fermo amministrativo, ipoteca). Paper until October 2015,
 *   digital since (CDPD: a receipt with an access code to see it online).
 * - A change of owner (passaggio di proprietà) is recorded at the PRA within
 *   60 days of the signed sale (art. 94 Codice della strada): the sale (atto
 *   di vendita, or the dichiarazione di vendita on the back of the paper CdP)
 *   and the PRA's receipt (attestazione di presentazione formalità) date it.
 * - Since 2020 the Documento Unico (DU) holds the carta di circolazione and
 *   the ownership in one: a car registered or changing owner since has no
 *   certificate of its own.
 *
 * Cars reads these documents as VEHICLE_OWNERSHIP, one card beside the
 * libretto, and every one of them as a step in the car's history of owners.
 */

/** What an ownership document is. */
export const OWNERSHIP_DOCUMENT_KINDS = [
  /** The certificato di proprietà, paper or digital (CDPD). */
  'certificate',
  /** The PRA's receipt of a change of owner (attestazione, trasferimento di proprietà). */
  'transfer',
  /** The sale itself: atto di vendita, dichiarazione di vendita. */
  'sale',
  /** A visura PRA, a lien recorded or cancelled, anything else. */
  'other',
] as const;
export type OwnershipDocumentKind = (typeof OWNERSHIP_DOCUMENT_KINDS)[number];
export const OWNERSHIP_DOCUMENT_KIND_LABELS: Record<
  OwnershipDocumentKind,
  string
> = {
  certificate: 'Certificato di proprietà',
  transfer: 'Change of owner recorded at the PRA',
  sale: 'Sale (atto di vendita)',
  other: 'PRA document',
};

/** One step of a car's history of owners, oldest first. */
export interface CarOwnershipEventDto {
  /** The day it happened: the sale, else the day the document was issued. */
  date: string | null;
  /** 'registered': the car's first registration (B), from the libretto. */
  kind: OwnershipDocumentKind | 'registered';
  /** The owners it names, as printed. */
  owners: string[];
  /** Who sold, when a sale prints it. */
  seller: string | null;
  /** The document it comes from; null for the first registration. */
  uploadId: string | null;
}

/** Who owns the car, as the latest ownership document says. */
export interface CarOwnershipDto {
  /** The owners, as printed (one, or several co-owners). */
  owners: string[];
  /** The day they became owners: the sale, else the certificate's date. */
  since: string | null;
  /** Owners before them, as the certificate counts them (precedenti intestazioni). */
  previousOwners: number | null;
  /** Liens as printed (fermo amministrativo, ipoteca); null when none is. */
  liens: string | null;
  /** True when the certificate says no lien is recorded. */
  noLiens: boolean;
  /** The certificate's number. */
  certificateNumber: string | null;
  /** The code to see a digital certificate online (and to hand to a buyer). */
  accessCode: string | null;
  /**
   * The holder (intestatario, C.1) the libretto names, when the latest
   * ownership document names someone else: after a change of owner the carta
   * di circolazione has to follow.
   */
  holderDiffers: string | null;
  /** Every change of owner on file, oldest first, from the first registration. */
  events: CarOwnershipEventDto[];
}
