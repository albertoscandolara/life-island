import { Logger } from '@nestjs/common';
import {
  CATEGORY_CHANGED_EVENT,
  categoryChangedV1,
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_DELETED_EVENT,
  UPLOAD_UPDATED_EVENT,
  uploadCompletedV1,
  uploadDeletedV1,
  uploadUpdatedV1,
  type EventEnvelope,
} from '@life-island/contracts';
import { isNull, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { syncBillsIn } from '../bills/bill-ledger.js';
import { categoryTree, documents } from '../db/schema.js';
import { syncOrganizationsIn } from '../organizations/organization-ledger.js';

export const DOCUMENT_EVENTS = [
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_UPDATED_EVENT,
  UPLOAD_DELETED_EVENT,
  CATEGORY_CHANGED_EVENT,
];

/**
 * Keeps `home.documents` and `home.category_tree` in step with ingestion.
 * Runs in the consumer's transaction after `processed_events` recorded the
 * event, and only ever moves forward: an older snapshot never overwrites a
 * newer one, and a deleted document stays deleted.
 */
export async function applyDocumentEvent(
  event: EventEnvelope,
  client: pg.PoolClient,
): Promise<void> {
  await mirror(event, client);
  await syncBills(client);
  await syncOrganizations(client);
}

/** The companies documents name follow them too, the same way as bills. */
async function syncOrganizations(client: pg.PoolClient): Promise<void> {
  const db = drizzle(client);
  await db.execute(sql`savepoint organization_sync`);
  try {
    await syncOrganizationsIn(db);
    await db.execute(sql`release savepoint organization_sync`);
  } catch (error) {
    await db.execute(sql`rollback to savepoint organization_sync`);
    new Logger('OrganizationLedger').error(
      `Organization sync failed: ${String(error)}`,
    );
  }
}

/**
 * The bill entities follow the documents in the same transaction. A sync
 * that fails does not hold the documents back: it is rolled back alone and
 * the next event, or the next start, syncs again.
 */
async function syncBills(client: pg.PoolClient): Promise<void> {
  const db = drizzle(client);
  await db.execute(sql`savepoint bill_sync`);
  try {
    await syncBillsIn(db);
    await db.execute(sql`release savepoint bill_sync`);
  } catch (error) {
    await db.execute(sql`rollback to savepoint bill_sync`);
    new Logger('BillLedger').error(`Bill sync failed: ${String(error)}`);
  }
}

async function mirror(
  event: EventEnvelope,
  client: pg.PoolClient,
): Promise<void> {
  const db = drizzle(client);
  switch (event.type) {
    case UPLOAD_COMPLETED_EVENT: {
      const e = uploadCompletedV1.parse(event.payload);
      await db
        .insert(documents)
        .values({
          uploadId: e.uploadId,
          title: e.title,
          originalFilename: e.originalFilename,
          uploadedAt: new Date(e.uploadedAt),
        })
        .onConflictDoNothing({ target: documents.uploadId });
      return;
    }
    case UPLOAD_UPDATED_EVENT: {
      const e = uploadUpdatedV1.parse(event.payload);
      const metadata = {
        title: e.title,
        originalFilename: e.originalFilename,
        categories: e.categories,
        ...(e.fields ? { fields: e.fields } : {}),
        metadataUpdatedAt: new Date(e.updatedAt),
      };
      await db
        .insert(documents)
        .values({
          uploadId: e.uploadId,
          uploadedAt: new Date(e.uploadedAt),
          ...metadata,
        })
        .onConflictDoUpdate({
          target: documents.uploadId,
          set: metadata,
          setWhere: or(
            isNull(documents.metadataUpdatedAt),
            lte(documents.metadataUpdatedAt, metadata.metadataUpdatedAt),
          ),
        });
      return;
    }
    case UPLOAD_DELETED_EVENT: {
      const e = uploadDeletedV1.parse(event.payload);
      const deletedAt = new Date(e.deletedAt);
      await db
        .insert(documents)
        .values({
          uploadId: e.uploadId,
          title: '(deleted)',
          originalFilename: '',
          uploadedAt: deletedAt,
          deletedAt,
        })
        .onConflictDoUpdate({
          target: documents.uploadId,
          set: { deletedAt },
        });
      return;
    }
    case CATEGORY_CHANGED_EVENT: {
      // The newest change per category wins; a deletion stays as a tombstone.
      const e = categoryChangedV1.parse(event.payload);
      const values = {
        title: e.title,
        parentId: e.parentId,
        dimension: e.dimension,
        deleted: e.deleted,
        changedAt: new Date(e.changedAt),
      };
      await db
        .insert(categoryTree)
        .values({ id: e.id, ...values })
        .onConflictDoUpdate({
          target: categoryTree.id,
          set: values,
          setWhere: lte(categoryTree.changedAt, values.changedAt),
        });
      return;
    }
  }
}
