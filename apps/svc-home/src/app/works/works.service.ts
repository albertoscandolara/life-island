import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  createWorkRequestSchema,
  listWorksQuerySchema,
  updateWorkRequestSchema,
  type WorkDocumentDto,
  type WorkDto,
} from '@life-island/contracts';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  documents,
  properties,
  workDocuments,
  works,
  type DocumentRow,
  type WorkRow,
} from '../db/schema.js';
import { documentAmount, documentDate } from '../documents/document-view.js';

type CreateWork = z.output<typeof createWorkRequestSchema>;
type UpdateWork = z.output<typeof updateWorkRequestSchema>;
type ListWorks = z.output<typeof listWorksQuerySchema>;

function toDocumentDto(
  uploadId: string,
  row: DocumentRow | undefined,
): WorkDocumentDto {
  return {
    uploadId,
    title: row?.title ?? 'Document not found',
    date: documentDate(row?.fields),
    amount: documentAmount(row?.fields),
    deleted: !row || row.deletedAt !== null,
  };
}

@Injectable()
export class WorksService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(query: ListWorks): Promise<WorkDto[]> {
    const conditions: SQL[] = [];
    if (query.property) conditions.push(eq(works.propertyId, query.property));
    if (query.status) conditions.push(eq(works.status, query.status));
    const rows = await this.svc.db
      .select()
      .from(works)
      .where(conditions.length ? and(...conditions) : undefined)
      // Newest first; works with no dates yet (plans) on top.
      .orderBy(
        sql`coalesce(${works.startDate}, ${works.endDate}) desc nulls first`,
        desc(works.createdAt),
      );
    return this.withDocuments(rows);
  }

  async get(id: string): Promise<WorkDto> {
    const [row] = await this.svc.db
      .select()
      .from(works)
      .where(eq(works.id, id));
    if (!row) throw new NotFoundException(`Work ${id} not found`);
    const [dto] = await this.withDocuments([row]);
    return dto;
  }

  async create(request: CreateWork): Promise<WorkDto> {
    await this.assertProperty(request.propertyId);
    const [row] = await this.svc.db
      .insert(works)
      .values({
        propertyId: request.propertyId,
        title: request.title,
        kind: request.kind,
        status: request.status,
        area: request.area ?? null,
        contractor: request.contractor ?? null,
        startDate: request.startDate ?? null,
        endDate: request.endDate ?? null,
        estimatedCost: request.estimatedCost ?? null,
        actualCost: request.actualCost ?? null,
        notes: request.notes ?? null,
      })
      .returning();
    return { ...(await this.withDocuments([row]))[0] };
  }

  async update(id: string, request: UpdateWork): Promise<WorkDto> {
    if (request.propertyId) await this.assertProperty(request.propertyId);
    const current = await this.get(id);
    const startDate =
      request.startDate !== undefined ? request.startDate : current.startDate;
    const endDate =
      request.endDate !== undefined ? request.endDate : current.endDate;
    if (startDate && endDate && startDate > endDate)
      throw new BadRequestException({
        message: 'Invalid request',
        issues: [{ path: 'endDate', message: 'ends before it starts' }],
      });
    const changes = Object.fromEntries(
      Object.entries(request).filter(([, value]) => value !== undefined),
    );
    await this.svc.db
      .update(works)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(works.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(works)
      .where(eq(works.id, id))
      .returning({ id: works.id });
    if (!deleted.length) throw new NotFoundException(`Work ${id} not found`);
  }

  async attach(id: string, uploadId: string): Promise<WorkDto> {
    await this.get(id);
    const [document] = await this.svc.db
      .select({ uploadId: documents.uploadId })
      .from(documents)
      .where(eq(documents.uploadId, uploadId));
    if (!document)
      throw new BadRequestException(`Document ${uploadId} not found`);
    await this.svc.db
      .insert(workDocuments)
      .values({ workId: id, uploadId })
      .onConflictDoNothing();
    await this.touch(id);
    return this.get(id);
  }

  async detach(id: string, uploadId: string): Promise<WorkDto> {
    await this.svc.db
      .delete(workDocuments)
      .where(
        and(eq(workDocuments.workId, id), eq(workDocuments.uploadId, uploadId)),
      );
    await this.touch(id);
    return this.get(id);
  }

  private async touch(id: string): Promise<void> {
    await this.svc.db
      .update(works)
      .set({ updatedAt: new Date() })
      .where(eq(works.id, id));
  }

  private async assertProperty(id: string): Promise<void> {
    const [row] = await this.svc.db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, id));
    if (!row) throw new BadRequestException(`Property ${id} not found`);
  }

  private async withDocuments(rows: WorkRow[]): Promise<WorkDto[]> {
    if (!rows.length) return [];
    const links = await this.svc.db
      .select()
      .from(workDocuments)
      .where(
        inArray(
          workDocuments.workId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(workDocuments.createdAt));
    const docs = links.length
      ? await this.svc.db
          .select()
          .from(documents)
          .where(
            inArray(
              documents.uploadId,
              links.map((link) => link.uploadId),
            ),
          )
      : [];
    const docOf = new Map(docs.map((doc) => [doc.uploadId, doc]));
    return rows.map((row) => ({
      id: row.id,
      propertyId: row.propertyId,
      title: row.title,
      kind: row.kind as WorkDto['kind'],
      status: row.status as WorkDto['status'],
      area: row.area,
      contractor: row.contractor,
      startDate: row.startDate,
      endDate: row.endDate,
      estimatedCost: row.estimatedCost,
      actualCost: row.actualCost,
      notes: row.notes,
      documents: links
        .filter((link) => link.workId === row.id)
        .map((link) => toDocumentDto(link.uploadId, docOf.get(link.uploadId))),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
