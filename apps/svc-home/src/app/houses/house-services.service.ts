import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import type {
  HouseServicesDto,
  UpdateHouseServiceDocumentRequest,
} from '@life-island/contracts';
import { eq, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  documents,
  houseDocumentOverrides,
} from '../db/schema.js';
import { PropertiesService } from '../properties/properties.service.js';
import {
  houseServices,
  readService,
  type ServiceReading,
} from './house-services.js';

/**
 * The internet lines and insurances of your houses, read from the documents
 * you uploaded (internet contracts and bills, home insurance policies).
 * Nothing is typed: only your corrections of the house are kept.
 */
@Injectable()
export class HouseServicesService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(PropertiesService) private readonly properties: PropertiesService,
  ) {}

  async list(
    today = new Date().toISOString().slice(0, 10),
  ): Promise<HouseServicesDto> {
    return houseServices(await this.readings(), today);
  }

  /** Puts a document on a house (or none), back to automatic, or out of the houses. */
  async update(
    uploadId: string,
    request: UpdateHouseServiceDocumentRequest,
  ): Promise<HouseServicesDto> {
    const [document] = await this.svc.db
      .select({ uploadId: documents.uploadId })
      .from(documents)
      .where(eq(documents.uploadId, uploadId));
    if (!document)
      throw new NotFoundException(`Document ${uploadId} not found`);
    if (
      request.propertyId &&
      !(await this.properties.exists(request.propertyId))
    )
      throw new NotFoundException(`Property ${request.propertyId} not found`);
    const changes = {
      ...(request.automaticProperty
        ? { manualProperty: false, propertyId: null }
        : request.propertyId !== undefined
          ? { manualProperty: true, propertyId: request.propertyId }
          : {}),
      ...(request.excluded !== undefined ? { excluded: request.excluded } : {}),
      updatedAt: new Date(),
    };
    await this.svc.db
      .insert(houseDocumentOverrides)
      .values({ uploadId, ...changes })
      .onConflictDoUpdate({
        target: houseDocumentOverrides.uploadId,
        set: changes,
      });
    return this.list();
  }

  private async readings(): Promise<ServiceReading[]> {
    const [rows, tree, props, overrides] = await Promise.all([
      this.svc.db.select().from(documents).where(isNull(documents.deletedAt)),
      this.svc.db.select().from(categoryTree),
      this.properties.list(),
      this.svc.db.select().from(houseDocumentOverrides),
    ]);
    const categories = new Map(
      tree
        .filter((c) => !c.deleted)
        .map((c) => [c.id, { title: c.title, parentId: c.parentId }]),
    );
    const overrideOf = new Map(
      overrides.map((o) => [
        o.uploadId,
        { ...o, utility: null as string | null },
      ]),
    );
    return rows
      .map((row) =>
        readService(
          row,
          categories,
          props,
          overrideOf.get(row.uploadId) ?? null,
        ),
      )
      .filter((r): r is ServiceReading => r !== null);
  }
}
