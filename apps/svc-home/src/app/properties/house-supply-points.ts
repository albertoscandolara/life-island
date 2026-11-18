import {
  supplyCodeUtility,
  type PropertyDto,
  type UtilityKind,
} from '@life-island/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { bills, supplyPoints } from '../db/schema.js';
import { normalizeCode } from '../bills/bill-reader.js';

/** What a house has of supply points: one code per utility, and every code it ever had. */
export interface HouseSupply {
  points: Record<UtilityKind, string | null>;
  /** Typed codes and the codes of every supply point on it, normalised. */
  codes: string[];
}

/** A supply point on a house, with the last day its bills cover. */
export interface HousePointLike {
  propertyId: string | null;
  utility: UtilityKind;
  code: string;
  lastDay: string | null;
  createdAt: Date | string;
}

const none = (): Record<UtilityKind, string | null> => ({
  ELECTRICITY: null,
  GAS: null,
  WATER: null,
  INTERNET: null,
});

/**
 * The supply point of each utility of a house: the one billed last (a new
 * POD after a meter change wins over the old one; one with no bill yet
 * counts from the day it was added), else the code you typed
 * of that utility (a POD and a PDR by their shape; a code of no known shape
 * is the water one). Pure, for tests.
 */
export function houseSupply(
  typed: readonly string[],
  points: readonly HousePointLike[],
): HouseSupply {
  const result = none();
  // The last day billed; a point with no bill yet (one you just typed)
  // counts from the day it was added, so it takes over from the old one.
  const day = (p: HousePointLike) =>
    p.lastDay ?? new Date(p.createdAt).toISOString().slice(0, 10);
  const newest = [...points].sort((a, b) => day(b).localeCompare(day(a)));
  for (const point of newest) result[point.utility] ??= point.code;
  const known = new Map(points.map((p) => [normalizeCode(p.code), p.utility]));
  for (const code of typed) {
    const plain = normalizeCode(code);
    const utility = known.get(plain) ?? supplyCodeUtility(plain) ?? 'WATER';
    // A typed code of a utility that has a billed point is its history.
    if (!points.some((p) => p.utility === utility)) result[utility] ??= plain;
  }
  return {
    points: result,
    codes: [
      ...new Set([
        ...typed.map(normalizeCode),
        ...points.map((p) => normalizeCode(p.code)),
      ]),
    ],
  };
}

/** The supply points of these houses (every house when no ids are given). */
export async function loadHouseSupply(
  db: NodePgDatabase,
  houses: readonly { id: string; supplyCodes: string[] }[],
): Promise<Map<string, HouseSupply>> {
  const ids = houses.map((h) => h.id);
  const rows = ids.length
    ? await db
        .select({
          propertyId: supplyPoints.propertyId,
          utility: supplyPoints.utility,
          code: supplyPoints.code,
          createdAt: supplyPoints.createdAt,
          lastDay: sql<
            string | null
          >`max(coalesce(${bills.periodEnd}, ${bills.issueDate}))::text`,
        })
        .from(supplyPoints)
        .leftJoin(bills, eq(bills.supplyPointId, supplyPoints.id))
        .where(inArray(supplyPoints.propertyId, ids))
        .groupBy(supplyPoints.id)
    : [];
  return new Map(
    houses.map((house) => [
      house.id,
      houseSupply(
        house.supplyCodes,
        rows
          .filter((r) => r.propertyId === house.id)
          .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      ),
    ]),
  );
}

/** A house DTO with its supply points filled in. */
export function withSupply(
  dto: PropertyDto,
  supply: HouseSupply | undefined,
): PropertyDto {
  return supply
    ? { ...dto, supplyPoints: supply.points, supplyCodes: supply.codes }
    : dto;
}
