import { readingSchedule } from './scheduler.js';

describe('readingSchedule', () => {
  const env = { schedule: '0 6 * * *', runOnStart: true };

  it('keeps PARSE_SCHEDULE and PARSE_RUN_ON_START until Settings sets them', () => {
    expect(readingSchedule(env, new Map())).toEqual({
      cron: '0 6 * * *',
      runOnStart: true,
    });
  });

  it('takes the time and the startup run from Settings', () => {
    expect(
      readingSchedule(
        env,
        new Map<string, unknown>([
          ['documents.reading-time', '21:30'],
          ['documents.read-on-start', false],
        ]),
      ),
    ).toEqual({ cron: '30 21 * * *', runOnStart: false });
  });

  it('has no daily run when you turned it off, and ignores an invalid time', () => {
    expect(
      readingSchedule(
        env,
        new Map<string, unknown>([['documents.scheduled-reading', false]]),
      ).cron,
    ).toBeNull();
    expect(
      readingSchedule(
        env,
        new Map<string, unknown>([['documents.reading-time', '99:99']]),
      ).cron,
    ).toBe('0 6 * * *');
  });
});
