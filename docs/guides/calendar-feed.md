# Calendar link

The Agenda can put every date of the island in the calendar app of your phone or computer (Google Calendar, Apple Calendar, Outlook). The calendar app reads a private link and keeps the dates up to date by itself. Nothing is written back: the link is read-only.

## Using it

1. Open the Agenda, **Email & calendar** tab, and choose **Make a private link**.
2. Copy the link. It is shown only this once.
3. Add it to your calendar app as a subscription:
   - Google Calendar on a computer: **Other calendars**, **+**, then **From URL**.
   - Apple Calendar: **File**, then **New Calendar Subscription**. On iPhone: **Settings**, **Calendar**, **Accounts**, then **Add Subscribed Calendar**.
   - Outlook: **Add calendar**, then **Subscribe from web**.

If you lose the link, make a new one. **Make a new link** and **Turn it off** stop the old link at once, everywhere it was added.

The feed covers every Agenda date from 30 days ago to a year ahead: the areas' deadlines, your own items and the Italian calendar. A deadline is an all-day event; your own item with a time is an event at that time. Each event carries its area, amount, detail and a link back to the island. A date you handled stays in the feed, marked ✓. Every event has a stable `UID` (its Agenda key), so a calendar app updates it in place when it changes. Calendar apps re-read the link on their own schedule. Google takes up to a day; the feed asks for every 4 hours.

The island must be reachable from where the calendar app runs. For Google Calendar, that means published on the internet (`APP_URL`, docs/security.md): Google reads the link from its own servers.

## Security

Calendar apps cannot sign in, so the link carries a secret instead. It is the only route of the island that answers without sign-in.

- **The secret**: 256 random bits (`randomBytes(32)`, 43 characters base64url). Only its SHA-256 is stored (`agenda.calendar_feeds`), so the link is shown once and cannot be read back from the database. One link at a time.
- **The route**: `GET /api/agenda/calendar/feed/<secret>.ics`.
  - Only `GET` of exactly that shape is let through. In svc-agenda, `CALENDAR_FEED_PATH` is passed as `openPaths` to `applyHttpSecurity`. At the gateway, a `handle_path /api/agenda/calendar/feed/*` block skips `GATEWAY_AUTH` and answers 404 to anything else.
  - A wrong or old secret answers 404, so it reveals nothing.
  - The per-client rate limit still applies.
- **What it shows**: dates, titles, areas, amounts and details from a month ago to a year ahead. No documents, no tax codes, no bank data. Anyone who has the link sees these, so treat it like a password, and make a new one if it may have leaked.
- **Last read**: the Agenda shows when a calendar last read the link, to the minute. A read you don't expect means the link has leaked: make a new one.

## Routes (svc-agenda)

| Route                             | Sign-in | What it does                                                       |
| --------------------------------- | ------- | ------------------------------------------------------------------ |
| `GET /calendar`                   | yes     | Whether a link is on, since when, and when it was last read        |
| `POST /calendar`                  | yes     | Makes a new link and returns it once; the one before stops working |
| `DELETE /calendar`                | yes     | Turns it off                                                       |
| `GET /calendar/feed/<secret>.ics` | no      | The feed (`text/calendar`); 404 for any other secret               |

## Tests

- `apps/svc-agenda/src/app/calendar/ics.spec.ts`: events, all-day and timed dates, escaping, line folding, and links that stay on the island.
- `libs/be-nest/src/lib/sign-in.spec.ts`: an open path lets through only `GET` of the exact shape.
- `apps/svc-agenda/src/app/agenda.int.spec.ts`: making a link, reading the feed, a wrong secret, a new link stopping the old one, and turning it off. Only the hash is stored.
