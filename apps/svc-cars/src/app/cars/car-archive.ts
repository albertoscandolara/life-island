import {
  CAR_ARCHIVE_FOLDERS,
  FINE_CLAIM_YEARS,
  INSURANCE_GRACE_DAYS,
  LAID_UP_WARNING,
  ROAD_TAX_CLAIM_YEARS,
  ROAD_TAX_CLAIM_YEARS_PIEMONTE,
  WARRANTY_YEARS,
  type CarArchiveAction,
  type CarArchiveDto,
  type CarArchiveFileDto,
  type CarArchiveFolder,
  type CarArchiveItemDto,
  type CarArchiveRule,
  type CarDocumentSeriesDto,
  type CarDocumentVersionDto,
  type CarFineDto,
  type ExpenseKind,
  type RenewalDto,
  type VehicleStatus,
} from '@life-island/contracts';
import { addDays, addMonths } from './car-documents.js';

/*
 * Which documents of a car to keep (docs/guides/life-island-app.md,
 * Cars, "Documents to keep"): the current insurance certificate and the latest revisione go in
 * the car, the bollo receipts stay at home until the Regione can no longer
 * claim them, the service history stays as long as the car, a fine until it
 * can no longer be collected, the rest can go. Pure, so every rule is
 * unit-tested on its own.
 */

/** An approved expense document of the car. */
export interface ArchiveExpense {
  uploadId: string;
  title: string;
  kind: ExpenseKind | null;
  date: string | null;
  cancelled: boolean;
}

export interface ArchiveInput {
  /** In use: only then does anything go in the car; laid up keeps its suspended policy. */
  status: VehicleStatus;
  series: readonly CarDocumentSeriesDto[];
  expenses: readonly ArchiveExpense[];
  fines: readonly CarFineDto[];
}

const MAINTENANCE: readonly ExpenseKind[] = [
  'scheduled_service',
  'repair',
  'tyres',
  'body_work',
];
const UNDER_WARRANTY: readonly ExpenseKind[] = ['accessories', 'other'];

const yearsAfter = (date: string, years: number) => addMonths(date, years * 12);

/**
 * The last day the Regione can claim a bollo: 31 December of the 3rd year
 * after the year it was due (the 5th in Piemonte). A bollo is due within the
 * month its period starts, so the year is that of its start.
 */
export function roadTaxKeepUntil(
  version: Pick<CarDocumentVersionDto, 'validFrom' | 'issuer' | 'uploadedAt'>,
): string {
  const due = +(version.validFrom ?? version.uploadedAt).slice(0, 4);
  const years = /piemonte/i.test(version.issuer ?? '')
    ? ROAD_TAX_CLAIM_YEARS_PIEMONTE
    : ROAD_TAX_CLAIM_YEARS;
  return `${due + years}-12-31`;
}

function filesOf(version: CarDocumentVersionDto): CarArchiveFileDto[] {
  return version.documents.map((d) => ({
    uploadId: d.uploadId,
    title: d.title,
  }));
}

/** What of an insurance record is printed for the car: its certificate, else all of it. */
function certificateOf(version: CarDocumentVersionDto): CarArchiveFileDto[] {
  const certificates = version.documents.filter(
    (d) => d.role === 'certificate',
  );
  return certificates.length
    ? certificates.map((d) => ({ uploadId: d.uploadId, title: d.title }))
    : filesOf(version);
}

function versionItem(
  folder: CarArchiveFolder,
  version: CarDocumentVersionDto,
  action: CarArchiveAction,
  rule: CarArchiveRule,
  keepUntil: string | null,
  printFiles: CarArchiveFileDto[] = [],
): CarArchiveItemDto {
  return {
    uploadId: version.uploadId,
    title: version.title,
    folder,
    action,
    rule,
    date: version.validFrom,
    validUntil: version.validUntil,
    keepUntil,
    files: filesOf(version),
    printFiles: action === 'in_car' ? printFiles : [],
  };
}

function seriesItems(
  series: CarDocumentSeriesDto,
  status: VehicleStatus,
  today: string,
): CarArchiveItemDto[] {
  const active = status === 'active';
  // A laid-up car keeps its libretto on board: it is still yours to move.
  const onBoard = active || status === 'laid_up';
  // Newest first; a cancelled policy never counts as the latest.
  const versions = series.versions;
  const latest = versions.find((v) => v.status !== 'cancelled') ?? null;
  switch (series.type) {
    case 'VEHICLE_REGISTRATION':
      return versions.map((v) =>
        v === latest
          ? versionItem(
              'registration',
              v,
              onBoard ? 'in_car' : 'keep',
              'registration_current',
              null,
            )
          : versionItem('registration', v, 'discard', 'registration_old', null),
      );
    case 'CAR_INSURANCE':
      return versions.map((v) => {
        if (v !== latest)
          return versionItem('insurance', v, 'discard', 'insurance_old', null);
        // The RCA still covers 15 days after it expires: its certificate stays.
        const covers =
          v.status === 'current' ||
          (v.status === 'expired' &&
            !!v.validUntil &&
            addDays(v.validUntil, INSURANCE_GRACE_DAYS) >= today);
        if (active && covers)
          return versionItem(
            'insurance',
            v,
            'in_car',
            'insurance_current',
            null,
            certificateOf(v),
          );
        return versionItem(
          'insurance',
          v,
          'keep',
          status === 'laid_up' ? 'insurance_suspended' : 'insurance_latest',
          null,
        );
      });
    case 'ROAD_TAX':
      return versions.map((v) => {
        const until = roadTaxKeepUntil(v);
        // The latest is kept whatever its date: it is your proof of this year.
        return v === latest || until >= today
          ? versionItem('road_tax', v, 'keep', 'road_tax_claimable', until)
          : versionItem('road_tax', v, 'discard', 'road_tax_old', until);
      });
    case 'VEHICLE_INSPECTION':
      return versions.map((v) =>
        v === latest
          ? versionItem(
              'inspection',
              v,
              active ? 'in_car' : 'keep',
              'inspection_current',
              null,
              filesOf(v),
            )
          : versionItem('inspection', v, 'discard', 'inspection_old', null),
      );
    default:
      return [];
  }
}

function expenseItem(
  expense: ArchiveExpense,
  fine: CarFineDto | undefined,
  today: string,
): CarArchiveItemDto {
  const item = (
    folder: CarArchiveFolder,
    action: CarArchiveAction,
    rule: CarArchiveRule,
    keepUntil: string | null,
  ): CarArchiveItemDto => ({
    uploadId: expense.uploadId,
    title: expense.title,
    folder,
    action,
    rule,
    date: expense.date,
    validUntil: null,
    keepUntil,
    files: [{ uploadId: expense.uploadId, title: expense.title }],
    printFiles: [],
  });
  const kind = expense.kind ?? 'other';
  if (kind === 'fine') {
    const paid = fine?.stage === 'paid';
    const from = fine?.violationDate ?? fine?.notifiedOn ?? expense.date;
    if (!paid || !from) return item('fines', 'keep', 'fine_open', null);
    const until = yearsAfter(from, FINE_CLAIM_YEARS);
    return until >= today
      ? item('fines', 'keep', 'fine_paid', until)
      : item('fines', 'discard', 'fine_old', until);
  }
  if (MAINTENANCE.includes(kind))
    return item('maintenance', 'keep', 'maintenance', null);
  if (UNDER_WARRANTY.includes(kind) && expense.date) {
    const until = yearsAfter(expense.date, WARRANTY_YEARS);
    if (until >= today) return item('other', 'keep', 'warranty', until);
  }
  return item('other', 'discard', 'running_cost', null);
}

/** Every document of one car, by folder, newest first, with what to do with it. */
export function carArchive(input: ArchiveInput, today: string): CarArchiveDto {
  const fineOf = new Map(input.fines.map((f) => [f.uploadId, f]));
  const items = [
    ...input.series.flatMap((s) => seriesItems(s, input.status, today)),
    ...input.expenses
      .filter((e) => !e.cancelled)
      .map((e) => expenseItem(e, fineOf.get(e.uploadId), today)),
  ].sort(
    (a, b) =>
      CAR_ARCHIVE_FOLDERS.indexOf(a.folder) -
        CAR_ARCHIVE_FOLDERS.indexOf(b.folder) ||
      (b.date ?? '').localeCompare(a.date ?? ''),
  );
  const count = (action: CarArchiveAction) =>
    items.filter((i) => i.action === action).length;
  return {
    items,
    inCar: count('in_car'),
    keep: count('keep'),
    discard: count('discard'),
  };
}

/**
 * The renewals of a laid-up car: its insurance is suspended, so it has no
 * date to renew by and warns not to use the car instead. The rest (bollo,
 * revisione, fines) stays as it is: the bollo is owed even on a car standing
 * still.
 */
export function laidUp(
  status: VehicleStatus,
  renewals: RenewalDto[],
): RenewalDto[] {
  if (status !== 'laid_up') return renewals;
  return renewals.map((r) =>
    r.kind === 'insurance'
      ? {
          ...r,
          level: 'suspended',
          dueDate: null,
          daysLeft: null,
          graceUntil: null,
          basis: LAID_UP_WARNING.en,
        }
      : r,
  );
}
