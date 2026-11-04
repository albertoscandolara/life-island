import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  listBillsQuerySchema,
  updateBillRequestSchema,
  UTILITIES,
  UTILITY_KINDS,
  type BillDto,
} from '@life-island/contracts';
import { and, arrayOverlaps, eq, inArray, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  billOverrides,
  categoryTree,
  documents,
  properties,
  type DocumentRow,
} from '../db/schema.js';
import {
  billSpan,
  readBill,
  withAncestors,
  type ParentOf,
} from './bill-reader.js';

type ListBills = z.output<typeof listBillsQuerySchema>;
type UpdateBill = z.output<typeof updateBillRequestSchema>;

const BILL_ROOTS = [
  'BILL',
  ...UTILITY_KINDS.map((k) => UTILITIES[k].categoryId),
];

/**
 * Bills are not stored: they are read, on every request, from the documents
 * you confirmed with a bill category, plus your corrections. A fix to a
 * document in the documents app shows up here at once.
 */
@Injectable()
export class BillsService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(query: ListBills): Promise<BillDto[]> {
    const { parentOf, billCategories } = await this.categories();
    const [props, overrides] = await Promise.all([
      this.svc.db.select().from(properties),
      this.svc.db.select().from(billOverrides),
    ]);
    const overrideOf = new Map(overrides.map((o) => [o.uploadId, o]));
    const withUtility = overrides
      .filter((o) => o.utility !== null)
      .map((o) => o.uploadId);
    const rows = await this.svc.db
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          or(
            arrayOverlaps(documents.categories, billCategories),
            withUtility.length
              ? inArray(documents.uploadId, withUtility)
              : undefined,
          ),
        ),
      );

    return rows
      .map((row) =>
        readBill(row, props, parentOf, overrideOf.get(row.uploadId) ?? null),
      )
      .filter((bill): bill is BillDto => bill !== null)
      .filter((bill) => matches(bill, query))
      .sort(
        (a, b) =>
          (billSpan(b)?.end ?? '').localeCompare(billSpan(a)?.end ?? '') ||
          a.uploadId.localeCompare(b.uploadId),
      );
  }

  async update(uploadId: string, request: UpdateBill): Promise<BillDto | null> {
    const [document] = await this.svc.db
      .select()
      .from(documents)
      .where(
        and(eq(documents.uploadId, uploadId), isNull(documents.deletedAt)),
      );
    if (!document)
      throw new NotFoundException(`Document ${uploadId} not found`);
    if (request.propertyId) {
      const [property] = await this.svc.db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, request.propertyId));
      if (!property)
        throw new BadRequestException(
          `Property ${request.propertyId} not found`,
        );
    }

    const changes = {
      ...(request.automaticProperty
        ? { manualProperty: false, propertyId: null }
        : request.propertyId !== undefined
          ? { manualProperty: true, propertyId: request.propertyId }
          : {}),
      ...(request.utility !== undefined ? { utility: request.utility } : {}),
      ...(request.excluded !== undefined ? { excluded: request.excluded } : {}),
      updatedAt: new Date(),
    };
    await this.svc.db
      .insert(billOverrides)
      .values({ uploadId, ...changes })
      .onConflictDoUpdate({ target: billOverrides.uploadId, set: changes });
    return this.read(document);
  }

  private async read(document: DocumentRow): Promise<BillDto | null> {
    const { parentOf } = await this.categories();
    const [props, [override]] = await Promise.all([
      this.svc.db.select().from(properties),
      this.svc.db
        .select()
        .from(billOverrides)
        .where(eq(billOverrides.uploadId, document.uploadId)),
    ]);
    return readBill(document, props, parentOf, override ?? null);
  }

  /** The hierarchy, and every category that is a bill or sits under one. */
  private async categories(): Promise<{
    parentOf: ParentOf;
    billCategories: string[];
  }> {
    // Deleted categories stay as tombstones and still link old documents up.
    const rows = await this.svc.db
      .select({ id: categoryTree.id, parentId: categoryTree.parentId })
      .from(categoryTree);
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
    const billCategories = new Set(BILL_ROOTS);
    for (const row of rows)
      if (withAncestors(row.id, parentOf).some((id) => BILL_ROOTS.includes(id)))
        billCategories.add(row.id);
    return { parentOf, billCategories: [...billCategories] };
  }
}

function matches(bill: BillDto, query: ListBills): boolean {
  if (query.property === 'unassigned' && bill.propertyId !== null) return false;
  if (
    query.property &&
    query.property !== 'unassigned' &&
    bill.propertyId !== query.property
  )
    return false;
  if (query.utility && !query.utility.includes(bill.utility)) return false;
  if (query.from || query.to) {
    const span = billSpan(bill);
    if (!span) return false;
    if (query.from && span.end < query.from) return false;
    if (query.to && span.start > query.to) return false;
  }
  return true;
}
