import type { AgendaEntryDto } from '@life-island/contracts';
import { buildCalendar, foldLine, icsText } from './ics.js';

const entry = (over: Partial<AgendaEntryDto>): AgendaEntryDto => ({
  key: 'module:cars:insurance:car-1:2026-11-21',
  source: 'module',
  module: 'cars',
  kind: 'insurance',
  title: 'Insurance of the Panda',
  detail: 'Allianz; RCA, yearly',
  date: '2026-11-21',
  time: null,
  amount: 420,
  path: '/cars',
  daysLeft: 3,
  urgency: 'week',
  handled: false,
  autoPaid: false,
  itemId: null,
  category: null,
  ...over,
});

const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('buildCalendar', () => {
  const ics = buildCalendar({
    entries: [
      entry({}),
      entry({
        key: 'item:abc:2026-11-19',
        source: 'item',
        module: 'agenda',
        title: 'Call the plumber',
        date: '2026-11-19',
        time: '09:30',
        amount: null,
        detail: null,
        path: null,
        handled: true,
      }),
      entry({ key: 'evil', path: 'https://evil.example', title: 'x' }),
    ],
    appUrl: 'https://island.example',
    now: new Date('2026-11-18T13:00:00.123Z'),
  });
  const text = unfold(ics);

  it('is a calendar with one event per date, lines ending in CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(
      ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
  });

  it('makes a deadline an all-day event, kept by its Agenda key', () => {
    expect(text).toContain(
      'UID:module:cars:insurance:car-1:2026-11-21@life-island',
    );
    expect(text).toContain('DTSTART;VALUE=DATE:20261121');
    expect(text).toContain('DTEND;VALUE=DATE:20261122');
    expect(text).toContain('DTSTAMP:20261118T130000Z');
    expect(text).toContain('SUMMARY:🚗 Insurance of the Panda');
    expect(text).toContain(
      'DESCRIPTION:Cars\\n420\\,00 €\\nAllianz\\; RCA\\, yearly\\nhttps://island.example/cars',
    );
    expect(text).toContain('URL:https://island.example/cars');
  });

  it('gives your own item its time, and marks a handled date', () => {
    expect(text).toContain('DTSTART:20261119T093000');
    expect(text).toContain('SUMMARY:✓ 🗓️ Call the plumber');
    expect(text).toContain('URL:https://island.example/agenda');
  });

  it('never links outside the island', () => {
    expect(text).not.toContain('evil.example');
  });
});

describe('ics text', () => {
  it('escapes what would break a property', () => {
    expect(icsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds long lines without splitting a character', () => {
    const line = `SUMMARY:${'è'.repeat(60)}`;
    const folded = foldLine(line);
    expect(folded.split('\r\n ').join('')).toBe(line);
    for (const part of folded.split('\r\n'))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
  });
});
