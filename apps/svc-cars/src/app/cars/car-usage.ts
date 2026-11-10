import type {
  CarCostDto,
  CarUsageDto,
  FuelFillDto,
  OdometerReadingDto,
  VehicleField,
  VehicleValue,
} from '@life-island/contracts';
import {
  addDays,
  daysUntil,
  type ApprovedCarDocument,
  type OdometerTrend,
} from './car-documents.js';

/** Readings closer than this say little about the km a year. */
const MIN_TREND_DAYS = 30;
/** A consumption outside this range is a misread (or a partial fill). */
const MIN_L100 = 2;
const MAX_L100 = 40;

const round = (n: number, digits = 2) =>
  Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Every km reading the car's approved documents print (revisione, service,
 * fuel...), oldest first. A reading lower than one of an earlier day is an
 * anomaly: a misread, or an odometer wound back.
 */
export function odometerReadings(
  documents: readonly (ApprovedCarDocument & { title: string })[],
): OdometerReadingDto[] {
  const readings = documents
    .filter(
      (d) =>
        d.markedStatus !== 'cancelled' &&
        d.reading.odometerKm !== null &&
        d.reading.odometerKm > 0 &&
        (d.reading.validFrom ?? d.reading.costDate),
    )
    .map((d) => ({
      uploadId: d.uploadId,
      title: d.title,
      date: (d.reading.validFrom ?? d.reading.costDate) as string,
      km: d.reading.odometerKm as number,
      anomaly: false,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  let highest = -1;
  let highestDate = '';
  for (const reading of readings) {
    if (reading.km < highest && reading.date > highestDate)
      reading.anomaly = true;
    else if (reading.km >= highest) {
      highest = reading.km;
      highestDate = reading.date;
    }
  }
  return readings;
}

/** The km a year from the first and last good readings, and today's estimate. */
export function odometerTrend(
  readings: readonly OdometerReadingDto[],
  today: string,
): OdometerTrend {
  const good = readings.filter((r) => !r.anomaly);
  const first = good.at(0);
  const last = good.at(-1);
  if (!first || !last)
    return { kmPerYear: null, last: null, estimatedKm: null };
  const days = daysUntil(last.date, first.date);
  const kmPerYear =
    days >= MIN_TREND_DAYS && last.km > first.km
      ? round(((last.km - first.km) / days) * 365, 0)
      : null;
  const since = Math.max(0, daysUntil(today, last.date));
  return {
    kmPerYear,
    last: { date: last.date, km: last.km },
    estimatedKm:
      kmPerYear === null
        ? last.km
        : Math.round(last.km + (kmPerYear * since) / 365),
  };
}

/**
 * Fuel receipts with litres, newest first, each with the consumption since
 * the previous fill with km (as if every fill topped the tank up).
 */
export function fuelFills(costs: readonly CarCostDto[]): FuelFillDto[] {
  const fills = costs
    .filter(
      (c) => c.kind === 'fuel' && c.date && c.litres !== null && c.litres > 0,
    )
    .map((c) => ({
      uploadId: c.uploadId,
      date: c.date as string,
      litres: c.litres as number,
      amount: c.amount,
      pricePerLitre: round(c.amount / (c.litres as number), 3),
      odometerKm: c.odometerKm,
      litresPer100Km: null as number | null,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.odometerKm ?? 0) - (b.odometerKm ?? 0),
    );
  let previousKm: number | null = null;
  for (const fill of fills) {
    if (fill.odometerKm === null) continue;
    if (previousKm !== null && fill.odometerKm > previousKm) {
      const l100 = (fill.litres / (fill.odometerKm - previousKm)) * 100;
      if (l100 >= MIN_L100 && l100 <= MAX_L100)
        fill.litresPer100Km = round(l100, 1);
    }
    previousKm = fill.odometerKm;
  }
  return fills.reverse();
}

/** Litres over the km between the first and the last fill with km. */
export function averageConsumption(
  fills: readonly FuelFillDto[],
): number | null {
  const withKm = fills
    .filter((f) => f.odometerKm !== null)
    .sort((a, b) => (a.odometerKm as number) - (b.odometerKm as number));
  if (withKm.length < 2) return null;
  const km =
    (withKm.at(-1)?.odometerKm as number) - (withKm[0].odometerKm as number);
  if (km <= 0) return null;
  // The first fill's litres were burnt before the first reading.
  const litres = withKm.slice(1).reduce((sum, f) => sum + f.litres, 0);
  const l100 = (litres / km) * 100;
  return l100 >= MIN_L100 && l100 <= MAX_L100 ? round(l100, 1) : null;
}

export function carUsage(
  documents: readonly (ApprovedCarDocument & { title: string })[],
  costs: readonly CarCostDto[],
  values: Partial<Record<VehicleField, VehicleValue>>,
  today: string,
): { usage: CarUsageDto; trend: OdometerTrend } {
  const readings = odometerReadings(documents);
  const trend = odometerTrend(readings, today);
  const fills = fuelFills(costs);
  const yearAgo = addDays(today, -365);
  const recent = fills.filter((f) => f.date > yearAgo);
  const priced = recent.length ? recent : fills;
  const litres = priced.reduce((sum, f) => sum + f.litres, 0);
  const pricePerLitre = litres
    ? round(priced.reduce((sum, f) => sum + f.amount, 0) / litres, 3)
    : null;
  const litresPer100Km = averageConsumption(fills);
  const official = values['emissions.combinedFuelConsumptionL100km'];
  const costLast12Months = round(
    costs
      .filter((c) => c.date && c.date > yearAgo && c.date <= today)
      .reduce((sum, c) => sum + c.amount, 0),
  );
  return {
    trend,
    usage: {
      readings,
      kmPerYear: trend.kmPerYear,
      estimatedKm: trend.estimatedKm,
      fills,
      litresPer100Km,
      officialLitresPer100Km: typeof official === 'number' ? official : null,
      pricePerLitre,
      fuelCostPerKm:
        litresPer100Km !== null && pricePerLitre !== null
          ? round((litresPer100Km / 100) * pricePerLitre, 3)
          : null,
      costLast12Months,
      costPerKm:
        trend.kmPerYear && costLast12Months
          ? round(costLast12Months / trend.kmPerYear, 3)
          : null,
    },
  };
}
