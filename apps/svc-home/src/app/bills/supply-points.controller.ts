import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  updateOrganizationRequestSchema,
  updateSupplyPointRequestSchema,
  type OrganizationDto,
  type SupplyPointDto,
} from '@life-island/contracts';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SERVICE_DB } from '../config.js';
import {
  bills,
  organizations,
  properties,
  supplyContracts,
  supplyPoints,
} from '../db/schema.js';
import { normalizeTaxCode, organizationKey } from './bill-reader.js';
import { BillsService } from './bills.service.js';

/** Every organization, with how many bills it issued. */
export async function listOrganizations(
  db: NodePgDatabase,
): Promise<OrganizationDto[]> {
  const [orgs, counts] = await Promise.all([
    db.select().from(organizations),
    db
      .select({
        id: bills.supplierId,
        count: sql<number>`count(*)::int`,
      })
      .from(bills)
      .where(sql`${bills.duplicateOf} is null`)
      .groupBy(bills.supplierId),
  ]);
  const countOf = new Map(counts.map((c) => [c.id, c.count]));
  return orgs
    .map((o) => ({
      id: o.id,
      name: o.name,
      taxCode: o.taxCode,
      vatNumber: o.vatNumber,
      roles: o.roles,
      billCount: countOf.get(o.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What bills hang on: the supply points of your houses with their contracts,
 * and the organizations (suppliers, distributors) behind them.
 */
@Controller()
export class SupplyPointsController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(BillsService) private readonly bills: BillsService,
  ) {}

  @Get('supply-points')
  async list(): Promise<SupplyPointDto[]> {
    const [points, contracts, orgs, counts] = await Promise.all([
      this.svc.db.select().from(supplyPoints),
      this.svc.db.select().from(supplyContracts),
      this.svc.db.select().from(organizations),
      this.svc.db
        .select({
          contractId: bills.contractId,
          pointId: bills.supplyPointId,
          count: sql<number>`count(*)::int`,
          first: sql<
            string | null
          >`min(coalesce(${bills.periodStart}, ${bills.issueDate}))::text`,
          last: sql<
            string | null
          >`max(coalesce(${bills.periodEnd}, ${bills.issueDate}))::text`,
        })
        .from(bills)
        .where(sql`${bills.duplicateOf} is null`)
        .groupBy(bills.contractId, bills.supplyPointId),
    ]);
    const nameOf = new Map(orgs.map((o) => [o.id, o.name]));
    return points
      .map((p) => {
        const own = counts.filter((c) => c.pointId === p.id);
        return {
          id: p.id,
          utility: p.utility,
          code: p.code,
          propertyId: p.propertyId,
          distributorId: p.distributorId,
          distributorName: p.distributorId
            ? (nameOf.get(p.distributorId) ?? null)
            : null,
          billCount: own.reduce((sum, c) => sum + c.count, 0),
          contracts: contracts
            .filter((c) => c.supplyPointId === p.id)
            .map((c) => {
              const used = own.filter((u) => u.contractId === c.id);
              const days = (pick: 'first' | 'last') =>
                used
                  .map((u) => u[pick])
                  .filter((d): d is string => d !== null)
                  .sort();
              return {
                id: c.id,
                supplierId: c.supplierId,
                supplierName: c.supplierId
                  ? (nameOf.get(c.supplierId) ?? null)
                  : null,
                customerCode: c.customerCode,
                offerName: c.offerName,
                firstDay: days('first')[0] ?? null,
                lastDay: days('last').at(-1) ?? null,
                billCount: used.reduce((sum, u) => sum + u.count, 0),
              };
            })
            .sort((a, b) => (b.lastDay ?? '').localeCompare(a.lastDay ?? ''))
            // The contract billed last runs the supply point; the others ended.
            .map((c, i) => ({
              ...c,
              status: i === 0 ? ('ACTIVE' as const) : ('ENDED' as const),
            })),
        };
      })
      .sort(
        (a, b) =>
          a.utility.localeCompare(b.utility) || a.code.localeCompare(b.code),
      );
  }

  /** Moves a supply point to another house: its bills, past and future, follow. */
  @Patch('supply-points/:id')
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const { propertyId } = parseOrThrow(updateSupplyPointRequestSchema, body);
    if (propertyId) {
      const [house] = await this.svc.db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!house)
        throw new BadRequestException(`Property ${propertyId} not found`);
    }
    await this.bills.moveSupplyPoint(id, propertyId);
    return { ok: true };
  }

  @Get('organizations')
  organizations(): Promise<OrganizationDto[]> {
    return listOrganizations(this.svc.db);
  }

  /** Your fixes to a company: a clearer name, its tax code or VAT number. */
  @Patch('organizations/:id')
  async updateOrganization(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OrganizationDto> {
    const request = parseOrThrow(updateOrganizationRequestSchema, body);
    const set = {
      ...(request.name !== undefined
        ? { name: request.name, nameKey: organizationKey(request.name) }
        : {}),
      ...(request.taxCode !== undefined
        ? {
            taxCode: request.taxCode ? normalizeTaxCode(request.taxCode) : null,
          }
        : {}),
      ...(request.vatNumber !== undefined
        ? {
            vatNumber: request.vatNumber
              ? normalizeTaxCode(request.vatNumber)
              : null,
          }
        : {}),
    };
    if (Object.keys(set).length)
      try {
        await this.svc.db
          .update(organizations)
          .set(set)
          .where(eq(organizations.id, id));
      } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
          throw new ConflictException('Another company has this tax code');
        throw error;
      }
    const found = (await listOrganizations(this.svc.db)).find(
      (o) => o.id === id,
    );
    if (!found) throw new NotFoundException(`Organization ${id} not found`);
    return found;
  }
}
