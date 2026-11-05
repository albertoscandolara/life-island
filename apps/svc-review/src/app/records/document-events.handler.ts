import {
  CATEGORY_CHANGED_EVENT,
  categoryChangedV1,
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
  UPLOAD_DELETED_EVENT,
  UPLOAD_PARSING_STARTED_EVENT,
  UPLOAD_REPARSE_REQUESTED_EVENT,
  UPLOAD_UPDATED_EVENT,
  uploadCompletedV1,
  uploadDeletedV1,
  uploadParsingStartedV1,
  uploadReparseRequestedV1,
  uploadUpdatedV1,
  RECORD_APPROVED_EVENT,
  type EventEnvelope,
  type RecordApprovedV1,
  type RecordStatus,
} from '@life-island/contracts';
import { enqueueEvent } from '@life-island/be-common';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { categoryTree, stagingRecords } from '../db/schema.js';

export const HANDLED_EVENTS = [
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_PARSING_STARTED_EVENT,
  UPLOAD_UPDATED_EVENT,
  UPLOAD_DELETED_EVENT,
  UPLOAD_REPARSE_REQUESTED_EVENT,
  DOCUMENT_PARSED_EVENT,
  DOCUMENT_PARSE_FAILED_EVENT,
  DOCUMENT_PARSE_INTERRUPTED_EVENT,
  RECORD_LOADED_EVENT,
  RECORD_LOAD_FAILED_EVENT,
  CATEGORY_CHANGED_EVENT,
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
  options: { autoConfirm?: boolean } = {},
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
        // Older events say nothing about historical reclassification: keep it.
        ...(e.historicalStatus !== undefined
          ? {
              historicalStatus: e.historicalStatus,
              historicalSuggestions: e.historicalSuggestions ?? [],
            }
          : {}),
        // Older events carry no fields: keep what is stored.
        ...(e.fields ? { documentFields: e.fields } : {}),
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
    case UPLOAD_DELETED_EVENT: {
      // A tombstone, not a delete: a late upload.updated must not bring it back.
      const e = uploadDeletedV1.parse(event.payload);
      const deletedAt = new Date(e.deletedAt);
      await db
        .insert(stagingRecords)
        .values({
          uploadId: e.uploadId,
          title: '(deleted)',
          originalFilename: '',
          uploadedAt: deletedAt,
          deletedAt,
        })
        .onConflictDoUpdate({
          target: stagingRecords.uploadId,
          set: { deletedAt, updatedAt: now },
          setWhere: isNull(stagingRecords.deletedAt),
        });
      return;
    }
    case UPLOAD_REPARSE_REQUESTED_EVENT: {
      // You sent the document back to the parser: what the AI read is gone,
      // and so are your corrections to it; the record waits to be parsed
      // again. Only a record still waiting for review: a confirmed one has
      // already gone to its module and stays as it is.
      const e = uploadReparseRequestedV1.parse(event.payload);
      await db
        .update(stagingRecords)
        .set({
          status: 'UPLOADED',
          category: null,
          targetKey: null,
          aiTargetKey: null,
          aiPayload: null,
          reviewedPayload: null,
          documentFields: null,
          confidence: null,
          flags: [],
          parseError: null,
          parsedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(stagingRecords.uploadId, e.uploadId),
            eq(stagingRecords.status, 'PARSED'),
          ),
        );
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
        fileFormat: e.fileFormat,
        status: 'PARSED' as const,
        category: e.category,
        targetKey: e.targetKey,
        aiTargetKey: e.targetKey,
        aiPayload: e.details,
        confidence: e.confidence,
        flags: e.flags,
        // Older events say nothing: something to check, by default.
        reviewReasons: e.reviewReasons ?? ['LOW_CONFIDENCE'],
        parseError: null,
        parsedAt: new Date(e.parsedAt),
        updatedAt: now,
      };
      // Upsert: the record exists unless this event overtook upload.completed.
      await db
        .insert(stagingRecords)
        .values({
          uploadId: e.uploadId,
          title: e.title,
          description: e.description,
          originalFilename: e.originalFilename,
          uploadedAt: new Date(e.uploadedAt),
          ...parsed,
        })
        .onConflictDoUpdate({
          target: stagingRecords.uploadId,
          // Title and description come from upload.updated once one arrived
          // (it is the newer snapshot of your edits); only before that from here.
          set: {
            ...parsed,
            title: sql`case when ${stagingRecords.metadataUpdatedAt} is null then excluded.title else ${stagingRecords.title} end`,
            description: sql`case when ${stagingRecords.metadataUpdatedAt} is null then excluded.description else ${stagingRecords.description} end`,
          },
          setWhere: inArray(stagingRecords.status, BEFORE_REVIEW),
        });
      if (options.autoConfirm && e.reviewReasons?.length === 0)
        await autoConfirm(client, e.uploadId);
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
    case CATEGORY_CHANGED_EVENT: {
      // The category hierarchy, for filters that include descendants. The
      // newest change per category wins; a deletion stays as a tombstone.
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

/**
 * Nothing to check: the record is confirmed on its own, in the same
 * transaction as the parse, with the same `record.approved` a click on
 * Confirm sends. Only a record that keeps its data in the archive gets here
 * (the parser holds back anything a module loads), so it can be sent back
 * to review for AUTO_CONFIRM_UNDO_DAYS.
 */
async function autoConfirm(
  client: pg.PoolClient,
  uploadId: string,
): Promise<void> {
  const now = new Date();
  const [row] = await drizzle(client)
    .update(stagingRecords)
    .set({
      status: 'CONFIRMED',
      confirmedAt: now,
      autoConfirmedAt: now,
      loadError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(stagingRecords.uploadId, uploadId),
        eq(stagingRecords.status, 'PARSED'),
        isNull(stagingRecords.deletedAt),
      ),
    )
    .returning();
  if (!row?.targetKey || !row.category) return;
  const approved: RecordApprovedV1 = {
    recordId: row.id,
    uploadId: row.uploadId,
    category: row.category,
    targetKey: row.targetKey,
    payload: row.reviewedPayload ?? row.aiPayload,
    ...(row.documentFields ? { documentFields: row.documentFields } : {}),
    approvedAt: now.toISOString(),
  };
  await enqueueEvent(client, 'review', {
    type: RECORD_APPROVED_EVENT,
    payload: approved,
  });
}
