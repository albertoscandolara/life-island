import {
  eventEnvelopeSchema,
  parseContractName,
  subjectFor,
} from './event-envelope.js';

describe('contract names', () => {
  it('parses a versioned name', () => {
    expect(parseContractName('grocery.receipt@1')).toEqual({
      type: 'grocery.receipt',
      version: 1,
    });
  });

  it('rejects unversioned or malformed names', () => {
    expect(() => parseContractName('grocery.receipt')).toThrow();
    expect(() => parseContractName('Grocery.Receipt@1')).toThrow();
    expect(() => parseContractName('receipt@1')).toThrow();
    expect(() => parseContractName('grocery.receipt@0')).toThrow();
  });

  it('maps an event type to a NATS subject', () => {
    expect(subjectFor('record.approved@2')).toBe('events.record.approved.v2');
  });
});

describe('event envelope', () => {
  it('accepts a well-formed envelope', () => {
    const result = eventEnvelopeSchema.safeParse({
      id: '0b9c5f8e-5d43-4c1a-9a51-3e2f4f9e7a10',
      type: 'record.approved@1',
      source: 'review',
      occurredAt: '2026-10-23T20:00:00.000Z',
      payload: { stagingId: 'abc' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing id', () => {
    const result = eventEnvelopeSchema.safeParse({
      type: 'record.approved@1',
      source: 'review',
      occurredAt: '2026-10-23T20:00:00.000Z',
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});
