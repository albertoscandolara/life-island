import {
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  connectNats,
  ensureEventsStream,
  OutboxRelay,
} from '@life-island/be-common';
import type { NatsConnection } from '@nats-io/transport-node';
import type pg from 'pg';

export interface EventsRuntimeOptions {
  pool: pg.Pool;
  natsUrl: string;
  /** The service's own schema; its outbox is relayed to NATS. */
  schema: string;
  /** Name stamped on published events and on the NATS connection. */
  serviceName: string;
  /** Runs once NATS is connected, e.g. to start consumers. */
  onConnected?: (nats: NatsConnection) => Promise<void>;
}

/**
 * Connects to NATS, makes sure the events stream exists and runs the outbox
 * relay for the lifetime of the Nest application.
 */
export class EventsRuntime
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EventsRuntime.name);
  private nats?: NatsConnection;
  private relay?: OutboxRelay;

  constructor(private readonly options: EventsRuntimeOptions) {}

  async onApplicationBootstrap(): Promise<void> {
    const { natsUrl, pool, schema, serviceName } = this.options;
    this.nats = await connectNats(natsUrl, serviceName);
    await ensureEventsStream(this.nats);
    this.relay = new OutboxRelay({
      pool,
      nats: this.nats,
      schema,
      source: serviceName,
      onError: (error) =>
        this.logger.error(`Outbox relay failed: ${String(error)}`),
    });
    this.relay.start();
    await this.options.onConnected?.(this.nats);
    this.logger.log(`Connected to NATS, relaying the ${schema} outbox`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
    await this.nats?.drain();
  }
}
