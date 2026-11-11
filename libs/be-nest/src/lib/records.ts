import { NotFoundException } from '@nestjs/common';
import { eq, getTableColumns, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { parseOrThrow } from './validation.js';

/*
 * The plain records of a module (an account, a visit, a trip): kept in the
 * service's own table, added, changed and removed through one set of routes
 * (`POST /:collection`, `PUT /:collection/:id`, `DELETE /:collection/:id`),
 * each body checked against its contract schema. What a module computes from
 * them (totals, reminders, deadlines) stays in the module's own service.
 */

/** A table with a uuid `id` primary key. */
export type RecordTable = PgTable & { id: PgColumn };

export interface RecordCollection {
  /** The URL segment, e.g. `accounts`. */
  name: string;
  /** What one record is called in messages: "Account". */
  label: string;
  table: RecordTable;
  /** The request body's contract schema. */
  request: z.ZodType;
  /** Turns a parsed request into column values; the request itself by default. */
  toValues?: (request: never) => Record<string, unknown>;
  /** Checks that need the database (a parent that must exist). */
  check?: (request: never) => Promise<void>;
}

export class RecordCollections {
  private readonly byName: Map<string, RecordCollection>;

  constructor(
    private readonly db: NodePgDatabase,
    collections: readonly RecordCollection[],
  ) {
    this.byName = new Map(collections.map((c) => [c.name, c]));
  }

  private collection(name: string): RecordCollection {
    const found = this.byName.get(name);
    if (!found) throw new NotFoundException(`There is no ${name} here`);
    return found;
  }

  private async values(
    collection: RecordCollection,
    body: unknown,
    partial = false,
  ): Promise<Record<string, unknown>> {
    // A change may send only the fields it changes (a checkbox, a status).
    const schema =
      partial && collection.request instanceof z.ZodObject
        ? collection.request.partial()
        : collection.request;
    const request = parseOrThrow(schema, body) as never;
    await collection.check?.(request);
    return collection.toValues
      ? collection.toValues(request)
      : (request as Record<string, unknown>);
  }

  async create(name: string, body: unknown): Promise<{ id: string }> {
    const collection = this.collection(name);
    const values = await this.values(collection, body);
    const [row] = await this.db
      .insert(collection.table)
      .values(values as never)
      .returning({ id: collection.table.id });
    return { id: String(row?.id) };
  }

  async update(name: string, id: string, body: unknown): Promise<void> {
    const collection = this.collection(name);
    const values = await this.values(collection, body, true);
    if ('updatedAt' in getTableColumns(collection.table))
      values['updatedAt'] = new Date();
    const rows = await this.db
      .update(collection.table)
      .set(values as never)
      .where(eq(collection.table.id, id))
      .returning({ id: collection.table.id });
    if (!rows.length)
      throw new NotFoundException(`${collection.label} not found`);
  }

  async remove(name: string, id: string): Promise<void> {
    const collection = this.collection(name);
    const rows = await this.db
      .delete(collection.table)
      .where(eq(collection.table.id, id))
      .returning({ id: collection.table.id });
    if (!rows.length)
      throw new NotFoundException(`${collection.label} not found`);
  }
}

/** A parent row must exist: a 404 naming it otherwise. */
export async function requireRow(
  db: NodePgDatabase,
  table: RecordTable,
  id: string | null | undefined,
  label: string,
  where?: SQL,
): Promise<void> {
  if (!id) return;
  const rows = await db
    .select({ id: table.id })
    .from(table as PgTable)
    .where(where ?? eq(table.id, id))
    .limit(1);
  if (!rows.length) throw new NotFoundException(`${label} not found`);
}
