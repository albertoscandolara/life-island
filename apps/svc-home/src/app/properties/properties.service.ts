import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  createPropertyRequestSchema,
  supplyCodeUtility,
  updatePropertyRequestSchema,
  UTILITY_KINDS,
  type PropertyDto,
  type UtilityKind,
} from '@life-island/contracts';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import { properties, supplyPoints, type PropertyRow } from '../db/schema.js';
import { BillLedger } from '../bills/bill-ledger.js';
import { normalizeCode, normalizeText } from '../bills/bill-reader.js';
import {
  houseSupply,
  loadHouseSupply,
  withSupply,
} from './house-supply-points.js';
import { PropertyCategories } from './property-categories.js';

type CreateProperty = z.output<typeof createPropertyRequestSchema>;
type UpdateProperty = z.output<typeof updatePropertyRequestSchema>;

export function toPropertyDto(row: PropertyRow): PropertyDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tenure: row.tenure,
    isResidence: row.isResidence,
    address: row.address,
    postalCode: row.postalCode,
    city: row.city,
    province: row.province,
    country: row.country,
    areaSqm: row.areaSqm,
    rooms: row.rooms,
    yearBuilt: row.yearBuilt,
    cadastralSheet: row.cadastralSheet,
    cadastralParcel: row.cadastralParcel,
    cadastralSubunit: row.cadastralSubunit,
    cadastralCategory: row.cadastralCategory,
    cadastralIncome: row.cadastralIncome,
    purchaseDate: row.purchaseDate,
    purchasePrice: row.purchasePrice,
    owners: row.owners,
    electricitySupplier: row.electricitySupplier,
    gasSupplier: row.gasSupplier,
    waterSupplier: row.waterSupplier,
    condoManager: row.condoManager,
    insurer: row.insurer,
    colorSlot: row.colorSlot,
    matchTerms: row.matchTerms,
    supplyCodes: row.supplyCodes,
    // Only what you typed: the service fills in the points billed (withSupply).
    supplyPoints: houseSupply(row.supplyCodes, []).points,
    categoryIds: row.categoryIds,
    notes: row.notes,
    model:
      row.modelKey && row.modelFilename && row.modelFormat
        ? {
            filename: row.modelFilename,
            format: row.modelFormat,
            sizeBytes: row.modelSize ?? 0,
            uploadedAt: (row.modelUploadedAt ?? row.createdAt).toISOString(),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What a request sets, without the fields it leaves out. */
function defined<T extends object>(request: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * "Via Ponzilovo 9" → ["ponzilovo"]: the street without its street word and
 * number, for matching addresses however the number is written.
 */
export function defaultMatchTerms(name: string): string[] {
  const term = normalizeText(name)
    .replace(/^(via|viale|piazza|corso|vicolo|strada|localita|loc)\s+/, '')
    .replace(/(\s+(n|nr|civ)?\s*\d+[a-z]?)+$/, '')
    .trim();
  return term.length > 1 ? [term] : [];
}

/** The lowest colour slot no property holds, so a colour always follows its property. */
export function nextColorSlot(taken: number[]): number {
  let slot = 0;
  while (taken.includes(slot)) slot++;
  return slot;
}

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(PropertyCategories) private readonly links: PropertyCategories,
    @Inject(BillLedger) private readonly ledger: BillLedger,
  ) {}

  async list(): Promise<PropertyDto[]> {
    const rows = await this.svc.db
      .select()
      .from(properties)
      .orderBy(asc(properties.colorSlot), asc(properties.createdAt));
    const supply = await loadHouseSupply(this.svc.db, rows);
    return rows.map((row) =>
      withSupply(toPropertyDto(row), supply.get(row.id)),
    );
  }

  /** A house as the API shows it, with its supply points. */
  async dto(row: PropertyRow): Promise<PropertyDto> {
    const supply = await loadHouseSupply(this.svc.db, [row]);
    return withSupply(toPropertyDto(row), supply.get(row.id));
  }

  async get(id: string): Promise<PropertyRow> {
    const [row] = await this.svc.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!row) throw new NotFoundException(`Property ${id} not found`);
    return row;
  }

  async create(request: CreateProperty): Promise<PropertyDto> {
    const { supplyPoints: points, ...fields } = request;
    request = fields;
    const row = await this.svc.db.transaction(async (tx) => {
      const taken = await tx
        .select({ slot: properties.colorSlot })
        .from(properties);
      // Only one residence: a new one takes the place of the old one.
      if (request.isResidence)
        await tx
          .update(properties)
          .set({ isResidence: false })
          .where(eq(properties.isResidence, true));
      const [created] = await tx
        .insert(properties)
        .values({
          ...defined(request),
          name: request.name,
          colorSlot: nextColorSlot(taken.map((t) => t.slot)),
          matchTerms:
            request.matchTerms ??
            defaultMatchTerms(request.address ?? request.name),
        })
        .returning();
      return created;
    });
    // A new home shows up in the review inbox as a property at once.
    let saved = await this.links.ensure(row);
    if (points) saved = await setSupplyPoints(this.svc.db, saved, points);
    // Its bills (and supply points with no house yet) find it.
    await this.ledger.sync();
    return this.dto(saved);
  }

  async update(id: string, request: UpdateProperty): Promise<PropertyDto> {
    const { supplyPoints: points, ...fields } = request;
    const changes = defined(fields);
    const row = await this.svc.db.transaction(async (tx) => {
      if (changes.isResidence)
        await tx
          .update(properties)
          .set({ isResidence: false })
          .where(and(eq(properties.isResidence, true), ne(properties.id, id)));
      const [updated] = Object.keys(changes).length
        ? await tx
            .update(properties)
            .set(changes)
            .where(eq(properties.id, id))
            .returning()
        : await tx.select().from(properties).where(eq(properties.id, id));
      return updated;
    });
    if (!row) throw new NotFoundException(`Property ${id} not found`);
    const saved = points
      ? await setSupplyPoints(this.svc.db, row, points)
      : row;
    // New match terms or supply codes can bring bills to it.
    if (points || changes.matchTerms || changes.supplyCodes || changes.address)
      await this.ledger.sync();
    return this.dto(saved);
  }

  /** Deletes a property with its works; its supply points and bills go back to unassigned. */
  async remove(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(properties)
      .where(eq(properties.id, id))
      .returning({ id: properties.id });
    if (!deleted.length)
      throw new NotFoundException(`Property ${id} not found`);
    await this.ledger.sync();
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.svc.db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, id));
    return !!row;
  }
}

/**
 * Sets a house's supply point of each utility given: the point with that
 * code comes to this house with its bills (it is created when no bill named
 * it yet), and the code is the house's. Null takes the current point of
 * that utility off the house. Other houses lose a code that is now this one's.
 */
export async function setSupplyPoints(
  db: NodePgDatabase,
  house: PropertyRow,
  wanted: Partial<Record<UtilityKind, string | null>>,
): Promise<PropertyRow> {
  const current = (await loadHouseSupply(db, [house])).get(house.id);
  let typed = [...house.supplyCodes];
  for (const utility of UTILITY_KINDS) {
    if (!(utility in wanted)) continue;
    const raw = wanted[utility];
    const code = raw ? normalizeCode(raw) : null;
    const before = current?.points[utility] ?? null;
    if (code && before && normalizeCode(before) === code) continue;
    // The typed codes of this utility make way for the new one.
    typed = typed.filter(
      (c) =>
        (supplyCodeUtility(c) ?? 'WATER') !== utility &&
        normalizeCode(c) !== before,
    );
    if (before && !code)
      await db
        .update(supplyPoints)
        .set({ propertyId: null })
        .where(
          and(
            eq(supplyPoints.propertyId, house.id),
            eq(supplyPoints.code, normalizeCode(before)),
          ),
        );
    if (!code) continue;
    typed.push(code);
    const [point] = await db
      .select()
      .from(supplyPoints)
      .where(eq(supplyPoints.code, code));
    if (point)
      await db
        .update(supplyPoints)
        .set({ propertyId: house.id })
        .where(eq(supplyPoints.id, point.id));
    else
      await db
        .insert(supplyPoints)
        .values({ utility, code, propertyId: house.id });
    // The code is this house's now: another house that had it lets it go.
    const others = await db
      .select({ id: properties.id, supplyCodes: properties.supplyCodes })
      .from(properties)
      .where(ne(properties.id, house.id));
    for (const other of others) {
      const kept = other.supplyCodes.filter((c) => normalizeCode(c) !== code);
      if (kept.length !== other.supplyCodes.length)
        await db
          .update(properties)
          .set({ supplyCodes: kept })
          .where(eq(properties.id, other.id));
    }
  }
  const [updated] = await db
    .update(properties)
    .set({ supplyCodes: [...new Set(typed)] })
    .where(eq(properties.id, house.id))
    .returning();
  return updated;
}
