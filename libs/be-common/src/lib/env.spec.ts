import { booleanEnv, listEnv, numberEnv, requiredEnv } from './env.js';

describe('environment helpers', () => {
  const env = {
    A: 'x',
    N: '42',
    BAD: 'abc',
    ON: 'yes',
    OFF: '0',
    LIST: ' a, b ,,c ',
  };

  it('reads required values and fails clearly when missing', () => {
    expect(requiredEnv('A', env)).toBe('x');
    expect(() => requiredEnv('MISSING', env)).toThrow(
      'Missing environment variable MISSING',
    );
  });

  it('parses numbers with a fallback', () => {
    expect(numberEnv('N', 1, env)).toBe(42);
    expect(numberEnv('MISSING', 7, env)).toBe(7);
    expect(() => numberEnv('BAD', 1, env)).toThrow('BAD must be a number');
  });

  it('parses booleans and comma lists', () => {
    expect(booleanEnv('ON', false, env)).toBe(true);
    expect(booleanEnv('OFF', true, env)).toBe(false);
    expect(booleanEnv('MISSING', true, env)).toBe(true);
    expect(listEnv('LIST', env)).toEqual(['a', 'b', 'c']);
  });
});
