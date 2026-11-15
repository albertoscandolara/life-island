import { Controller, Get, Inject } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { cleanAliases, type EntityRefDto } from '@life-island/contracts';
import { SERVICE_DB } from '../config.js';
import { properties, type PropertyRow } from '../db/schema.js';
import { HouseSuggestionsService } from '../houses/house-suggestions.service.js';
import { listOrganizations } from './organizations.js';

/** "Via dei Bandi, 10" → "Via dei Bandi": documents often print the street alone. */
export function streetOf(address: string | null): string | null {
  const street = address?.replace(/[\s,]+\d+[a-z]?(\/\w+)?\s*$/i, '').trim();
  return street && street !== address?.trim() ? street : null;
}

/** A house as every area links it: found by address, street, city or category. */
export function houseEntity(row: PropertyRow): EntityRefDto {
  const where = [row.address, row.city].filter(Boolean).join(', ');
  return {
    kind: 'house',
    id: row.id,
    name: row.name,
    status: 'confirmed',
    detail: where || null,
    aliases: cleanAliases(row.name, [
      row.address,
      streetOf(row.address),
      row.address && row.city ? `${row.address}, ${row.city}` : null,
      row.city,
      ...row.matchTerms,
      ...row.categoryIds,
    ]),
  };
}

/**
 * The entities of Home (`GET /entities`): your houses and companies, and the
 * ones documents suggested that wait for you.
 */
@Controller()
export class HomeEntitiesController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(HouseSuggestionsService)
    private readonly suggestions: HouseSuggestionsService,
  ) {}

  @Get('entities')
  async entities(): Promise<EntityRefDto[]> {
    const [houses, orgs, suggestions] = await Promise.all([
      this.svc.db.select().from(properties),
      listOrganizations(this.svc.db),
      this.suggestions.list().catch(() => []),
    ]);
    return [
      ...houses.map(houseEntity),
      ...suggestions
        .filter((s) => s.kind === 'new_house' && s.name)
        .map((s): EntityRefDto => ({
          kind: 'house',
          id: s.key,
          name: s.name ?? '',
          status: 'pending',
          detail: 'New house read from your documents',
          aliases: cleanAliases(
            s.name ?? '',
            s.changes
              .filter((c) => c.field === 'address')
              .flatMap((c) => [c.proposed, streetOf(c.proposed)]),
          ),
        })),
      ...orgs
        .filter((o) => o.status !== 'DISMISSED')
        .map((o): EntityRefDto => ({
          kind: 'organization',
          id: o.id,
          name: o.name,
          status: o.status === 'CONFIRMED' ? 'confirmed' : 'pending',
          detail: o.vatNumber ?? o.taxCode,
          aliases: cleanAliases(o.name, [...o.aliases, o.taxCode, o.vatNumber]),
        })),
    ];
  }
}
