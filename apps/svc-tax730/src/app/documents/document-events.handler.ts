import {
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_DELETED_EVENT,
  UPLOAD_UPDATED_EVENT,
  uploadCompletedV1,
  uploadDeletedV1,
  uploadUpdatedV1,
  type EventEnvelope,
} from '@life-island/contracts';
import { isNull, lte, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { documents } from '../db/schema.js';

export const DOCUMENT_EVENTS = [
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_UPDATED_EVENT,
  UPLOAD_DELETED_EVENT,
];

/**
 * Keeps `tax730.documents` in step with the documents you upload. Runs in the
 * consumer's transaction after `processed_events` recorded the event, and only
 * ever moves a document forward: an older snapshot never overwrites a newer
 * one, and a deleted document stays deleted.
 */
export async function applyDocumentEvent(
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
          description: e.description,
          originalFilename: e.originalFilename,
          fileFormat: e.fileFormat,
          uploadedAt: new Date(e.uploadedAt),
        })
        .onConflictDoNothing({ target: documents.uploadId });
      return;
    }
    case UPLOAD_UPDATED_EVENT: {
      const e = uploadUpdatedV1.parse(event.payload);
      const metadata = {
        title: e.title,
        description: e.description,
        originalFilename: e.originalFilename,
        fileFormat: e.fileFormat,
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
  }
}
