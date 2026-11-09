import { describe, expect, it } from 'vitest';
import { cycleShort } from './evaluations-tab';

describe('cycleShort', () => {
  it('shortens the period of an evaluation for a chart axis', () => {
    const at = (cycle: string | null, date: string | null = null) =>
      cycleShort({ cycle, date, periodEnd: null });
    expect(at('1° quadrimestre 2026')).toBe('1° 26');
    expect(at('H2 2025')).toBe('H2 25');
    expect(at('q3 2024')).toBe('Q3 24');
    expect(at(null, '2025-09-30')).toBe('Sep 25');
    expect(at('Annual review')).toBe('Annual review');
  });
});
