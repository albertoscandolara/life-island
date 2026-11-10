import {
  TYRE_CHECK_AGE_YEARS,
  TYRE_MIN_TREAD_MM,
  TYRE_REPLACE_AGE_YEARS,
  TYRE_SEASON_LABELS,
  TYRE_SPEED_INDEX_KMH,
  TYRE_SUMMER_TREAD_MM,
  TYRE_WINTER_TREAD_MM,
  type RenewalDto,
  type TyreNoteDto,
  type TyreSetDto,
} from '@life-island/contracts';
import type { TyreSetRow } from '../db/schema.js';
import { daysUntil } from './car-documents.js';

/*
 * The Italian winter-tyre rule (art. 6 Codice della Strada, circolare MIT
 * 2013): where a road or a province requires it, from 15 November to 15 April
 * a car needs winter tyres (M+S) or chains on board. Winter tyres can go on
 * from 15 October; those with a speed index lower than the card's must come
 * off by 15 May. Summer tyres always need at least the card's speed index.
 */
export const WINTER_FROM = '11-15';
export const WINTER_UNTIL = '04-15';
export const FIT_FROM = '10-15';
export const REMOVE_BY = '05-15';

/** "205/55 R16 91H" → H. */
export function speedIndexOf(size: string | null): string | null {
  if (!size) return null;
  const matches = [
    ...size
      .toUpperCase()
      .matchAll(/\d{2,3}(?:\/\d{2,3})?\s*([LMNPQRSTUHVWY])\b/g),
  ];
  return matches.at(-1)?.[1] ?? null;
}

/** "2321" (week 23 of 2021) → its age in years, one decimal. */
export function tyreAgeYears(dot: string | null, today: string): number | null {
  if (!dot || !/^\d{4}$/.test(dot)) return null;
  const week = Number(dot.slice(0, 2));
  const year = 2000 + Number(dot.slice(2));
  if (week < 1 || week > 53) return null;
  const made = Date.UTC(year, 0, 1 + (week - 1) * 7);
  const days = (Date.parse(`${today}T00:00:00Z`) - made) / 86_400_000;
  return days < 0 ? 0 : Math.round((days / 365.25) * 10) / 10;
}

const mm = (n: number) => String(n).replace('.', ',');

export function tyreChecks(
  set: Pick<
    TyreSetDto,
    'season' | 'treadMm' | 'ageYears' | 'speedIndex' | 'speedKmh'
  >,
  maxSpeedKmh: number | null,
): TyreNoteDto[] {
  const checks: TyreNoteDto[] = [];
  const tread = set.treadMm;
  if (tread !== null) {
    if (tread < TYRE_MIN_TREAD_MM)
      checks.push({
        tone: 'danger',
        text: `Tread ${mm(tread)} mm: below the legal ${TYRE_MIN_TREAD_MM} mm, replace them`,
      });
    else if (set.season === 'winter' && tread < TYRE_WINTER_TREAD_MM)
      checks.push({
        tone: 'warning',
        text: `Tread ${mm(tread)} mm: under ${TYRE_WINTER_TREAD_MM} mm a winter tyre grips little on snow`,
      });
    else if (set.season !== 'winter' && tread < TYRE_SUMMER_TREAD_MM)
      checks.push({
        tone: 'warning',
        text: `Tread ${mm(tread)} mm: under ${TYRE_SUMMER_TREAD_MM} mm braking in the wet gets longer`,
      });
  }
  if (set.ageYears !== null) {
    if (set.ageYears >= TYRE_REPLACE_AGE_YEARS)
      checks.push({
        tone: 'danger',
        text: `${Math.floor(set.ageYears)} years old: replace them, whatever the tread`,
      });
    else if (set.ageYears >= TYRE_CHECK_AGE_YEARS)
      checks.push({
        tone: 'warning',
        text: `${Math.floor(set.ageYears)} years old: the rubber hardens, have them checked`,
      });
  }
  if (
    set.speedKmh !== null &&
    maxSpeedKmh !== null &&
    set.speedKmh < maxSpeedKmh
  ) {
    if (set.season === 'winter')
      checks.push({
        tone: 'ok',
        text: `Speed index ${set.speedIndex} (${set.speedKmh} km/h) is below the card's ${maxSpeedKmh} km/h: allowed only from 15 Oct to 15 May`,
      });
    else
      checks.push({
        tone: 'danger',
        text: `Speed index ${set.speedIndex} (${set.speedKmh} km/h) is below the card's ${maxSpeedKmh} km/h: not allowed`,
      });
  }
  return checks;
}

export function tyreSetOf(
  row: TyreSetRow,
  maxSpeedKmh: number | null,
  today: string,
): TyreSetDto {
  const speedIndex = speedIndexOf(row.size);
  const base = {
    id: row.id,
    season: row.season,
    label: row.label,
    size: row.size,
    dot: row.dot,
    purchasedOn: row.purchasedOn,
    treadMm: row.treadMm,
    mounted: row.mounted,
    storedAt: row.storedAt,
    notes: row.notes,
    ageYears: tyreAgeYears(row.dot, today),
    speedIndex,
    speedKmh: speedIndex ? (TYRE_SPEED_INDEX_KMH[speedIndex] ?? null) : null,
  };
  return { ...base, checks: tyreChecks(base, maxSpeedKmh) };
}

/** The day `mmdd` falls on next, today included. */
function next(mmdd: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${mmdd}`;
  return thisYear >= today ? thisYear : `${year + 1}-${mmdd}`;
}

/** The day `mmdd` fell on last, today included. */
function last(mmdd: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${mmdd}`;
  return thisYear <= today ? thisYear : `${year - 1}-${mmdd}`;
}

/**
 * Where the tyres on the car stand with the season, then their own checks
 * (tread, age, speed index). Nothing when no tyre set was added.
 */
export function tyreRenewals(
  sets: readonly TyreSetDto[],
  maxSpeedKmh: number | null,
  today: string,
): RenewalDto[] {
  if (!sets.length) return [];
  const base = {
    kind: 'tyres' as const,
    graceUntil: null,
    uploadId: null,
    dueOdometerKm: null,
  };
  const on = sets.find((s) => s.mounted);
  if (!on)
    return [
      {
        ...base,
        subject: 'Tyres on the car',
        level: 'missing',
        dueDate: null,
        daysLeft: null,
        basis:
          'Mark which tyre set is on the car to get the winter-tyre reminders',
      },
    ];
  const mmdd = today.slice(5);
  const name = `${TYRE_SEASON_LABELS[on.season]} tyres${on.label ? ` (${on.label})` : ''}`;
  const dated = (
    level: RenewalDto['level'],
    dueDate: string | null,
    basis: string,
    subject = dueDate ? 'Tyre change' : name,
  ): RenewalDto => ({
    ...base,
    subject,
    level,
    dueDate,
    daysLeft: dueDate ? daysUntil(dueDate, today) : null,
    basis,
  });
  const renewals: RenewalDto[] = [];
  const inWinter = mmdd >= WINTER_FROM || mmdd <= WINTER_UNTIL;
  if (on.season === 'summer') {
    if (inWinter)
      renewals.push(
        dated(
          'expired',
          last(WINTER_FROM, today),
          'From 15 Nov to 15 Apr, winter tyres or chains on board are required on roads and in provinces that ask for them',
        ),
      );
    else
      renewals.push(
        dated(
          mmdd >= FIT_FROM ? 'expiring' : 'ok',
          next(WINTER_FROM, today),
          'Fit winter tyres (from 15 Oct) or carry chains by 15 Nov where the winter rule applies',
        ),
      );
  } else if (on.season === 'winter') {
    const allYear =
      on.speedKmh !== null &&
      maxSpeedKmh !== null &&
      on.speedKmh >= maxSpeedKmh;
    if (allYear)
      renewals.push(
        dated(
          'ok',
          null,
          `Speed index ${on.speedIndex} is at least the card's: they can stay on all year`,
        ),
      );
    else {
      const unknown = on.speedKmh === null || maxSpeedKmh === null;
      const why = unknown
        ? "Winter tyres must come off by 15 May unless their speed index is at least the card's (add the size to check)"
        : "Their speed index is lower than the card's: they must come off by 15 May";
      if (mmdd > WINTER_UNTIL && mmdd <= REMOVE_BY)
        renewals.push(dated('expiring', next(REMOVE_BY, today), why));
      else if (mmdd > REMOVE_BY && mmdd < FIT_FROM)
        renewals.push(dated('expired', last(REMOVE_BY, today), why));
      else renewals.push(dated('ok', next(REMOVE_BY, today), why));
    }
  } else
    renewals.push(
      dated(
        'ok',
        null,
        'All-season tyres (M+S) count as winter tyres all year',
      ),
    );
  for (const check of on.checks)
    if (check.tone !== 'ok')
      renewals.push(
        dated(
          check.tone === 'danger' ? 'expired' : 'expiring',
          null,
          check.text,
        ),
      );
  return renewals;
}
