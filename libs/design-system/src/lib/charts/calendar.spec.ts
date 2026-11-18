import { calendarGrid, heatLevel } from './calendar';

describe('calendar heatmap', () => {
  it('lays days in Monday-first weeks', () => {
    // 2026-11-18 is a Wednesday.
    const grid = calendarGrid('2026-11-18', '2026-11-24');
    expect(grid.cells[0]).toEqual({ date: '2026-11-18', week: 0, weekday: 2 });
    expect(grid.cells.at(-1)).toEqual({
      date: '2026-11-24',
      week: 1,
      weekday: 1,
    });
    expect(grid.weeks).toBe(2);
  });

  it('labels each month once, never two on top of each other', () => {
    const year = calendarGrid('2026-01-01', '2026-12-31');
    expect(year.months.map((m) => m.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
    expect(year.cells).toHaveLength(365);
    // Starting on the 30th, November gives way to December.
    expect(
      calendarGrid('2026-11-30', '2026-12-31').months.map((m) => m.label),
    ).toEqual(['Dec']);
  });

  it('is empty when the range is backwards', () => {
    expect(calendarGrid('2026-02-01', '2026-01-01').cells).toEqual([]);
  });

  it('grades a day against the busiest one', () => {
    expect(heatLevel(undefined, 10)).toBe(0);
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });
});
