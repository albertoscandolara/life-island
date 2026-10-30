import {
  DOCUMENT_PARSE_FAILED_EVENT,
  DOCUMENT_PARSE_INTERRUPTED_EVENT,
  DOCUMENT_PARSED_EVENT,
  documentParsedV1,
  documentParseFailedV1,
  documentParseInterruptedV1,
  RECORD_LOAD_FAILED_EVENT,
  RECORD_LOADED_EVENT,
  recordLoadedV1,
  recordLoadFailedV1,
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_PARSING_STARTED_EVENT,
  UPLOAD_UPDATED_EVENT,
  uploadCompletedV1,
  uploadParsingStartedV1,
  uploadUpdatedV1,
  type EventEnvelope,
  type RecordStatus,
} from '@life-island/contracts';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { stagingRecords } from '../db/schema.js';

export const HANDLED_EVENTS = [
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_PARSING_STARTED_EVENT,
  UPLOAD_UPDATED_EVENT,
  DOCUMENT_PARSED_EVENT,
  DOCUMENT_PARSE_FAILED_EVENT,
  DOCUMENT_PARSE_INTERRUPTED_EVENT,
  RECORD_LOADED_EVENT,
  RECORD_LOAD_FAILED_EVENT,
];

/** Statuses the parser may still move; once you confirm, its events no longer apply. */
const BEFORE_REVIEW: RecordStatus[] = [
  'UPLOADED',
  'PARSING',
  'PARTIALLY_PARSED',
  'PAUSED_QUOTA',
  'PAUSED_RATE_LIMIT',
  'PARSED',
  'PARSE_FAILED',
];

/** Waiting for the parser to start or continue. */
const WAITING: RecordStatus[] = [
  'UPLOADED',
  'PARTIALLY_PARSED',
  'PAUSED_QUOTA',
  'PAUSED_RATE_LIMIT',
  'PARSE_FAILED',
];

const INTERRUPTED_STATUS = {
  QUOTA_EXHAUSTED: 'PAUSED_QUOTA',
  RATE_LIMITED: 'PAUSED_RATE_LIMIT',
} as const;

/**
 * Applies one event to the inbox. Runs inside the consumer's transaction, after
 * `processed_events` has recorded the event id, so a redelivery is a no-op.
 * Updates only move a record forward, so a late or replayed event cannot undo
 * a newer state.
 */
export async function applyDocumentEvent(
  event: EventEnvelope,
  client: pg.PoolClient,
): Promise<void> {
  const db = drizzle(client);
  const now = new Date();
  switch (event.type) {
    case UPLOAD_COMPLETED_EVENT: {
      const e = uploadCompletedV1.parse(event.payload);
      await db
        .insert(stagingRecords)
        .values({
          uploadId: e.uploadId,
          title: e.title,
          description: e.description,
          originalFilename: e.originalFilename,
          fileFormat: e.fileFormat,
          uploadedAt: new Date(e.uploadedAt),
        })
        .onConflictDoNothing({ target: stagingRecords.uploadId });
      return;
    }
    case UPLOAD_UPDATED_EVENT: {
      // A snapshot of the document's metadata: the newest one wins, in any
      // status (you can recategorize a confirmed document too).
      const e = uploadUpdatedV1.parse(event.payload);
      const metadata = {
        title: e.title,
        description: e.description,
        categories: e.categories,
        suggestedCategories: e.suggestedCategories,
        metadataUpdatedAt: new Date(e.updatedAt),
        updatedAt: now,
      };
      await db
        .insert(stagingRecords)
        .values({
          uploadId: e.uploadId,
          originalFilename: e.originalFilename,
          fileFormat: e.fileFormat,
          uploadedAt: new Date(e.uploadedAt),
          ...metadata,
        })
        .onConflictDoUpdate({
          target: stagingRecords.uploadId,
          set: metadata,
          setWhere: or(
            isNull(stagingRecords.metadataUpdatedAt),
            lte(stagingRecords.metadataUpdatedAt, metadata.metadataUpdatedAt),
          ),
        });
      return;
    }
    case UPLOAD_PARSING_STARTED_EVENT: {
      const e = uploadParsingStartedV1.parse(event.payload);
      await db
        .update(stagingRecords)
        .set({ status: 'PARSING', updatedAt: now })
        .where(
          and(
            eq(stagingRecords.uploadId, e.uploadId),
            inArray(stagingRecords.status, WAITING),
          ),
        );
      return;
    }
    case DOCUMENT_PARSE_INTERRUPTED_EVENT: {
      const e = documentParseInterruptedV1.parse(event.payload);
      const status: RecordStatus =
        e.reason === 'QUOTA_EXHAUSTED' || e.reason === 'RATE_LIMITED'
          ? INTERRUPTED_STATUS[e.reason]
          : e.completedSteps.length > 0
            ? 'PARTIALLY_PARSED'
            : 'UPLOADED';
      await db
        .update(stagingRecords)
        .set({ status, parseError: e.error, updatedAt: now })
        .where(
          and(
            eq(stagingRecords.uploadId, e.uploadId),
            inArray(stagingRecords.status, ['PARSING', ...WAITING]),
          ),
        );
      return;
    }
    case DOCUMENT_PARSED_EVENT: {
      const e = documentParsedV1.parse(event.payload);
      const parsed = {
        title: e.title,
        description: e.description,
        fileFormat: e.fileFormat,
        status: 'PARSED' as const,
        category: e.category,
        targetKey: e.targetKey,
        aiPayload: e.details,
        confidence: e.confidence,
        flags: e.flags,
        parseError: null,
        parsedAt: new Date(e.parsedAt),
        updatedAt: now,
      };
      // Upsert: the record exists unless this event overtook upload.completed.
      await db
        .insert(stagingRecords)
        .values({
          uploadId: e.uploadId,
          originalFilename: e.originalFilename,
          uploadedAt: new Date(e.uploadedAt),
          ...parsed,
        })
        .onConflictDoUpdate({
          target: stagingRecords.uploadId,
          set: parsed,
          setWhere: inArray(stagingRecords.status, BEFORE_REVIEW),
        });
      return;
    }
    case DOCUMENT_PARSE_FAILED_EVENT: {
      const e = documentParseFailedV1.parse(event.payload);
      await db
        .update(stagingRecords)
        .set({ status: 'PARSE_FAILED', parseError: e.error, updatedAt: now })
        .where(
          and(
            eq(stagingRecords.uploadId, e.uploadId),
            inArray(stagingRecords.status, ['PARSING', ...WAITING]),
          ),
        );
      return;
    }
    case RECORD_LOADED_EVENT: {
      const e = recordLoadedV1.parse(event.payload);
      await db
        .update(stagingRecords)
        .set({
          status: 'LOADED',
          domainRecordId: e.domainRecordId,
          loadError: null,
          loadedAt: new Date(e.loadedAt),
          updatedAt: now,
        })
        .where(
          and(
            eq(stagingRecords.id, e.recordId),
            inArray(stagingRecords.status, ['CONFIRMED', 'LOAD_FAILED']),
          ),
        );
      return;
    }
    case RECORD_LOAD_FAILED_EVENT: {
      const e = recordLoadFailedV1.parse(event.payload);
      await db
        .update(stagingRecords)
        .set({ status: 'LOAD_FAILED', loadError: e.error, updatedAt: now })
        .where(
          and(
            eq(stagingRecords.id, e.recordId),
            eq(stagingRecords.status, 'CONFIRMED'),
          ),
        );
      return;
    }
  }
}
