# Documents loader

The documents loader takes any personal document (a receipt photo, a PDF invoice, a spreadsheet), stores it, has AI read and classify it once a day, and lets you check the result and confirm it before it is loaded into the right module.

```
mfe-upload ──► svc-ingestion ──► object storage
                    │ upload.completed
                    ▼
            svc-parse-worker  (daily, configurable)
                    │ document.parsed: category + details
                    ▼
               svc-review ◄── mfe-review: list, filter, open details, Confirm
                    │ record.approved
                    ▼
     svc-groceries / svc-tax730 (planned) load it into their own tables
```

| Project            | Kind                    | Owns                                                      | Local port |
| ------------------ | ----------------------- | --------------------------------------------------------- | ---------- |
| `mfe-upload`       | Angular app             | The upload screen                                         | 4201       |
| `mfe-review`       | Angular app             | The review table and details popup                        | 4202       |
| `svc-ingestion`    | NestJS HTTP service     | Schema `ingestion` (migrations), the uploads bucket       | 3001       |
| `svc-parse-worker` | NestJS app without HTTP | Nothing new: reads and updates `ingestion` on a schedule  | none       |
| `svc-review`       | NestJS HTTP service     | Schema `review`: the inbox read model and the confirm API | 3002       |
| `design-system`    | Angular library         | CSS tokens and the shared components both apps use        |            |

## Run it

```sh
cp .env.example .env              # once; PARSER=fake works without an API key
npm run infra:up                  # Postgres, SeaweedFS, NATS, Caddy
npx nx serve svc-ingestion        # creates the bucket and applies migrations
npx nx serve svc-review
npx nx serve svc-parse-worker     # with PARSE_RUN_ON_START=true it parses right away
npx nx serve mfe-upload           # http://localhost:4201
npx nx serve mfe-review           # http://localhost:4202
```

Run each `serve` in its own terminal, or `npx nx run-many -t serve -p svc-ingestion svc-review svc-parse-worker mfe-upload mfe-review`. The Angular dev servers proxy `/api/ingestion` and `/api/review` to the local services, the same paths the Caddy gateway uses.

Uploads made after the worker's last run wait for the next scheduled one. To parse them now, restart the worker (with `PARSE_RUN_ON_START=true`).

To run the services in Docker instead: `docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build`; they are then reachable through the gateway on `http://localhost:8080/api/...`.

To use the real AI parser, set `ANTHROPIC_API_KEY` and `PARSER=claude` in `.env`.

## Uploading

`mfe-upload` accepts files in four ways: drag and drop onto the page, the **Browse files** button, pasting (Ctrl+V / Cmd+V) an image or file, and **Take a photo**, which opens the camera in a popup (on phones without camera access in the browser, it falls back to the native camera picker).

Each file gets a title (from its name, editable) and an optional description (at most 255 characters), then **Upload all** sends them with a progress bar each. Accepted formats are JPG, PNG, WEBP, PDF, XLSX, CSV, DOCX and TXT, up to 25 MB. The service checks the real format from the file's bytes, so a renamed file is rejected; an identical file uploaded twice is recognized and not stored again.

The upload is three calls, so the file never passes through the API:

| Call                                       | What happens                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `POST /api/ingestion/uploads`              | Validates name, type and size; creates the row as UPLOADING; returns a presigned PUT URL |
| `PUT <presigned URL>`                      | The browser sends the file straight to storage                                           |
| `POST /api/ingestion/uploads/:id/complete` | Checks size, real format and SHA-256; sets UPLOADED and emits `upload.completed@1`       |
| `GET /api/ingestion/uploads`               | Recent uploads, paged, optional `status` filter                                          |
| `GET /api/ingestion/uploads/:id`           | One upload, details included                                                             |
| `GET /api/ingestion/uploads/:id/file`      | Redirects to a short-lived download URL for the original file                            |

## The data model

Everything about one document is in **one row of `ingestion.uploads`**: the columns you asked for (id, title, description, file format, status, upload date, parse date, category and the `details` JSON) plus what the system needs to run safely (storage key, real MIME type, SHA-256, size, attempts and lease for the worker, last error, confidence, flags, target key). The full definition is in `libs/ingestion-db/src/lib/schema.ts`.

The review service does not read that table: each service owns its schema ([principle 1](../architecture.md#architecture-principles)). It keeps its own copy in `review.staging_records`, filled from the ingestion events, and adds what only review knows: confirmed and loaded dates, the load error, the id of the record the domain created. Both tables describe the same document; each has one owner.

### Statuses

| Upload (`ingestion`) | Inbox (`review`) | Meaning                                                  |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `UPLOADING`          | not listed yet   | Row created, file on its way to storage                  |
| `UPLOADED`           | `UPLOADED`       | File stored and verified, waiting for the next parse run |
| `PARSING`            | `PARSING`        | The worker is reading it                                 |
| `PARSED`             | `PARSED`         | Category and details ready; can be confirmed             |
| `FAILED`             | `PARSE_FAILED`   | Rejected file, or parsing failed after every retry       |
|                      | `CONFIRMED`      | You confirmed it; `record.approved` sent to the domain   |
|                      | `LOADED`         | The domain service saved it in its own table             |
|                      | `LOAD_FAILED`    | The domain refused it; it can be confirmed again         |

The names are `UPLOADING`/`UPLOADED` rather than `LOADING`/`LOADED`, because `LOADED` means "loaded into its domain table" at the end of the flow.

### Where files are stored

Files go to S3-compatible object storage, never into the database: **SeaweedFS** locally (already in the compose stack) and **Cloudflare R2** in production (no egress fees, a free tier that fits a personal archive, S3 API). The row stores the object's `storage_key` (`YYYY/MM/<uploadId>/<filename>`); `GET /uploads/:id/file` turns it into a download URL. Switching to R2, AWS S3 or another S3 store is a change of environment variables only; see [Storage and gateway](storage-and-gateway.md).

## Parsing on a schedule

`svc-parse-worker` wakes up on a cron schedule, claims every upload that is ready, and processes them a few at a time.

| Variable                                      | Default                                 | Meaning                                                             |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `PARSE_SCHEDULE`                              | `0 3 * * *`                             | Cron expression: every day at 03:00. `0 */6 * * *` is every 6 hours |
| `PARSE_TIMEZONE`                              | system time zone                        | Time zone of the schedule, e.g. `Europe/Rome`                       |
| `PARSE_RUN_ON_START`                          | `false`                                 | Also run once when the worker starts                                |
| `PARSE_BATCH_SIZE`                            | `10`                                    | Uploads claimed per database round                                  |
| `PARSE_CONCURRENCY`                           | `4`                                     | Documents processed in parallel                                     |
| `PARSE_MAX_ATTEMPTS`                          | `5`                                     | Attempts before an upload is marked FAILED                          |
| `PARSE_LEASE_MINUTES`                         | `5`                                     | After this, a claim held by a crashed worker is taken over          |
| `PARSER`                                      | `claude` with a key, else `fake`        | Which parser to use                                                 |
| `PARSE_CLASSIFY_MODEL`, `PARSE_EXTRACT_MODEL` | `claude-haiku-5-5`, `claude-sonnet-5-5` | Models for the two steps                                            |

A temporary error (rate limit, overload, network) retries the upload at the next run after a growing delay (1, 4, 16, 64 minutes and so on, at most a day). A permanent one (the model declines the document, an unreadable file) fails it at once. Several workers can run side by side; `for update skip locked` keeps them from taking the same upload.

### How a document is read

1. **Normalize:** photos are rotated upright, scaled to at most 1600 px and sent as JPEG; PDFs are sent as documents; spreadsheets become markdown tables; Word files become text.
2. **Classify** with the small model: which target in the catalog fits, a one-line description, the language and a confidence.
3. **Extract** with the larger model, constrained to the target's JSON Schema.
4. **Validate** with the target's Zod schema and its domain rules. If it fails, the model gets one chance to correct itself, with the errors listed.
5. **Save** the details, category and confidence on the upload, log every model call in `ingestion.parse_runs` (tokens, latency, output), and emit `document.parsed@1`. Data that is still invalid is kept and flagged `needs_attention`; a confidence below 0.8 adds `low_confidence`.

The fake parser (`PARSER=fake`) classifies by keywords in the name, title and text and fills sample data that is valid for the target, flagged `fake_parser`. Use it for development and tests.

## Categories and target schemas

Every parsed document gets a **category**, and its details follow a **target schema** that belongs to that category. The schema is versioned, so details stay consistent: every grocery receipt has the same fields.

| Target key           | Category    | Details                                                                                                                                                                                                              | Loaded into (planned)                 |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `grocery.receipt@1`  | `groceries` | Merchant (name, VAT number, address), date and time, currency, total, payment method, and items (name as printed, normalized name, category, quantity, unit price, line total). Line totals must add up to the total | `grocery` schema, `svc-groceries`     |
| `tax730.expense@1`   | `tax730`    | Tax year, expense type (medical, medicines, education...), suggested 730 frame, date, amount, beneficiary fiscal code, traceable payment, issuer, document number                                                    | `tax730` schema, `svc-tax730`         |
| `general.document@1` | `other`     | Document type, issuer, date, amount, currency, summary and key facts                                                                                                                                                 | stays in review until a module exists |

The schemas are in `libs/contracts/src/lib/targets/` and listed in `TARGET_CATALOG`. `GET /api/review/catalog` returns them with their JSON Schemas.

To add a category: add a Zod schema there with a `targetKey` like `<module>.<entity>@1`, add it to `TARGET_CATALOG` and `CATEGORY_LABELS`, and add test cases. The AI parser picks it up from the catalog with no other change, and the review popup shows its fields in schema order. Loading it into its own table is the job of that module's service.

## Reviewing and confirming

`mfe-review` lists every document with its title, description, status (a coloured dot), upload date and parse date. Filter by text, status, category, file format and upload date range; the filters live in the URL, so a filtered view can be bookmarked. Sort by title, upload date or parse date.

Parsed records show an eye button in the **Details** column. It opens a confirmation popup with the category, confidence, flags, a link to the original file and the details laid out by the target schema (receipt items as a table). **Confirm** calls the confirm API; **Cancel** closes it.

| Call                                   | What happens                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/review/records`              | `q`, `status`, `category`, `fileFormat`, `uploadedFrom`, `uploadedTo`, `sort`, `order`, `limit`, `offset` |
| `GET /api/review/records/:id`          | One record with its details and errors                                                                    |
| `POST /api/review/records/:id/confirm` | Sets CONFIRMED and emits `record.approved@1`; 409 if the record is not PARSED or LOAD_FAILED              |
| `GET /api/review/catalog`              | The target catalog                                                                                        |

**Why confirm is a separate API from upload.** Uploading and confirming are different decisions, made at different times (days apart, with the daily schedule), about data owned by different services. Confirm lives in `svc-review`, which owns the review state, and it does not write into any domain table itself: in one transaction it marks the record CONFIRMED and queues `record.approved@1` with the category, target key and details. The service that owns that category's table (groceries, 730) consumes the event, saves the data in its own schema, and answers `record.loaded` or `record.load_failed`, which move the record to LOADED or LOAD_FAILED. Adding a module never changes the confirm API.

## Where this differs from the plan

[architecture.md](../architecture.md) is the plan. The first version of the loader follows it with these differences, which the plan should take on when it is next revised:

| Plan                                                      | Built                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Worker woken by `LISTEN uploads_ready` plus a 30 s poll   | Worker runs on a configurable cron schedule (daily by default), as requested                        |
| `document.extracted`, one per target                      | `document.parsed@1`, one target per document; several targets per document later                    |
| Staging statuses `PENDING_REVIEW`, `APPROVED`, `REJECTED` | `UPLOADED`…`PARSED`, `CONFIRMED`, `LOADED`, `LOAD_FAILED`: the inbox lists documents from upload on |
| `/staging-records` with bulk approve, reject, edit        | `/records` with list, detail and confirm; edit, bulk and reject later                               |
| Domains publish their targets at startup                  | Catalog is static in `libs/contracts` and served by `GET /catalog`                                  |
| Ajv for validation                                        | The targets' Zod schemas, which also hold the domain rules                                          |
| Upload row without title, description or results          | Title, description, file format, category, target key, details, confidence and dates on the row     |
| HEIC, EML and ZIP                                         | Not yet                                                                                             |
| Native Federation shell                                   | Two standalone Angular apps with lazy routes, ready to become remotes                               |
