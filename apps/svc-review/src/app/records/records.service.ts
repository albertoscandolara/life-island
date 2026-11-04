import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import {
  categoryCountsQuerySchema,
  CONFIRMABLE_STATUSES,
  findTarget,
  REJECTABLE_STATUSES,
  type RejectRecordRequest,
  type TargetDefinition,
  listRecordsQuerySchema,
  RECORD_APPROVED_EVENT,
  type CategoryCountDto,
  type Page,
  type RecordApprovedV1,
  type RecordDetailDto,
  type RecordDto,
  type updateRecordRequestSchema,
} from '@life-island/contracts';
import {
  and,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  stagingRecords,
  type StagingRecordRow,
} from '../db/schema.js';
import { toRecordDetailDto, toRecordDto } from './record-dto.js';

type ListRecords = z.output<typeof listRecordsQuerySchema>;
type CategoryCounts = z.output<typeof categoryCountsQuerySchema>;
type UpdateRecord = z.output<typeof updateRecordRequestSchema>;

function nextDay(date: string): Date {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

/** A text[] literal from bound parameters (a plain array would expand to a list). */
function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
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
    const conditions = this.filters(query);
    if (query.documentCategory) {
      const ids = textArray(query.documentCategory);
      // A category includes its descendants, at any depth, in the same query:
      // BILL matches records that have BILL, WATER_BILL or anything below.
      conditions.push(
        query.includeSubcategories
          ? sql`${stagingRecords.categories} && array(
              with recursive subtree (id) as (
                select unnest(${ids})
                union
                select c.id from ${categoryTree} c
                  join subtree s on c.parent_id = s.id
                 where not c.deleted
              )
              select id from subtree)`
          : arrayOverlaps(stagingRecords.categories, query.documentCategory),
      );
    }
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

  /**
   * For each category, how many records the other filters leave: with the
   * category itself, and with it or any descendant (what selecting it shows).
   */
  async categoryCounts(query: CategoryCounts): Promise<CategoryCountDto[]> {
    const where = and(...this.filters(query))!;
    const { rows } = await this.svc.db.execute<{
      id: string;
      direct: number;
      total: number;
    }>(sql`
      with recursive filtered as (
        select ${stagingRecords.categories} as categories
          from ${stagingRecords} where ${where}
      ),
      ids (id) as (
        select id from ${categoryTree} where not deleted
        union
        select unnest(categories) from filtered
      ),
      tree (root, id) as (
        select id, id from ids
        union
        select t.root, c.id from ${categoryTree} c
          join tree t on c.parent_id = t.id
         where not c.deleted
      )
      select i.id,
             (select count(*) from filtered f where i.id = any(f.categories))::int as direct,
             (select count(*) from filtered f
               where f.categories && array(select t.id from tree t where t.root = i.id))::int as total
        from ids i
       order by i.id`);
    return rows.map((row) => ({
      id: row.id,
      direct: Number(row.direct),
      total: Number(row.total),
    }));
  }

  /** The conditions of every filter but the category one. */
  private filters(query: CategoryCounts): SQL[] {
    // Deleted documents stay only as tombstones.
    const conditions: SQL[] = [isNull(stagingRecords.deletedAt)];
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
    if (query.historical)
      conditions.push(eq(stagingRecords.historicalStatus, query.historical));
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
    return conditions;
  }

  async get(id: string): Promise<RecordDetailDto> {
    return toRecordDetailDto(await this.findRow(id));
  }

  /**
   * Saves your corrections before you confirm: the details, and optionally a
   * different target (which also changes the module the record goes to). The
   * parser's version stays in `ai_payload` and `ai_target_key`; yours goes to
   * `reviewed_payload` and `target_key`, and is what Confirm sends.
   */
  async update(id: string, request: UpdateRecord): Promise<RecordDetailDto> {
    const current = await this.findRow(id);
    if (!CONFIRMABLE_STATUSES.includes(current.status))
      throw new ConflictException(
        current.status === 'CONFIRMED' || current.status === 'LOADED'
          ? 'This record is already confirmed; its details belong to its module now'
          : `Only parsed records can be edited; this one is ${current.status}`,
      );
    const targetKey = request.targetKey ?? current.targetKey;
    const target = targetKey ? findTarget(targetKey) : undefined;
    if (!target)
      throw request.targetKey
        ? new UnprocessableEntityException(
            `Unknown target ${request.targetKey}`,
          )
        : new ConflictException(
            'This record has no parsed details to edit yet',
          );
    const details =
      request.details !== undefined
        ? request.details
        : (current.reviewedPayload ?? current.aiPayload);
    const parsed = this.validate(target, details);
    const [row] = await this.svc.db
      .update(stagingRecords)
      .set({
        reviewedPayload: parsed,
        targetKey: target.targetKey,
        category: target.category,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecords.id, id),
          isNull(stagingRecords.deletedAt),
          inArray(stagingRecords.status, [...CONFIRMABLE_STATUSES]),
        ),
      )
      .returning();
    if (!row)
      throw new ConflictException(
        'The record changed while you were editing it; reload and try again',
      );
    return toRecordDetailDto(row);
  }

  /** Rejects a record: it is never sent to a module, and stays out of the review queue. */
  async reject(
    id: string,
    request: RejectRecordRequest,
  ): Promise<RecordDetailDto> {
    const [row] = await this.svc.db
      .update(stagingRecords)
      .set({
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectReason: request.reason || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecords.id, id),
          isNull(stagingRecords.deletedAt),
          inArray(stagingRecords.status, [...REJECTABLE_STATUSES]),
        ),
      )
      .returning();
    if (!row) {
      const current = await this.findRow(id);
      throw new ConflictException(
        current.status === 'CONFIRMED' || current.status === 'LOADED'
          ? 'This record is already confirmed; its module owns the data now'
          : `This record cannot be rejected while it is ${current.status}`,
      );
    }
    return toRecordDetailDto(row);
  }

  /** Undoes a rejection: back to review if it was parsed, else back to waiting for the parser. */
  async reopen(id: string): Promise<RecordDetailDto> {
    const [row] = await this.svc.db
      .update(stagingRecords)
      .set({
        status: sql`case when ${stagingRecords.parsedAt} is null then 'UPLOADED'::review.record_status else 'PARSED'::review.record_status end`,
        rejectedAt: null,
        rejectReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecords.id, id),
          isNull(stagingRecords.deletedAt),
          eq(stagingRecords.status, 'REJECTED'),
        ),
      )
      .returning();
    if (!row) {
      const current = await this.findRow(id);
      throw new ConflictException(
        `Only rejected records can be reopened; this one is ${current.status}`,
      );
    }
    return toRecordDetailDto(row);
  }

  private validate(target: TargetDefinition, details: unknown): unknown {
    const parsed = target.schema.safeParse(details);
    if (!parsed.success)
      throw new UnprocessableEntityException(
        `The details do not fit ${target.label}: ` +
          parsed.error.issues
            .map(
              (issue) =>
                `${issue.path.join('.') || 'details'}: ${issue.message}`,
            )
            .join('; '),
      );
    return parsed.data;
  }

  /**
   * Confirming is an intent, not a write into a domain: one transaction marks
   * the record CONFIRMED and adds `record.approved` to the outbox. The domain
   * service that owns the target (groceries, tax730...) loads it into its own
   * table and answers with `record.loaded` or `record.load_failed`.
   */
  async confirm(id: string): Promise<RecordDetailDto> {
    // What is sent must fit the target: a module should never get a payload
    // it cannot load (for example after a parse that produced partial data).
    const current = await this.findRow(id);
    const target = current.targetKey
      ? findTarget(current.targetKey)
      : undefined;
    if (target && CONFIRMABLE_STATUSES.includes(current.status))
      this.validate(target, current.reviewedPayload ?? current.aiPayload);
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
            isNull(stagingRecords.deletedAt),
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
        ...(row.documentFields ? { documentFields: row.documentFields } : {}),
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
      .where(and(eq(stagingRecords.id, id), isNull(stagingRecords.deletedAt)));
    if (!row) throw new NotFoundException(`Record ${id} not found`);
    return row;
  }
}
