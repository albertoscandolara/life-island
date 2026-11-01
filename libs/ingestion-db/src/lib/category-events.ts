import { enqueueEvent } from '@life-island/be-common';
import {
  CATEGORY_CHANGED_EVENT,
  type CategoryChangedV1,
  type CategoryDimension,
} from '@life-island/contracts';
import type pg from 'pg';

interface CategoryRowSnapshot {
  id: string;
  title: string;
  parent_id: string | null;
  dimension: CategoryDimension | null;
  now: Date;
}

/**
 * Adds one `category.changed` event per category to the outbox, with what is
 * committed now: call it in the transaction that changed them, after the
 * change. Ids in `deletedIds` are sent as deleted (they no longer have a row).
 */
export async function enqueueCategoriesChanged(
  client: pg.ClientBase,
  schema: string,
  categoryIds: readonly string[],
  deleted: readonly { id: string; title: string }[] = [],
): Promise<void> {
  const ids = [...new Set(categoryIds)];
  const { rows } = await client.query<CategoryRowSnapshot>(
    `select id, title, parent_id, dimension, clock_timestamp() as now
       from ingestion.document_categories
      where id = any($1::text[])
      order by id`,
    [ids],
  );
  const now =
    rows[0]?.now ??
    (await client.query<{ now: Date }>('select clock_timestamp() as now'))
      .rows[0].now;
  const events: CategoryChangedV1[] = [
    ...rows.map((row) => ({
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      dimension: row.dimension,
      deleted: false,
      changedAt: row.now.toISOString(),
    })),
    ...deleted.map((category) => ({
      id: category.id,
      title: category.title,
      parentId: null,
      dimension: null,
      deleted: true,
      changedAt: now.toISOString(),
    })),
  ];
  for (const event of events)
    await enqueueEvent(client, schema, {
      type: CATEGORY_CHANGED_EVENT,
      payload: event,
    });
}
