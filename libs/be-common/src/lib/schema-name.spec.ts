import { assertSchemaName } from './schema-name.js';

describe('assertSchemaName', () => {
  it('accepts plain lowercase identifiers', () => {
    expect(assertSchemaName('tax730')).toBe('tax730');
    expect(assertSchemaName('ingestion')).toBe('ingestion');
  });

  it('rejects anything that could break out of an identifier', () => {
    for (const bad of [
      '',
      'Review',
      'review; drop table x',
      'review.outbox',
      '"review"',
      '1grocery',
    ]) {
      expect(() => assertSchemaName(bad)).toThrow();
    }
  });
});
