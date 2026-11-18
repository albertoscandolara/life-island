import { euroText, type AgendaEntryDto } from '@life-island/contracts';
import { agendaArea } from '../digest/digest.js';

/*
 * The Agenda as an iCalendar feed (RFC 5545), for the private calendar link:
 * every date from a month ago to a year ahead, all-day unless your own item
 * has a time. Each event keeps its Agenda key as UID, so a calendar app
 * updates it in place when its date or title changes.
 */

export const CALENDAR_NAME = 'Life Island';

/** Text in a property value: backslash, semicolon, comma and newlines escaped. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets go on with a space (RFC 5545 3.1), never splitting a character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    const limit = out.length ? 74 : 75;
    if (size + bytes > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

const day = (date: string) => date.replace(/-/g, '');
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

function stamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function buildCalendar(input: {
  entries: readonly AgendaEntryDto[];
  appUrl: string;
  now: Date;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Life Island//Agenda//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${CALENDAR_NAME}`,
    'X-WR-CALDESC:Every date of the island: renewals\\, bills\\, documents and your reminders',
    // Calendar apps that honour it read the link again every few hours.
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ];
  const dtstamp = stamp(input.now);
  for (const entry of input.entries) {
    const { name, emblem } = agendaArea(entry.module);
    const path =
      entry.path && entry.path.startsWith('/') && !entry.path.startsWith('//')
        ? entry.path
        : entry.source === 'item'
          ? '/agenda'
          : null;
    const description = [
      name,
      entry.amount !== null ? euroText(entry.amount) : null,
      entry.detail,
      entry.handled ? (entry.autoPaid ? 'Paid automatically' : 'Done') : null,
      path ? `${input.appUrl}${path}` : null,
    ].filter((part): part is string => !!part);
    const timed = entry.time && /^\d{2}:\d{2}$/.test(entry.time);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(entry.key)}@life-island`,
      `DTSTAMP:${dtstamp}`,
      ...(timed
        ? // Floating time: the island's own clock, wherever the phone is.
          [`DTSTART:${day(entry.date)}T${entry.time!.replace(':', '')}00`]
        : [
            `DTSTART;VALUE=DATE:${day(entry.date)}`,
            `DTEND;VALUE=DATE:${day(nextDay(entry.date))}`,
          ]),
      `SUMMARY:${icsText(`${entry.handled ? '✓ ' : ''}${emblem} ${entry.title}`)}`,
      `DESCRIPTION:${icsText(description.join('\n'))}`,
      ...(path ? [`URL:${input.appUrl}${path}`] : []),
      `CATEGORIES:${icsText(name)}`,
      'TRANSP:TRANSPARENT',
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
