# Documents loader

The documents loader takes any personal document (a receipt photo, a PDF invoice, a spreadsheet), stores it, has AI read and classify it once a day, and lets you check the result and confirm it before it is loaded into the right module.

```
documents app: Loader ──► svc-ingestion ──► object storage
                    │ upload.completed
                    ▼
            svc-parse-worker  (daily, configurable)
                    │ document.parsed: category + details
                    ▼
               svc-review ◄── documents app: Review (list, filter, open details, Confirm)
                    │ record.approved
                    ▼
     svc-groceries / svc-tax730 (planned) load it into their own tables
```

| Project            | Kind                    | Owns                                                            | Local port |
| ------------------ | ----------------------- | --------------------------------------------------------------- | ---------- |
| `documents`        | Angular app             | Start screen, the loader (`/upload`) and the review (`/review`) | 4201       |
| `shell`            | Angular app             | Life Island: the hub for the modules that use the data          | 4200       |
| `svc-ingestion`    | NestJS HTTP service     | Schema `ingestion` (migrations), the uploads bucket             | 3001       |
| `svc-parse-worker` | NestJS app without HTTP | Nothing new: reads and updates `ingestion` on a schedule        | none       |
| `svc-review`       | NestJS HTTP service     | Schema `review`: the inbox read model and the confirm API       | 3002       |
| `design-system`    | Angular library         | CSS tokens and the shared components both apps use              |            |

## Run it

```sh
cp .env.example .env              # once; PARSER=fake works without an API key
npm run infra:up                  # Postgres, SeaweedFS, NATS, Caddy
npx nx serve svc-ingestion        # creates the bucket and applies migrations
npx nx serve svc-review
npx nx serve svc-parse-worker     # with PARSE_RUN_ON_START=true it parses right away
npx nx serve documents            # http://localhost:4201
npx nx serve shell                # http://localhost:4200 (optional: the Life Island hub)
```

Run each `serve` in its own terminal, or `npx nx run-many -t serve -p svc-ingestion svc-review svc-parse-worker documents shell`. The Angular dev servers proxy `/api/ingestion` and `/api/review` to the local services, the same paths the Caddy gateway uses.

Uploads made after the worker's last run wait for the next scheduled one. To parse them now, restart the worker (with `PARSE_RUN_ON_START=true`).

To run the services in Docker instead: `docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build`; they are then reachable through the gateway on `http://localhost:8080/api/...`.

To use the real AI parser, set `ANTHROPIC_API_KEY` and `PARSER=claude` in `.env`.

## Uploading

The documents app opens on a start screen where you pick **Loader** or **Review** (the review card shows how many records wait for you); the top bar switches between them and links to the Life Island app.

The loader accepts files in four ways: drag and drop onto the page, the **Browse files** button, pasting (Ctrl+V / Cmd+V) an image or file, and **Take a photo**, which opens the camera in a popup (on phones without camera access in the browser, it falls back to the native camera picker).

Each file gets a title (from its name, editable) and an optional description (at most 255 characters), then **Upload all** sends them with a progress bar each. Accepted formats are JPG, PNG, WEBP, PDF, XLSX, CSV, DOCX and TXT, up to 25 MB. The service checks the real format from the file's bytes, so a renamed file is rejected; an identical file uploaded twice is recognized and not stored again.

Below the upload area, **Your documents** lists every upload, newest first and paged, with its status, categories (empty until parsed), upload and parse dates, and two buttons: **Preview** opens the file in a popup (images, PDF, text and CSV; Word and Excel offer the download instead) and **Download** saves it under its original name.

The upload is three calls, so the file never passes through the API:

| Call                                       | What happens                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `POST /api/ingestion/uploads`              | Validates name, type and size; creates the row as UPLOADING; returns a presigned PUT URL |
| `PUT <presigned URL>`                      | The browser sends the file straight to storage                                           |
| `POST /api/ingestion/uploads/:id/complete` | Checks size, real format and SHA-256; sets TO_BE_PARSED and emits `upload.completed@1`   |
| `GET /api/ingestion/uploads`               | Documents, newest first, paged; optional `status` and `category` filters                 |
| `GET /api/ingestion/uploads/:id`           | One upload, details included                                                             |
| `GET /api/ingestion/uploads/:id/preview`   | Streams the original file inline, for the browser to show                                |
| `GET /api/ingestion/uploads/:id/download`  | Streams the original file as an attachment, under its original name                      |
| `GET /api/ingestion/uploads/:id/file`      | Redirects to a short-lived presigned URL for the original file                           |

## The data model

Everything about one document is in **one row of `ingestion.uploads`**: the columns you asked for (id, title, description, file format, status, upload date, parse date, categories and the `details` JSON) plus what the system needs to run safely (storage key, real MIME type, SHA-256, size, attempts and lease for the worker, last error, confidence, flags, target key). The full definition is in `libs/ingestion-db/src/lib/schema.ts`; the equivalent SQL, with what each column is for, is in [Document storage](../document-storage.md).

The review service does not read that table: each service owns its schema ([principle 1](../architecture.md#architecture-principles)). It keeps its own copy in `review.staging_records`, filled from the ingestion events, and adds what only review knows: confirmed and loaded dates, the load error, the id of the record the domain created. Both tables describe the same document; each has one owner.

### Statuses

| Upload (`ingestion`)                  | Inbox (`review`)    | Meaning                                                  |
| ------------------------------------- | ------------------- | -------------------------------------------------------- |
| `UPLOADING`                           | not listed yet      | Row created, file on its way to storage                  |
| `TO_BE_PARSED`                        | `UPLOADED`          | File stored and verified, waiting for the next parse run |
| `PARSING`                             | `PARSING`           | The worker is reading it                                 |
| `TO_BE_PARSED` with `completed_steps` | `PARTIALLY_PARSED`  | Some steps saved; the rest runs on the next attempt      |
| `PAUSED_QUOTA`                        | `PAUSED_QUOTA`      | Paused: the AI usage quota is exhausted                  |
| `PAUSED_RATE_LIMIT`                   | `PAUSED_RATE_LIMIT` | Paused: the AI provider rate-limited the worker          |
| `PARSED`                              | `PARSED`            | Categories and details ready; can be confirmed           |
| `FAILED`                              | `PARSE_FAILED`      | Rejected file, or parsing failed after every retry       |
|                                       | `CONFIRMED`         | You confirmed it; `record.approved` sent to the domain   |
|                                       | `LOADED`            | The domain service saved it in its own table             |
|                                       | `LOAD_FAILED`       | The domain refused it; it can be confirmed again         |

A document waiting for the worker is `TO_BE_PARSED`, with `parsed_at` null and `categories` empty; the worker fills both. The inbox calls the same state `UPLOADED`. `LOADING`/`LOADED` are avoided at the start of the flow because `LOADED` means "loaded into its domain table" at the end.

### Where files are stored

Files go to S3-compatible object storage, never into the database: **SeaweedFS** locally (already in the compose stack) and **Cloudflare R2** in production (no egress fees, a free tier that fits a personal archive, S3 API). The row stores the object's `storage_key` (`YYYY/MM/<uploadId>/<filename>`); `GET /uploads/:id/preview` and `/download` stream it back. [Document storage](../document-storage.md) explains the layout and why previews are streamed rather than redirected. Switching to R2, AWS S3 or another S3 store is a change of environment variables only; see [Storage and gateway](storage-and-gateway.md).

## Parsing on a schedule

`svc-parse-worker` runs every day at a set time, and processes the documents that are ready **one at a time**. A document that fails for its own reasons (unreadable, a temporary error) does not stop the others.

| Variable                                              | Default                                                      | Meaning                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `PARSE_SCHEDULE`                                      | `06:00`                                                      | Time of day of the daily run (`HH:MM`), or any cron expression (`0 */6 * * *`)          |
| `PARSE_TIMEZONE`                                      | system time zone                                             | Time zone of the schedule, e.g. `Europe/Rome`                                           |
| `PARSE_RUN_ON_START`                                  | `false`                                                      | Also run once when the worker starts                                                    |
| `PARSE_MAX_ATTEMPTS`                                  | `5`                                                          | Attempts before a document is marked FAILED (pauses do not count)                       |
| `PARSE_LEASE_MINUTES`                                 | `5`                                                          | A claim not renewed for this long (a crashed worker) is taken over                      |
| `PARSE_QUOTA_RETRY_MINUTES`, `…_MAX_MINUTES`          | `360`, `1440`                                                | After a quota error without a reset time: first wait, doubled on each failed check, cap |
| `PARSE_RATE_LIMIT_RETRY_SECONDS`                      | `60`                                                         | Wait after a rate limit that came without a retry time                                  |
| `CATEGORY_AUTO_APPROVE`                               | `false`                                                      | Save suggested categories at once instead of waiting for your approval                  |
| `PARSE_CHUNK_CHARS`                                   | `200000`                                                     | Size of the parts a too-long text is split into                                         |
| `PARSER`                                              | `claude` with a key, else `fake`                             | Which analyzer to use                                                                   |
| `PARSE_CLASSIFY_MODEL`, `…_EXTRACT_…`, `…_DISCOVER_…` | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-sonnet-5-5` | Model of each step                                                                      |
| `FAKE_QUOTA_STEPS`, `FAKE_QUOTA_PERIOD_MINUTES`       | `0` (off), `60`                                              | Fake parser only: simulate a usage quota, to try the pause and resume locally           |

Besides the daily run, the worker wakes up by itself when work becomes due: a pause that ends, a document whose retry delay has passed, or a document left behind by a worker that crashed. Those times are read from the database, so they survive a restart; a worker that was stopped mid-run resumes the run when it starts again.

### How a document is read

Every document goes through three steps. Each step's result is committed, with the step's name in `completed_steps`, before the next one starts. A document picked up again (after a pause, an error or a crash) skips the steps it already has, so no completed AI work is repeated and nothing is duplicated.

1. **Normalize** (no AI): photos are rotated upright, scaled to at most 1600 px and sent as JPEG; PDFs are sent as documents; spreadsheets become markdown tables; Word files become text.
2. **CLASSIFY** (small model): the document's type, purpose, issuer and characteristics; **every existing category** that applies, with the evidence for each; the target its data goes to for review; a confidence. Only category ids that exist are saved.
3. **EXTRACT** (larger model): the fields of the templates of the assigned categories, merged (see below), and the target's details, validated by its Zod schema with one correction round. Saved in `extracted_fields` and `details`.
4. **DISCOVER** (larger model): categories that are missing from the table, **even when existing ones already matched**. Saved as suggestions, never as categories (unless `CATEGORY_AUTO_APPROVE=true`).
5. **Finish:** the document becomes PARSED and `document.parsed@1` goes to the review inbox. Every model call is logged in `ingestion.parse_runs` (tokens, latency, output).

The models are told to answer only from what the document shows. A field the document does not contain is stored as `missing`, never filled in.

The fake parser (`PARSER=fake`) classifies by keywords, reads only totals, dates and currency with regular expressions, suggests a few issuer categories (ENEL, LIDL...) and fills sample target details flagged `fake_parser`. Use it for development and tests.

### Document categories

Categories are rows of `ingestion.document_categories`: an id (`WATER_BILL`), a title, a description that says when it applies (the AI reads it), and a `template_json` listing the fields worth extracting. A document can have many: a water bill is `HOME`, `BILL`, `WATER_BILL`, `EXPENSE` and `ACQUE_VERONESI`. The migration seeds broad ones (EXPENSE, BILL, WATER_BILL, INVOICE, RECEIPT, GROCERIES, HOME, MEDICAL, TAX_DEDUCTIBLE), so a document always gets the broader categories even before specific ones exist.

A template is a list of fields:

```json
{
  "fields": [
    {
      "key": "invoice_number",
      "label": "Invoice number",
      "type": "string",
      "required": true,
      "description": "As printed"
    },
    {
      "key": "supplier_vat_number",
      "label": "Supplier VAT number",
      "type": "string",
      "pattern": "^(IT)?[0-9]{11}$",
      "description": "Partita IVA"
    },
    {
      "key": "total_amount",
      "label": "Total amount",
      "type": "amount",
      "required": true,
      "description": "Total to pay"
    },
    {
      "key": "water_consumption",
      "label": "Water consumption",
      "type": "number",
      "unit": "m3",
      "description": ""
    }
  ]
}
```

Types are `string`, `text`, `number`, `integer`, `amount`, `currency` (ISO 4217), `date` (`YYYY-MM-DD`), `datetime`, `period` (`YYYY-MM-DD/YYYY-MM-DD`), `boolean` and `enum` (with `options`). The schema is `categoryTemplateSchema` in `libs/contracts`.

**Several categories, one set of fields.** Templates share keys for the same meaning (`total_amount`, `issue_date`, `due_date`, `provider`, `currency`). The worker merges the templates of all assigned categories by key, so a `BILL` that is also a `WATER_BILL` is asked for its total once; the stored field lists both categories. If two templates give one key different types, the first wins and the clash is reported in `warnings`.

**Every field gets a status.** `found` (with a normalized value: ISO dates, numbers, upper-case currency), `missing`, `illegible`, `ambiguous` or `conflicting` (with the competing readings in `candidates`), or `invalid` when the value read does not fit the type. Nothing but `found` carries a value; conflicts and invalid values add the `needs_attention` flag and a warning instead of a guess.

**Discovery.** The DISCOVER step sees the existing categories, the pending suggestions and the ids you rejected. The worker then normalizes each proposed id, drops anything that matches an existing category by id or title (also loosely: `BILLS` is `BILL`) or one you rejected, and when it matches a pending suggestion, adds the document to that suggestion instead of creating another. A pending id is unique in the table, so a resumed step or two similar documents never duplicate a suggestion.

**Approval.** Suggestions wait on the **Categories** page of the documents app, with their fields. **Approve** (optionally after editing the id, title, description or template) creates the category and adds it to the documents that suggested it; from the next document on, the AI matches it like any other. **Reject** keeps it from being suggested again.

| Call                                                   | What happens                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /api/ingestion/categories`                        | The categories and their templates                                              |
| `PATCH /api/ingestion/categories/:id`                  | Edit title, description or template                                             |
| `GET /api/ingestion/category-suggestions`              | Suggestions; filters `status`, `uploadId`                                       |
| `POST /api/ingestion/category-suggestions/:id/approve` | Save it as a category (body: optional `id`, `title`, `description`, `template`) |
| `POST /api/ingestion/category-suggestions/:id/reject`  | Reject it                                                                       |
| `GET /api/ingestion/parse-queue`                       | The queue: running, idle or paused, why, and until when                         |

### AI usage quota, rate limits and other errors

The worker sorts every provider error by what can fix it (`parsers/provider-errors.ts`):

| Provider says                                          | Internal status             | What the worker does                                                                                                                                 |
| ------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 402 billing, or a credit balance / usage limit message | `PAUSED_QUOTA`              | Stops sending AI requests, saves everything, pauses the queue until the quota is back (see below)                                                    |
| 429 rate limit                                         | `PAUSED_RATE_LIMIT`         | Pauses until `retry-after` (or the rate-limit reset headers), then continues; the SDK has already retried twice                                      |
| 401, 403, 404 (key, permissions, model)                | `BLOCKED_CREDENTIALS`       | Stops the run without spending attempts; tries again at the next scheduled run or restart                                                            |
| 413, or 400 "prompt is too long" (context window)      | none: the document is split | Splits a text document into parts: classify and discover from the first, extract from all and merge the fields; PDFs and images that do not fit fail |
| other 400, a refusal, an unreadable file               | document `FAILED`           | Fails this document only                                                                                                                             |
| 5xx, 529 overloaded, network                           | document back to the queue  | Retries this document later with backoff (1, 4, 16 min...), keeping its finished steps                                                               |

**When the usage quota runs out**, the document in progress keeps its finished steps and becomes `PAUSED_QUOTA` (it does not use up an attempt), the queue row records the provider's error, the reason and when to try again, and the run stops. No AI request leaves any worker while the pause lasts: the daily run and restarts check the queue first. The worker never switches keys, accounts or providers.

- If the provider's message gives a reset time ("You will regain access on 2026-11-01 at 00:00 UTC"), processing resumes then, and the review UI shows that time.
- Otherwise the worker checks again after `PARSE_QUOTA_RETRY_MINUTES` (6 h), and doubles the wait each time the quota is still exhausted, up to a day. A check is one request: the paused document is processed first and, if it works, the queue is running again. The UI says the resume time is unknown and shows only when the next check is.

To see it locally without an API key: `FAKE_QUOTA_STEPS=7 FAKE_QUOTA_PERIOD_MINUTES=3 PARSE_RUN_ON_START=true npx nx serve svc-parse-worker` pauses after seven AI steps and resumes three minutes later.

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

The review lists every document with its title, description, status (a coloured dot), upload date and parse date. Filter by text, status, category, file format and upload date range; the filters live in the URL, so a filtered view can be bookmarked. Sort by title, upload date or parse date.

Above the list, a banner shows the parse queue when it matters: running, waiting for the next run, paused because the AI usage quota is exhausted (with the provider's reset time when it gave one, or "unknown" otherwise), paused by a rate limit, or stopped because the API key was refused.

Every record has an eye button in the **Details** column. The popup shows the **AI processing** of the document: which steps are done and which remain, why it is paused or partial, the type and purpose, the assigned categories, the extracted fields with their status, and the suggested categories. Then come the target details, laid out by the target schema (receipt items as a table). Only fully parsed records can be confirmed: **Confirm** calls the confirm API; **Cancel** closes it.

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
| Upload row without title, description or results          | Title, description, file format, categories, target key, details, confidence and dates on the row   |
| Upload status `UPLOADED`; presigned GET for previews      | `TO_BE_PARSED`; preview and download streamed by the service (SeaweedFS ignores header overrides)   |
| HEIC, EML and ZIP                                         | Not yet                                                                                             |
