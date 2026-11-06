import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveHouseSuggestionRequestSchema,
  dismissHouseSuggestionRequestSchema,
  PROPERTY_COMPANY_FIELDS,
  type CompanySource,
  type HomePeopleDto,
  type HouseSuggestionDto,
  type KnownCompanyDto,
  type PropertyDto,
} from '@life-island/contracts';
import { isNotNull } from 'drizzle-orm';
import { BillsService } from '../bills/bills.service.js';
import { normalizeText } from '../bills/bill-reader.js';
import { SERVICE_DB } from '../config.js';
import { properties, works } from '../db/schema.js';
import { HomePeople } from '../properties/home-people.js';
import { HouseSuggestionsService } from './house-suggestions.service.js';

/**
 * Companies seen on your bills, houses and works, one per name (case and
 * accents ignored), most used first: what the company pickers offer.
 */
export function knownCompanies(
  seen: { name: string | null; source: CompanySource }[],
): KnownCompanyDto[] {
  const byName = new Map<string, KnownCompanyDto>();
  for (const { name, source } of seen) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    const known = byName.get(key) ?? { name: trimmed, sources: [], uses: 0 };
    known.uses++;
    if (!known.sources.includes(source)) known.sources.push(source);
    byName.set(key, known);
  }
  return [...byName.values()].sort(
    (a, b) => b.uses - a.uses || a.name.localeCompare(b.name),
  );
}

/** Houses as entities: suggestions read from documents, and what their pickers offer. */
@Controller()
export class HousesController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(HouseSuggestionsService)
    private readonly suggestions: HouseSuggestionsService,
    @Inject(HomePeople) private readonly people: HomePeople,
    @Inject(BillsService) private readonly bills: BillsService,
  ) {}

  /** Houses and house data your documents speak of, waiting for you. */
  @Get('houses/suggestions')
  list(): Promise<HouseSuggestionDto[]> {
    return this.suggestions.list();
  }

  @Post('houses/suggestions/approve')
  approve(@Body() body: unknown): Promise<PropertyDto> {
    return this.suggestions.approve(
      parseOrThrow(approveHouseSuggestionRequestSchema, body),
    );
  }

  @Post('houses/suggestions/dismiss')
  @HttpCode(204)
  dismiss(@Body() body: unknown): Promise<void> {
    return this.suggestions.dismiss(
      parseOrThrow(dismissHouseSuggestionRequestSchema, body).uploadIds,
    );
  }

  /** Suggests again every document you dismissed. */
  @Post('houses/suggestions/reopen')
  async reopen(): Promise<{ reopened: number }> {
    return { reopened: await this.suggestions.reopenDismissed() };
  }

  /** The people of the People area, to pick as owners. */
  @Get('people')
  owners(): Promise<HomePeopleDto> {
    return this.people.list();
  }

  /** Companies already known, to pick as a supplier, manager, insurer or contractor. */
  @Get('companies')
  async companies(): Promise<KnownCompanyDto[]> {
    const [bills, houses, contractors] = await Promise.all([
      this.bills.list({ utility: undefined }),
      this.svc.db.select().from(properties),
      this.svc.db
        .select({ name: works.contractor })
        .from(works)
        .where(isNotNull(works.contractor)),
    ]);
    return knownCompanies([
      ...bills.map((b) => ({ name: b.provider, source: 'BILL' as const })),
      ...houses.flatMap((h) =>
        PROPERTY_COMPANY_FIELDS.map((field) => ({
          name: h[field],
          source: 'HOUSE' as const,
        })),
      ),
      ...contractors.map((w) => ({ name: w.name, source: 'WORK' as const })),
    ]);
  }
}
