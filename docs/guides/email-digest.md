# Email digest

The Agenda can email you what is overdue, what is coming and what waits for you in every area, every day, week or month. Each line links to the page where it is handled. The digest is written by Life Island's own rules, with no AI.

## Turning it on

1. Add an email to the person who should get it: People, their page, **Edit**, then **Email**.
2. In Settings, open **App settings** and find **Email digest**. Choose **How often**, pick the person under **Send it to**, and set the time. Then set the weekday for a weekly digest, or the day of the month for a monthly one.
3. Open the Agenda's **Email & calendar** tab. It says when the next digest goes and to whom, or what is in the way and where to fix it. You can preview the digest there and send a test now.

| How often   | Looks ahead | Sent                                      |
| ----------- | ----------- | ----------------------------------------- |
| Every day   | 3 days      | every day at the time set                 |
| Every week  | 7 days      | on the weekday set, at the time set       |
| Every month | 31 days     | on the day set (1 to 28), at the time set |

Overdue dates and the undated things that wait for you (a document to approve, a check-in) are always in it. When there is nothing to say, no email is sent, and the Agenda lists that period as "Nothing to say, not sent".

## Email server

svc-agenda sends through the SMTP server in `SMTP_URL`. When `SMTP_URL` is unset, no email is sent and the Agenda says so.

| Variable    | Default                          | What it is                                                                                                                        |
| ----------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_URL`  | unset                            | `smtp://localhost:1025` for Mailpit; `smtps://user:password@smtp.example.com:465` for real email (write `@` in the user as `%40`) |
| `MAIL_FROM` | `Life Island <island@localhost>` | The sender                                                                                                                        |
| `APP_URL`   | `http://localhost:8080`          | The island's address, used for the links in the email                                                                             |

`npm run infra:up` starts Mailpit, which catches every email and shows it at http://localhost:8025, so nothing leaves your machine while you develop. The containers of `--profile apps` send to Mailpit unless `SMTP_URL_CONTAINERS` names another server. They cannot use `.env`'s `SMTP_URL`, because it points at localhost.

## How it is sent

- The settings live in svc-settings (group "Email digest" in `APP_SETTINGS`, libs/contracts `digest.ts`). svc-agenda reads them from its settings replica.
- The person and their email come from People (`GET /people`, `PersonSummaryDto.email`). svc-agenda never stores the address, except on the record of a send.
- Once a minute, svc-agenda works out the latest period that is due (`dueDigestSlot`). It claims the period by inserting its row in `agenda.digest_sends`: `daily:2026-11-18`, `weekly:2026-11-16` or `monthly:2026-11`. Each period is sent once, even when two instances run.
- If a send fails, it is tried again after 15 minutes, 3 times at most. A digest missed by more than a day, because the service was down, is skipped, and the next period's digest goes out as usual. A digest that came due before you turned the digest on, or before you last changed its schedule, is not sent either. Turning it on in the afternoon does not send that morning's digest.
- The digest has a text part and an HTML part. Every value in the HTML is escaped, and only links to the island's own pages are made.

## Routes (svc-agenda)

| Route                 | What it does                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `GET /digest`         | The settings in words, the person picked, what is in the way, the next send, the last sends |
| `GET /digest/preview` | The digest as it would go now (a weekly one while the digest is off)                        |
| `POST /digest/test`   | Sends it now to the person picked; 422 says what is missing                                 |

## Tests

- `libs/contracts/src/lib/digest.spec.ts`: reading the settings, the schedule in the island's time zone, and which period is due.
- `apps/svc-agenda/src/app/digest/digest.spec.ts`: the content, the horizons, escaping, and links that stay on the island.
- `apps/svc-agenda/src/app/agenda.int.spec.ts`: the routes over HTTP with a fake People and a fake mailer. It also checks that a period is sent once and that a failed send is retried later.
