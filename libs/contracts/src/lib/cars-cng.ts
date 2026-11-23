import type { RenewalLevel } from './cars.js';

/*
 * The CNG (metano) cylinders of a car. Every cylinder of a car that runs on
 * methane has to be requalified (the "revisione delle bombole") at fixed
 * intervals, apart from the car's own revisione:
 *
 * - UNECE R110 cylinders (CNG-1, CNG-2, CNG-3, CNG-4), every car built or
 *   converted since the 2000s: every 4 years (DM 13 May 2022 n. 144, art. 2,
 *   GU n. 162 of 13 July 2022; for CNG-4 on M1 and N1 vehicles "salvo diversa
 *   indicazione del costruttore"). The first requalification is visual.
 * - Cylinders with the older national approval (DGM): every 5 years, as
 *   before the decree (its art. 2 c. 1 keeps the earlier rules).
 * - An R110 cylinder is used at most until the end of life its maker marks
 *   on it, never more than 20 years.
 *
 * The workshop (an officina recognised by the Fondo Bombole Metano) applies a
 * label (cartellino) on the car with each cylinder's litres, maker, serial
 * number and next due month; that month is what counts. No law asks you to
 * carry a document for the cylinders: the label is fixed on the car, and art.
 * 180 Codice della strada lists only the carta di circolazione, the licence
 * and the insurance certificate.
 */

/** Fuels (field P.3) whose car carries CNG cylinders. LNG tanks follow other rules. */
export const CNG_FUELS = ['cng', 'petrol_cng'] as const;

/** Whether a car with this fuel (P.3) has CNG cylinders to requalify. */
export function usesCngCylinders(fuel: unknown): boolean {
  return (CNG_FUELS as readonly unknown[]).includes(fuel);
}

/** How a cylinder was approved, which sets its interval. */
export const CNG_APPROVALS = ['r110', 'national'] as const;
export type CngApproval = (typeof CNG_APPROVALS)[number];
export const CNG_APPROVAL_LABELS: Record<CngApproval, string> = {
  r110: 'UNECE R110',
  national: 'National (DGM)',
};

/** Months between requalifications, by approval (DM 144/2022 art. 2). */
export const CNG_INTERVAL_MONTHS: Record<CngApproval, number> = {
  r110: 48,
  national: 60,
};

/** The longest an R110 cylinder may be used, from its manufacture (DM 144/2022). */
export const CNG_MAX_LIFE_YEARS = 20;

/** The cylinder types of UNECE R110, as the label or the cylinder prints them. */
export const CNG_CYLINDER_TYPES = ['CNG1', 'CNG2', 'CNG3', 'CNG4'] as const;
export type CngCylinderType = (typeof CNG_CYLINDER_TYPES)[number];

/** How many cylinders the template reads (a label has five rows; cars have one to four). */
export const CNG_MAX_CYLINDERS = 4;

/** One cylinder, as the label lists it. */
export interface CngCylinderDto {
  litres: number | null;
  make: string | null;
  serialNumber: string | null;
  /** The month it is due again, YYYY-MM, as printed. */
  dueMonth: string | null;
}

/** One requalification (one label) of the car's cylinders. */
export interface CngInspectionDto {
  /** The label's file. */
  uploadId: string;
  /** The month the label was applied, YYYY-MM. */
  month: string | null;
  workshop: string | null;
  /** Numero progressivo of the label. */
  labelNumber: string | null;
  cylinders: CngCylinderDto[];
  /** True when its serial numbers differ from the label before: the cylinders were exchanged. */
  replaced: boolean;
}

/**
 * The CNG section of a car: shown for every car whose fuel (P.3) is CNG, and
 * for any car with a cylinder label on file.
 */
export interface CarCngDto {
  /** As read from the latest label; null when unknown (assumed R110). */
  approval: CngApproval | null;
  cylinderType: CngCylinderType | null;
  totalLitres: number | null;
  /** The cylinders of the latest label. */
  cylinders: CngCylinderDto[];
  /** The last day the cylinders can be used without a new requalification. */
  dueDate: string | null;
  level: RenewalLevel;
  daysLeft: number | null;
  /** How the date was found. */
  basis: string;
  /** End of life of the cylinders, when printed or worked out from their manufacture. */
  endOfLife: string | null;
  /** Every label on file, newest first. */
  history: CngInspectionDto[];
}

/** The cylinder template's month fields: printed "07/2027" or "luglio 2023" become YYYY-MM. */
export const CNG_MONTH_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';
