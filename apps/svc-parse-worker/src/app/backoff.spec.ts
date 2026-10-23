import { backoffMinutes } from './parse.service.js';

describe('backoffMinutes', () => {
  it('grows by four each attempt and stops at one day', () => {
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 4, 16, 64, 256]);
    expect(backoffMinutes(6)).toBe(1024);
    expect(backoffMinutes(7)).toBe(1440);
    expect(backoffMinutes(0)).toBe(1);
  });
});
