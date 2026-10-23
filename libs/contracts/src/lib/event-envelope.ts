import { z } from 'zod';

/**
 * Versioned contract name, e.g. `grocery.receipt@1` or `record.approved@1`.
 * Lowercase dot-separated segments, then `@` and a positive integer version.
 */
export const contractNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+@[1-9][0-9]*$/,
    'expected <domain>.<name>@<version>',
  );

export type ContractName = z.infer<typeof contractNameSchema>;

export function parseContractName(name: string): {
  type: string;
  version: number;
} {
  const valid = contractNameSchema.parse(name);
  const [type, version] = valid.split('@');
  return { type, version: Number(version) };
}

/**
 * Every event on NATS travels in this envelope. `id` is the outbox row id,
 * so it doubles as the JetStream dedupe id and the consumer idempotency key.
 */
export const eventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: contractNameSchema,
  source: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.unknown(),
});

export type EventEnvelope<TPayload = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'payload'
> & {
  payload: TPayload;
};

/** NATS subject for an event type: `grocery.receipt@1` → `events.grocery.receipt.v1`. */
export function subjectFor(eventType: string): string {
  const { type, version } = parseContractName(eventType);
  return `events.${type}.v${version}`;
}
