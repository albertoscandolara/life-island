import { describe, expect, it } from 'vitest';
import { dreamPulse, withChecks } from './habits.js';

const habit = {
  id: 'h1',
  title: 'Walk',
  dreamId: null,
  perWeek: 3,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('withChecks', () => {
  it('counts this week and the weeks in a row at target', () => {
    // Monday 2026-11-23 is this week; the two weeks before reached 3 days.
    const checks = [
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-16',
      '2026-11-18',
      '2026-11-20',
      '2026-11-23',
    ];
    const out = withChecks(habit, checks, '2026-11-25');
    expect(out.thisWeek).toBe(1);
    expect(out.streak).toBe(2);
    expect(out.checked).toHaveLength(7);
  });

  it('counts this week once its target is reached', () => {
    const out = withChecks(
      habit,
      ['2026-11-23', '2026-11-24', '2026-11-25'],
      '2026-11-25',
    );
    expect(out.streak).toBe(1);
  });
});

describe('dreamPulse', () => {
  const dream = {
    status: 'moving' as const,
    createdAt: '2026-10-01T00:00:00.000Z',
    targetDate: '2026-12-31',
  };

  it('is stuck when a chosen step has waited two weeks', () => {
    const out = dreamPulse(
      dream,
      [
        { status: 'done', doneOn: '2026-11-01' },
        { status: 'chosen', doneOn: null },
      ],
      '2026-11-27',
    );
    expect(out).toEqual({ idleDays: 26, stuck: true, daysLeft: 34 });
  });

  it('is never stuck while you are thinking it through, or without a chosen step', () => {
    expect(
      dreamPulse(
        { ...dream, status: 'dreaming' },
        [{ status: 'chosen', doneOn: null }],
        '2026-11-27',
      ).stuck,
    ).toBe(false);
    expect(dreamPulse(dream, [], '2026-11-27').stuck).toBe(false);
  });
});
