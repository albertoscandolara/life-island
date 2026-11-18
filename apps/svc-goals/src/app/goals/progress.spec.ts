import { HABIT_HISTORY_DAYS, isoAddDays } from '@life-island/contracts';
import { withChecks } from './progress';

const habit = {
  id: 'h1',
  title: 'Walk',
  goalId: null,
  perWeek: 3,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('a habit with its checked days', () => {
  // 2026-11-18 is a Wednesday.
  const today = '2026-11-18';

  it('keeps thirteen weeks of days for its calendar, oldest first', () => {
    const checks = [
      today,
      isoAddDays(today, -(HABIT_HISTORY_DAYS - 1)),
      isoAddDays(today, -HABIT_HISTORY_DAYS),
      isoAddDays(today, -40),
    ];
    expect(withChecks(habit, checks, today).checked).toEqual([
      isoAddDays(today, -(HABIT_HISTORY_DAYS - 1)),
      isoAddDays(today, -40),
      today,
    ]);
  });

  it('counts the weeks in a row at target', () => {
    const checks = [
      // This week: 3 of 3.
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      // Last week: 3 of 3.
      '2026-11-09',
      '2026-11-11',
      '2026-11-13',
      // The week before: 1, so the streak stops.
      '2026-11-04',
    ];
    const result = withChecks(habit, checks, today);
    expect(result.thisWeek).toBe(3);
    expect(result.streak).toBe(2);
  });
});
