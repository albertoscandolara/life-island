import {
  DIGEST_DEFAULTS,
  DIGEST_FREQUENCY_SETTING,
  DIGEST_MONTH_DAY_SETTING,
  DIGEST_RECIPIENT_SETTING,
  DIGEST_TIME_SETTING,
  DIGEST_WEEKDAY_SETTING,
  digestScheduleText,
  digestSettings,
  dueDigestSlot,
  lastDigestSlot,
  localMoment,
  nextDigestSlot,
  type DigestSettings,
} from './digest.js';
import { invalidSettingValue } from './settings.js';

const weekly: DigestSettings = {
  ...DIGEST_DEFAULTS,
  frequency: 'weekly',
  weekday: 1,
  time: '07:30',
};

describe('digest settings', () => {
  it('reads the replicated values, falling back on wrong ones', () => {
    expect(digestSettings(new Map())).toEqual(DIGEST_DEFAULTS);
    expect(
      digestSettings(
        new Map<string, unknown>([
          [DIGEST_FREQUENCY_SETTING, 'monthly'],
          [DIGEST_RECIPIENT_SETTING, '0b6c1f4e-6a39-4c43-9f0e-2d3c4b5a6e7f'],
          [DIGEST_TIME_SETTING, '18:05'],
          [DIGEST_WEEKDAY_SETTING, '5'],
          [DIGEST_MONTH_DAY_SETTING, 15],
        ]),
      ),
    ).toEqual({
      frequency: 'monthly',
      recipientId: '0b6c1f4e-6a39-4c43-9f0e-2d3c4b5a6e7f',
      time: '18:05',
      weekday: 5,
      monthDay: 15,
    });
    expect(
      digestSettings(
        new Map<string, unknown>([
          [DIGEST_FREQUENCY_SETTING, 'hourly'],
          [DIGEST_RECIPIENT_SETTING, 'none'],
          [DIGEST_TIME_SETTING, '25:00'],
          [DIGEST_WEEKDAY_SETTING, '9'],
          [DIGEST_MONTH_DAY_SETTING, 31],
        ]),
      ),
    ).toEqual(DIGEST_DEFAULTS);
  });

  it('takes a person or nobody as the recipient in Settings', () => {
    expect(invalidSettingValue(DIGEST_RECIPIENT_SETTING, 'none')).toBeNull();
    expect(
      invalidSettingValue(
        DIGEST_RECIPIENT_SETTING,
        '0b6c1f4e-6a39-4c43-9f0e-2d3c4b5a6e7f',
      ),
    ).toBeNull();
    expect(
      invalidSettingValue(DIGEST_RECIPIENT_SETTING, 'mario@example.com'),
    ).not.toBeNull();
    expect(invalidSettingValue(DIGEST_MONTH_DAY_SETTING, 29)).not.toBeNull();
  });

  it('says the schedule in words', () => {
    expect(digestScheduleText(weekly)).toBe('Every Monday at 07:30');
    expect(
      digestScheduleText({ ...weekly, frequency: 'monthly', monthDay: 2 }),
    ).toBe('On the 2nd of every month at 07:30');
    expect(digestScheduleText({ ...weekly, frequency: 'daily' })).toBe(
      'Every day at 07:30',
    );
  });
});

describe('digest schedule', () => {
  it('reads the island clock in its time zone', () => {
    // 23:30 UTC on 31 March is 01:30 of 1 April in Rome (summer time).
    expect(localMoment('Europe/Rome', new Date('2026-03-31T23:30:00Z'))).toBe(
      '2026-04-01T01:30',
    );
  });

  it('finds the last and next send of each frequency', () => {
    // 2026-11-18 is a Wednesday.
    expect(lastDigestSlot(weekly, '2026-11-18T10:00')).toEqual({
      period: 'weekly:2026-11-16',
      at: '2026-11-16T07:30',
    });
    expect(nextDigestSlot(weekly, '2026-11-18T10:00')?.at).toBe(
      '2026-11-23T07:30',
    );
    const daily = { ...weekly, frequency: 'daily' as const };
    expect(lastDigestSlot(daily, '2026-11-18T07:29')?.period).toBe(
      'daily:2026-11-17',
    );
    expect(lastDigestSlot(daily, '2026-11-18T07:30')?.period).toBe(
      'daily:2026-11-18',
    );
    const monthly = { ...weekly, frequency: 'monthly' as const, monthDay: 20 };
    expect(lastDigestSlot(monthly, '2026-11-18T10:00')).toEqual({
      period: 'monthly:2026-10',
      at: '2026-10-20T07:30',
    });
    expect(nextDigestSlot(monthly, '2026-11-18T10:00')?.at).toBe(
      '2026-11-20T07:30',
    );
    expect(
      lastDigestSlot({ ...weekly, frequency: 'off' }, '2026-11-18T10:00'),
    ).toBeNull();
  });

  it('sends the one due, not one missed by a day, nor one due before it was turned on', () => {
    expect(dueDigestSlot(weekly, '2026-11-16T07:31', null)?.period).toBe(
      'weekly:2026-11-16',
    );
    // Down from Monday morning to Tuesday afternoon: the next Monday's comes.
    expect(dueDigestSlot(weekly, '2026-11-17T08:00', null)).toBeNull();
    // Turned on at 09:00 on Monday: this morning's is not sent at once.
    expect(
      dueDigestSlot(weekly, '2026-11-16T09:05', '2026-11-16T09:00'),
    ).toBeNull();
    expect(
      dueDigestSlot(weekly, '2026-11-16T07:35', '2026-11-16T07:00')?.period,
    ).toBe('weekly:2026-11-16');
  });
});
