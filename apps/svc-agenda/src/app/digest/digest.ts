import {
  ATTENTION_SOURCES,
  DIGEST_HORIZON_DAYS,
  euroText,
  type AgendaEntryDto,
  type AgendaWaitingDto,
  type DigestDto,
  type DigestFrequency,
  type DigestLineDto,
} from '@life-island/contracts';

/*
 * The email digest, written by Life Island's own rules (no AI): what is
 * overdue, what comes within the horizon of its frequency, and what waits for
 * you with no date, each line linking to the page where it is handled. Pure,
 * so a preview and a sent email are the same.
 */

/** At most this many lines in a section; the rest is counted. */
export const DIGEST_SECTION_LIMIT = 15;

const AREAS: Record<string, { name: string; emblem: string }> = {
  ...Object.fromEntries(
    ATTENTION_SOURCES.map((s) => [
      s.module,
      { name: s.name, emblem: s.emblem },
    ]),
  ),
  agenda: { name: 'Agenda', emblem: '🗓️' },
};

/** An area's name and emblem, as the island shows them. */
export const agendaArea = (module: string) =>
  AREAS[module] ?? { name: module, emblem: '•' };
const area = agendaArea;

export interface DigestInput {
  today: string;
  frequency: Exclude<DigestFrequency, 'off'>;
  /** The Agenda's entries (handled ones are left out here). */
  entries: readonly AgendaEntryDto[];
  waiting: readonly AgendaWaitingDto[];
  /** The island's address, for the links. */
  appUrl: string;
  /** The first name of who reads it, for the greeting. */
  name: string | null;
}

const dayText = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T00:00:00Z`),
  );

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function link(appUrl: string, path: string | null): string | null {
  // Only the island's own pages: a path, never another site.
  return path && path.startsWith('/') && !path.startsWith('//')
    ? `${appUrl}${path}`
    : null;
}

function entryLine(entry: AgendaEntryDto, appUrl: string): DigestLineDto {
  const { name, emblem } = area(entry.module);
  return {
    date: entry.date,
    daysLeft: entry.daysLeft,
    area: name,
    emblem,
    title: entry.title,
    detail: entry.detail,
    amount: entry.amount,
    url: link(
      appUrl,
      entry.path ?? (entry.source === 'item' ? '/agenda' : null),
    ),
  };
}

function waitingLine(item: AgendaWaitingDto, appUrl: string): DigestLineDto {
  const { name, emblem } = area(item.module);
  return {
    date: item.since,
    daysLeft: null,
    area: name,
    emblem,
    title: item.title,
    detail: item.detail,
    amount: null,
    url: link(appUrl, item.path),
  };
}

/** "3 days late", "Today", "Tomorrow", "In 5 days". */
export function whenText(line: DigestLineDto): string {
  if (line.daysLeft === null)
    return line.date
      ? `Since ${dayText(line.date, { day: 'numeric', month: 'short' })}`
      : 'Waiting';
  if (line.daysLeft < 0) return `${plural(-line.daysLeft, 'day')} late`;
  if (line.daysLeft === 0) return 'Today';
  if (line.daysLeft === 1) return 'Tomorrow';
  return `${dayText(line.date!, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

export function buildDigest(input: DigestInput): DigestDto {
  const horizonDays = DIGEST_HORIZON_DAYS[input.frequency];
  const open = input.entries
    .filter((e) => !e.handled && e.daysLeft <= horizonDays)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
  const overdue = open
    .filter((e) => e.daysLeft < 0)
    .map((e) => entryLine(e, input.appUrl));
  const coming = open
    .filter((e) => e.daysLeft >= 0)
    .map((e) => entryLine(e, input.appUrl));
  const waiting = input.waiting.map((w) => waitingLine(w, input.appUrl));
  const empty = !overdue.length && !coming.length && !waiting.length;

  const horizon =
    input.frequency === 'daily'
      ? 'in the next 3 days'
      : input.frequency === 'weekly'
        ? 'this week'
        : 'this month';
  const parts = [
    overdue.length ? `${overdue.length} overdue` : null,
    coming.length ? `${coming.length} ${horizon}` : null,
    waiting.length ? `${waiting.length} waiting for you` : null,
  ].filter((p): p is string => !!p);
  const subject = empty
    ? 'Life Island: nothing needs you'
    : `Life Island: ${parts.join(', ')}`;
  const heading = dayText(input.today, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const summary = empty
    ? `Nothing is overdue or due ${horizon}, and nothing waits for you.`
    : overdue.length
      ? `Start with what is overdue: ${plural(overdue.length, 'date')} passed without being marked done.`
      : coming.length
        ? `Nothing is overdue. ${plural(coming.length, 'date')} ${coming.length === 1 ? 'comes' : 'come'} ${horizon}.`
        : 'No dates are close, but some things wait for you.';

  const digest = {
    subject,
    heading,
    summary,
    overdue,
    coming,
    waiting,
    horizonDays,
    empty,
  };
  return {
    ...digest,
    text: digestText(digest, input),
    html: digestHtml(digest, input),
  };
}

type DigestBody = Omit<DigestDto, 'text' | 'html'>;

function sections(digest: DigestBody) {
  return [
    { title: 'Overdue', lines: digest.overdue, tone: '#b42318' },
    {
      title: `Coming in the next ${plural(digest.horizonDays, 'day')}`,
      lines: digest.coming,
      tone: '#0b6e69',
    },
    { title: 'Waiting for you', lines: digest.waiting, tone: '#8a5a00' },
  ].filter((s) => s.lines.length);
}

function digestText(digest: DigestBody, input: DigestInput): string {
  const out = [
    `${input.name ? `Hi ${input.name},` : 'Hi,'} here is your Life Island for ${digest.heading}.`,
    '',
    digest.summary,
  ];
  for (const section of sections(digest)) {
    out.push('', section.title.toUpperCase());
    for (const line of section.lines.slice(0, DIGEST_SECTION_LIMIT)) {
      const amount = line.amount !== null ? ` · ${euroText(line.amount)}` : '';
      out.push(
        `- ${whenText(line)} · ${line.area}: ${line.title}${amount}`,
        ...(line.url ? [`  ${line.url}`] : []),
      );
    }
    if (section.lines.length > DIGEST_SECTION_LIMIT)
      out.push(
        `  …and ${section.lines.length - DIGEST_SECTION_LIMIT} more in the Agenda.`,
      );
  }
  out.push(
    '',
    `Open the Agenda: ${input.appUrl}/agenda`,
    `Change or stop this email: ${input.appUrl}/settings`,
  );
  return out.join('\n');
}

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function lineHtml(line: DigestLineDto, tone: string): string {
  const title = line.url
    ? `<a href="${escape(line.url)}" style="color:#1d2433;text-decoration:none;font-weight:600">${escape(line.title)}</a>`
    : `<span style="font-weight:600">${escape(line.title)}</span>`;
  const amount =
    line.amount !== null
      ? `<td style="padding:10px 0 10px 12px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:#1d2433">${escape(euroText(line.amount))}</td>`
      : '<td></td>';
  return `<tr style="border-top:1px solid #e7e3da">
<td style="padding:10px 12px 10px 0;white-space:nowrap;vertical-align:top;color:${tone};font-size:13px;font-weight:600">${escape(whenText(line))}</td>
<td style="padding:10px 0;vertical-align:top">${title}<div style="color:#5b6472;font-size:13px;margin-top:2px">${line.emblem} ${escape(line.area)}${line.detail ? ` · ${escape(line.detail)}` : ''}</div></td>
${amount}</tr>`;
}

function digestHtml(digest: DigestBody, input: DigestInput): string {
  const body = sections(digest)
    .map((section) => {
      const rows = section.lines
        .slice(0, DIGEST_SECTION_LIMIT)
        .map((line) => lineHtml(line, section.tone))
        .join('\n');
      const more =
        section.lines.length > DIGEST_SECTION_LIMIT
          ? `<p style="margin:8px 0 0;color:#5b6472;font-size:13px">…and ${section.lines.length - DIGEST_SECTION_LIMIT} more in the Agenda.</p>`
          : '';
      return `<h2 style="margin:28px 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${section.tone}">${escape(section.title)} · ${section.lines.length}</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px">${rows}</table>${more}`;
    })
    .join('\n');
  const greeting = input.name ? `Hi ${escape(input.name)},` : 'Hi,';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(digest.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(29,36,51,.08)">
<tr><td style="background:linear-gradient(135deg,#0b6e69,#2a9d8f);padding:24px 28px;color:#ffffff">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">🏝️ Life Island</div>
<div style="font-size:24px;font-weight:700;margin-top:6px">${escape(digest.heading)}</div>
</td></tr>
<tr><td style="padding:24px 28px 8px">
<p style="margin:0 0 4px;font-size:15px">${greeting}</p>
<p style="margin:0;font-size:15px;line-height:1.5">${escape(digest.summary)}</p>
${body}
<p style="margin:32px 0 8px"><a href="${escape(input.appUrl)}/agenda" style="display:inline-block;background:#0b6e69;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open the Agenda</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;color:#5b6472;font-size:12px;line-height:1.5;border-top:1px solid #e7e3da">
Sent by your Life Island. <a href="${escape(input.appUrl)}/settings" style="color:#5b6472">Change or stop this email</a> in Settings.
</td></tr>
</table></td></tr></table>
</body></html>`;
}
