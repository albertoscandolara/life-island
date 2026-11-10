import {
  FINE_DISCOUNT_DAYS,
  FINE_DISCOUNT_RATE,
  FINE_JUDGE_APPEAL_DAYS,
  FINE_PAY_DAYS,
  FINE_POINTS_YEARS,
  type CarFineDto,
  type CarFinesDto,
  type DriverPointsDto,
  type FineStage,
  type RenewalDto,
} from '@life-island/contracts';
import {
  addDays,
  daysUntil,
  type ApprovedCarDocument,
} from './car-documents.js';

/** What you added to a fine by hand (the `fines` table). */
export interface FineDetails {
  notifiedOn: string | null;
  paidOn: string | null;
  points: number | null;
  driverPersonId: string | null;
  driverName: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * One fine with its deadlines, which all run from the day it reached you
 * (Codice della Strada): 30% off within 5 days (art. 202), the full minimum
 * within 60, then half the maximum; appeal within 30 days to the Giudice di
 * pace (art. 204-bis) or 60 to the Prefetto (art. 203); when it costs licence
 * points and the driver was not stopped, name the driver within 60 days
 * (art. 126-bis), or a second fine follows.
 */
export function fineOf(
  document: ApprovedCarDocument & { title: string },
  details: FineDetails | undefined,
  today: string,
): CarFineDto {
  const read = document.reading.fine;
  const notifiedOn = details?.notifiedOn ?? read?.notificationDate ?? null;
  const paidOn = details?.paidOn ?? document.reading.paymentDate ?? null;
  const amount = document.reading.amount;
  const points = details?.points ?? read?.points ?? null;
  const reducedAmount =
    read?.reducedAmount ??
    (amount !== null ? round(amount * (1 - FINE_DISCOUNT_RATE)) : null);
  const discountUntil = notifiedOn
    ? addDays(notifiedOn, FINE_DISCOUNT_DAYS)
    : null;
  const payBy = notifiedOn ? addDays(notifiedOn, FINE_PAY_DAYS) : null;
  let stage: FineStage;
  if (paidOn) stage = 'paid';
  else if (!notifiedOn || !discountUntil || !payBy) stage = 'unknown';
  else if (today <= discountUntil) stage = 'discount';
  else if (today <= payBy) stage = 'due';
  else stage = 'late';
  const driverName = details?.driverName ?? null;
  return {
    uploadId: document.uploadId,
    title: document.title,
    authority: document.reading.issuer,
    number: document.reading.number,
    article: read?.article ?? null,
    violationDate: read?.violationDate ?? document.reading.validFrom,
    notifiedOn,
    paidOn,
    amount,
    reducedAmount,
    points,
    driverPersonId: details?.driverPersonId ?? null,
    driverName,
    stage,
    discountUntil,
    payBy,
    judgeAppealBy: notifiedOn
      ? addDays(notifiedOn, FINE_JUDGE_APPEAL_DAYS)
      : null,
    prefectAppealBy: payBy,
    driverBy: points && !driverName ? payBy : null,
  };
}

/**
 * The car's fines, newest first, and the licence points each driver lost to
 * them in the last 2 years.
 */
export function carFines(
  documents: readonly (ApprovedCarDocument & { title: string })[],
  details: ReadonlyMap<string, FineDetails>,
  today: string,
): CarFinesDto {
  const fines = documents
    .filter(
      (d) =>
        d.type === 'VEHICLE_EXPENSE' &&
        d.reading.expenseKind === 'fine' &&
        d.markedStatus !== 'cancelled',
    )
    .map((d) => fineOf(d, details.get(d.uploadId), today))
    .sort((a, b) =>
      (b.violationDate ?? '').localeCompare(a.violationDate ?? ''),
    );
  const since = addDays(today, -365 * FINE_POINTS_YEARS);
  const byDriver = new Map<string, DriverPointsDto>();
  for (const fine of fines) {
    if (!fine.points || (fine.violationDate ?? today) < since) continue;
    const name = fine.driverName ?? 'Driver not named';
    const entry = byDriver.get(name) ?? {
      driverName: name,
      driverPersonId: fine.driverPersonId,
      points: 0,
      fines: 0,
    };
    entry.points += fine.points;
    entry.fines += 1;
    byDriver.set(name, entry);
  }
  return {
    fines,
    points: [...byDriver.values()].sort((a, b) => b.points - a.points),
  };
}

/** A warning for every fine still to pay (or to date), soonest first. */
export function fineRenewals(
  fines: readonly CarFineDto[],
  today: string,
): RenewalDto[] {
  return fines.flatMap((fine): RenewalDto[] => {
    if (fine.stage === 'paid') return [];
    const subject = `Fine${fine.violationDate ? ` of ${shortDate(fine.violationDate)}` : ''}`;
    const base = {
      kind: 'fine' as const,
      subject,
      graceUntil: null,
      uploadId: fine.uploadId,
      dueOdometerKm: null,
    };
    if (fine.stage === 'unknown')
      return [
        {
          ...base,
          level: 'missing',
          dueDate: null,
          daysLeft: null,
          basis:
            'Add the day it reached you: the 5 days of discount and the 60 days to pay run from it',
        },
      ];
    const discount = fine.stage === 'discount';
    const dueDate = (discount ? fine.discountUntil : fine.payBy) as string;
    const daysLeft = daysUntil(dueDate, today);
    const driver = fine.driverBy
      ? ' Name the driver within the same 60 days, or a second fine follows.'
      : '';
    return [
      {
        ...base,
        level: daysLeft < 0 ? 'expired' : 'expiring',
        dueDate,
        daysLeft,
        basis: discount
          ? `30% off (${fine.reducedAmount !== null ? `€ ${fine.reducedAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'the reduced amount'}) if paid within 5 days of notification.${driver}`
          : daysLeft < 0
            ? 'Not paid within 60 days of notification: it now costs half the maximum, and goes to collection.'
            : `Full amount within 60 days of notification; after that, half the maximum.${driver}`,
      },
    ];
  });
}
