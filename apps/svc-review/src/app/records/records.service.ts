import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import {
  CONFIRMABLE_STATUSES,
  listRecordsQuerySchema,
  RECORD_APPROVED_EVENT,
  type Page,
  type RecordApprovedV1,
  type RecordDetailDto,
  type RecordDto,
} from '@life-island/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import { stagingRecords, type StagingRecordRow } from '../db/schema.js';
import { toRecordDetailDto, toRecordDto } from './record-dto.js';

type ListRecords = z.output<typeof listRecordsQuerySchema>;

function nextDay(date: string): Date {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

const SORT_COLUMNS = {
  uploadedAt: stagingRecords.uploadedAt,
  parsedAt: stagingRecords.parsedAt,
  title: stagingRecords.title,
};

@Injectable()
export class RecordsService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(query: ListRecords): Promise<Page<RecordDto>> {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          ilike(stagingRecords.title, pattern),
          ilike(stagingRecords.description, pattern),
        )!,
      );
    }
    if (query.status) conditions.push(eq(stagingRecords.status, query.status));
    if (query.category)
      conditions.push(eq(stagingRecords.category, query.category));
    if (query.fileFormat)
      conditions.push(eq(stagingRecords.fileFormat, query.fileFormat));
    if (query.uploadedFrom) {
      conditions.push(
        gte(
          stagingRecords.uploadedAt,
          new Date(`${query.uploadedFrom}T00:00:00Z`),
        ),
      );
    }
    if (query.uploadedTo)
      conditions.push(lt(stagingRecords.uploadedAt, nextDay(query.uploadedTo)));
    const where = conditions.length ? and(...conditions) : undefined;

    const column = SORT_COLUMNS[query.sort];
    const direction = query.order === 'asc' ? asc(column) : desc(column);
    // Unparsed records have no parse date; keep them last whatever the order.
    const nullsLast =
      query.sort === 'parsedAt' ? sql`${column} is null` : undefined;
    const orderBy = [
      ...(nullsLast ? [nullsLast] : []),
      direction,
      desc(stagingRecords.id),
    ];

    const [rows, [{ total }]] = await Promise.all([
      this.svc.db
        .select()
        .from(stagingRecords)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.svc.db.select({ total: count() }).from(stagingRecords).where(where),
    ]);
    return {
      items: rows.map(toRecordDto),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<RecordDetailDto> {
    return toRecordDetailDto(await this.findRow(id));
  }

  /**
   * Confirming is an intent, not a write into a domain: one transaction marks
   * the record CONFIRMED and adds `record.approved` to the outbox. The domain
   * service that owns the target (groceries, tax730...) loads it into its own
   * table and answers with `record.loaded` or `record.load_failed`.
   */
  async confirm(id: string): Promise<RecordDetailDto> {
    return withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      const [row] = await db
        .update(stagingRecords)
        .set({
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          loadError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stagingRecords.id, id),
            inArray(stagingRecords.status, [...CONFIRMABLE_STATUSES]),
          ),
        )
        .returning();
      if (!row) {
        const current = await this.findRow(id);
        throw new ConflictException(
          `Only parsed records can be confirmed; this one is ${current.status}`,
        );
      }
      const event: RecordApprovedV1 = {
        recordId: row.id,
        uploadId: row.uploadId,
        category: row.category!,
        targetKey: row.targetKey!,
        payload: row.reviewedPayload ?? row.aiPayload,
        approvedAt: row.confirmedAt!.toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: RECORD_APPROVED_EVENT,
        payload: event,
      });
      return toRecordDetailDto(row);
    });
  }

  private async findRow(id: string): Promise<StagingRecordRow> {
    const [row] = await this.svc.db
      .select()
      .from(stagingRecords)
      .where(eq(stagingRecords.id, id));
    if (!row) throw new NotFoundException(`Record ${id} not found`);
    return row;
  }
}
