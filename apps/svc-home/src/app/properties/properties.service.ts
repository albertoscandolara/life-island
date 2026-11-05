import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  createPropertyRequestSchema,
  updatePropertyRequestSchema,
  type PropertyDto,
} from '@life-island/contracts';
import { asc, eq } from 'drizzle-orm';
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
    address: row.address,
    city: row.city,
    colorSlot: row.colorSlot,
    matchTerms: row.matchTerms,
    supplyCodes: row.supplyCodes,
    categoryIds: row.categoryIds,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** "Via Ponzilovo" → ["ponzilovo"]: the name without the street word, for matching addresses. */
export function defaultMatchTerms(name: string): string[] {
  const term = normalizeText(name)
    .replace(/^(via|viale|piazza|corso|vicolo|strada|localita|loc)\s+/, '')
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

  async create(request: CreateProperty): Promise<PropertyDto> {
    const taken = await this.svc.db
      .select({ slot: properties.colorSlot })
      .from(properties);
    const [row] = await this.svc.db
      .insert(properties)
      .values({
        name: request.name,
        address: request.address ?? null,
        city: request.city ?? null,
        colorSlot: nextColorSlot(taken.map((t) => t.slot)),
        matchTerms: request.matchTerms ?? defaultMatchTerms(request.name),
        supplyCodes: request.supplyCodes ?? [],
        categoryIds: request.categoryIds ?? [],
        notes: request.notes ?? null,
      })
      .returning();
    // A new home shows up in the review inbox as a property at once.
    return toPropertyDto(await this.links.ensure(row));
  }

  async update(id: string, request: UpdateProperty): Promise<PropertyDto> {
    const changes = Object.fromEntries(
      Object.entries(request).filter(([, value]) => value !== undefined),
    );
    const [row] = Object.keys(changes).length
      ? await this.svc.db
          .update(properties)
          .set(changes)
          .where(eq(properties.id, id))
          .returning()
      : await this.svc.db
          .select()
          .from(properties)
          .where(eq(properties.id, id));
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
