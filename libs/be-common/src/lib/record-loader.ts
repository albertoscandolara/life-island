import {
  findTarget,
  RECORD_APPROVED_EVENT,
  RECORD_LOAD_FAILED_EVENT,
  RECORD_LOADED_EVENT,
  recordApprovedV1,
  type EventEnvelope,
  type RecordApprovedV1,
  type RecordLoadedV1,
  type RecordLoadFailedV1,
} from '@life-island/contracts';
import type pg from 'pg';
import { enqueueEvent } from './outbox.js';

/**
 * A record the loader cannot take for a business reason (it does not fit the
 * module's rules). It answers `record.load_failed`, which the inbox shows with
 * a retry; any other error is a technical failure and the event is redelivered.
 */
export class LoadRejectedError extends Error {}

export interface RecordLoader<TPayload = unknown> {
  /** Target keys this module loads, e.g. `['grocery.receipt@1']`. */
  targetKeys: readonly string[];
  /**
   * Writes the record into the module's own tables and returns its id there.
   * It runs in the consumer's transaction; `source_staging_id` (the review
   * record id) must be unique, so a replay returns the row already stored.
   */
  load(
    client: pg.PoolClient,
    payload: TPayload,
    record: RecordApprovedV1,
  ): Promise<string>;
}

/**
 * The `record.approved` handler of a domain service: checks the payload
 * against the target's schema, loads it with `loader`, and answers with
 * `record.loaded` or `record.load_failed` from the same transaction. Records
 * for other targets are ignored (each module subscribes to everything and
 * keeps its own).
 */
export function recordApprovedHandler<TPayload>(
  schema: string,
  loader: RecordLoader<TPayload>,
): (event: EventEnvelope, client: pg.PoolClient) => Promise<void> {
  return async (event, client) => {
    if (event.type !== RECORD_APPROVED_EVENT) return;
    const record = recordApprovedV1.parse(event.payload);
    if (!loader.targetKeys.includes(record.targetKey)) return;

    const fail = async (error: string) => {
      const failed: RecordLoadFailedV1 = {
        recordId: record.recordId,
        error,
        failedAt: new Date().toISOString(),
      };
      await enqueueEvent(client, schema, {
        type: RECORD_LOAD_FAILED_EVENT,
        payload: failed,
      });
    };

    const target = findTarget(record.targetKey);
    const parsed = target?.schema.safeParse(record.payload);
    if (!target || !parsed?.success) {
      await fail(
        parsed?.success === false
          ? parsed.error.issues
              .map(
                (issue) =>
                  `${issue.path.join('.') || 'details'}: ${issue.message}`,
              )
              .join('; ')
          : `Unknown target ${record.targetKey}`,
      );
      return;
    }

    let domainRecordId: string;
    await client.query('savepoint record_load');
    try {
      domainRecordId = await loader.load(
        client,
        parsed.data as TPayload,
        record,
      );
      await client.query('release savepoint record_load');
    } catch (error) {
      if (!(error instanceof LoadRejectedError)) throw error;
      // Undo the partial load, keep the event bookkeeping, answer the failure.
      await client.query('rollback to savepoint record_load');
      await fail(error.message);
      return;
    }
    const loaded: RecordLoadedV1 = {
      recordId: record.recordId,
      domainRecordId,
      loadedAt: new Date().toISOString(),
    };
    await enqueueEvent(client, schema, {
      type: RECORD_LOADED_EVENT,
      payload: loaded,
    });
  };
}
