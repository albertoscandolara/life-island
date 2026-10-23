import {
  jetstreamManager,
  RetentionPolicy,
  StorageType,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';

export const EVENTS_STREAM = 'EVENTS';

export function connectNats(
  servers: string | string[],
  name?: string,
): Promise<NatsConnection> {
  return connect({ servers, name });
}

/** Creates the stream every outbox publishes to, if it does not exist yet. */
export async function ensureEventsStream(nc: NatsConnection): Promise<void> {
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info(EVENTS_STREAM);
  } catch {
    await jsm.streams.add({
      name: EVENTS_STREAM,
      subjects: ['events.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      // JetStream drops a republished outbox row with the same id inside this window.
      duplicate_window: 2 * 60 * 1_000_000_000,
    });
  }
}
