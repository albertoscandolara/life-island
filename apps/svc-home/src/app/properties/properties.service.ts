import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  createPropertyRequestSchema,
  updatePropertyRequestSchema,
  type PropertyDto,
} from '@life-island/contracts';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import { properties, type PropertyRow } from '../db/schema.js';
import { normalizeText } from '../bills/bill-reader.js';
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
  ) {}

  async list(): Promise<PropertyDto[]> {
    const rows = await this.svc.db
      .select()
      .from(properties)
      .orderBy(asc(properties.colorSlot), asc(properties.createdAt));
    return rows.map(toPropertyDto);
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
    return toPropertyDto(await this.links.ensure(row));
  }

  async update(id: string, request: UpdateProperty): Promise<PropertyDto> {
    const changes = defined(request);
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
    return toPropertyDto(row);
  }

  /** Deletes a property with its works; its bills go back to unassigned. */
  async remove(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(properties)
      .where(eq(properties.id, id))
      .returning({ id: properties.id });
    if (!deleted.length)
      throw new NotFoundException(`Property ${id} not found`);
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.svc.db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, id));
    return !!row;
  }
}
