# Document storage

Where uploaded documents live, how they are found again, and the table that tracks them. Owned by `svc-ingestion`; the parse worker (`svc-parse-worker`) reads and updates the same table.

## Where the files are

Files never go into the database (architecture principle 12). They live in **S3-compatible object storage**:

| Environment | Storage                                  | Endpoint                       |
| ----------- | ---------------------------------------- | ------------------------------ |
| Local       | SeaweedFS, started by `npm run infra:up` | `http://localhost:8333`        |
| Production  | Cloudflare R2 (or any S3 provider)       | set `S3_ENDPOINT` and the keys |

Everything goes into one bucket (`S3_BUCKET`, default `uploads`), created at startup by `svc-ingestion`. Each file gets a unique **storage key** (its path inside the bucket):

```
<year>/<month>/<upload id>/<cleaned file name>
2026/10/6f1c0a4e-5b7e-4c55-9a43-1f0b8d7e2a10/scontrino-esselunga.jpg
```

- The upload id (a UUID) makes every key unique, so two files with the same name never collide.
- The year/month prefix keeps the bucket browsable and makes lifecycle rules or backups by period easy.
- The cleaned file name at the end makes the bucket readable by a human; the original name, with spaces and accents, is kept in the database and used for downloads.

The key is saved in `ingestion.uploads.storage_key`, next to the id. **The id is how everything else refers to a document; the key is how the service finds its bytes.** Nobody outside `svc-ingestion` ever sees the key.

Locally, SeaweedFS keeps its data in the `storage-data` Docker volume, so files survive `npm run infra:down` and are deleted only by `npm run infra:reset`. To look inside, use any S3 client (e.g. `aws s3 ls s3://uploads --recursive --endpoint-url http://localhost:8333` with the keys from `.env`).

## How a file gets in

The browser sends the file straight to storage; the API only handles metadata, so large files never pass through a service.

1. `POST /api/ingestion/uploads` `{filename, mimeType, sizeBytes, title?, description?}`: checks the type and size, inserts a row with status `UPLOADING`, returns a presigned PUT URL valid for 15 minutes.
2. The browser PUTs the file to that URL (with a progress bar).
3. `POST /api/ingestion/uploads/:id/complete`: reads the stored bytes, detects the real format from the magic bytes (never trusting the browser), computes the SHA-256, and sets the row to `TO_BE_PARSED`. If the same bytes were uploaded before, the copy is dropped and the earlier document is returned (`duplicate: true`).

Rows left in `UPLOADING` for more than an hour (the browser never finished) are marked `FAILED`.

## How a file gets out

| Endpoint                                  | What it does                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/ingestion/uploads`              | Lists documents, newest first. Filters: `status`, `category`; paging: `limit`, `offset`    |
| `GET /api/ingestion/uploads/:id`          | One document's record                                                                      |
| `GET /api/ingestion/uploads/:id/preview`  | Streams the file with `Content-Disposition: inline`, so the browser shows it               |
| `GET /api/ingestion/uploads/:id/download` | Streams the file with `Content-Disposition: attachment` and its original name, so it saves |
| `GET /api/ingestion/uploads/:id/file`     | Redirects to a 5-minute presigned storage link (for other services and quick links)        |

Preview and download are streamed by the service rather than redirected to storage, because SeaweedFS ignores the header overrides a presigned link asks for (the file would download under the cleaned key name, or open instead of saving). Streaming also keeps previews on the app's own origin, so a PDF can sit in a frame. Files are at most 25 MB, so this costs little.

The loader in the documents app lists the records with a **Preview** button (images inline, PDF/text/CSV in a frame, Word and Excel offer the download instead) and a **Download** button.

## Lifecycle

```
UPLOADING ──complete──► TO_BE_PARSED ──daily run──► PARSING ──► PARSED
                              ▲                        │
                              ├── error, with backoff ─┤   (finished steps stay saved)
                              │                        ├── unreadable, or 5th failure ──► FAILED
             PAUSED_QUOTA ◄───┼── AI quota exhausted ──┤
        PAUSED_RATE_LIMIT ◄───┴── rate-limited ────────┘
   (both go back to PARSING by themselves when the pause ends)
```

`UPLOADING` also ends in `FAILED` when the file never arrives or is not a supported format.

A document that is not parsed yet has `parsed_at = null` and `categories = '{}'`. The parse worker runs every day (`PARSE_SCHEDULE`, default 06:00 Europe/Rome), claims ready rows one at a time with `for update skip locked`, and runs three steps on each (CLASSIFY, EXTRACT, DISCOVER). Each step commits its result and its name in `completed_steps` before the next starts, so an interrupted document resumes where it stopped. When all three are done it sets `parsed_at` and `PARSED`. The [documents loader guide](guides/documents-loader.md#parsing-on-a-schedule) explains the steps, the categories and the quota pause.

## The table

`ingestion.uploads` (Drizzle definition in `libs/ingestion-db/src/lib/schema.ts`; migrations in `apps/svc-ingestion/drizzle/`, applied automatically when the service starts). The equivalent SQL, as it stands after every migration:

```sql
create type ingestion.upload_status as enum
  ('UPLOADING', 'TO_BE_PARSED', 'PARSING', 'PARSED', 'FAILED');
create type ingestion.file_format as enum
  ('JPG', 'PNG', 'WEBP', 'PDF', 'XLSX', 'CSV', 'DOCX', 'TXT');

create table ingestion.uploads (
  -- identity and what you typed
  id                uuid primary key default gen_random_uuid(),
  title             varchar(200) not null,
  description       varchar(255),

  -- the file
  original_filename text not null,                 -- as on your device; used for downloads
  declared_mime     text,                          -- what the browser said
  detected_mime     text,                          -- from the bytes; the one we trust
  file_format       ingestion.file_format,
  size_bytes        bigint,
  sha256            char(64),                      -- duplicate detection
  storage_key       text not null,                 -- where the bytes are in the bucket

  -- lifecycle
  status            ingestion.upload_status not null default 'UPLOADING',
  attempts          int not null default 0,        -- parse attempts so far
  next_attempt_at   timestamptz not null default now(),  -- retry backoff
  locked_until      timestamptz,                   -- worker lease, recovers crashed runs
  last_error        text,

  lock_token        uuid,                          -- set on each claim; every worker write checks it
  last_attempt_at   timestamptz,

  -- filled by the parse worker, step by step
  completed_steps   text[] not null default '{}',  -- CLASSIFY, EXTRACT, DISCOVER as each is saved
  current_step      text,                          -- the step running, or the one interrupted
  categories        text[] not null default '{}',  -- ids in document_categories, e.g. {BILL,WATER_BILL,EXPENSE}
  analysis          jsonb,                         -- type, purpose, characteristics, evidence per category
  extracted_fields  jsonb,                         -- fields of the categories' templates, with a status each
  target_key        text,                          -- e.g. 'grocery.receipt@1'
  details           jsonb,                         -- the data for that target, confirmed in the review inbox
  confidence        numeric(3, 2),
  flags             text[] not null default '{}',  -- low_confidence, needs_attention, …

  -- timestamps
  uploaded_at       timestamptz,                   -- file verified in storage
  parsed_at         timestamptz,                   -- null until parsed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index uploads_claim_idx      on ingestion.uploads (status, next_attempt_at);
create index uploads_created_at_idx on ingestion.uploads (created_at);
create index uploads_categories_idx on ingestion.uploads using gin (categories);
create unique index uploads_sha256_idx on ingestion.uploads (sha256);
```

Next to it, `ingestion.parse_runs` keeps one row per AI call (model, tokens, latency, raw output) for cost tracking and evals, and three tables added with the category service:

```sql
create table ingestion.document_categories (
  id            text primary key check (id ~ '^[A-Z][A-Z0-9_]{1,63}$'),  -- WATER_BILL
  title         varchar(100) not null,               -- unique, case-insensitive
  description   text not null,                       -- when to use it; read by the AI
  template_json jsonb not null default '{"fields":[]}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create type ingestion.suggestion_status as enum ('PENDING', 'APPROVED', 'REJECTED');
create table ingestion.category_suggestions (       -- proposed by the AI, approved by you
  id                   uuid primary key default gen_random_uuid(),
  category_id          text not null,                -- the proposed id
  title, description, template_json, reason,
  status               ingestion.suggestion_status not null default 'PENDING',
  upload_ids           uuid[] not null default '{}', -- documents that proposed it
  approved_category_id text,
  reviewed_at, created_at, updated_at
);
create unique index on ingestion.category_suggestions (category_id) where status = 'PENDING';

create table ingestion.parse_queue (                 -- one row: 'documents'
  id text primary key,
  status ingestion.parse_queue_status not null default 'IDLE',  -- RUNNING, PAUSED_QUOTA, PAUSED_RATE_LIMIT, BLOCKED_CREDENTIALS
  pause_reason, provider_error jsonb, paused_at, resume_at, resume_at_reliable boolean, resume_attempts int,
  run_started_at, run_finished_at, next_scheduled_run_at, last_run_summary jsonb, updated_at
);
```

### Why these columns

- **`title` / `description`**: typed at upload; the strongest hint the classifier gets.
- **`detected_mime` vs `declared_mime`**: the browser's claim is kept for debugging, but only the detected type decides how a file is parsed and served.
- **`sha256`**: the same receipt uploaded twice is stored once.
- **`attempts`, `next_attempt_at`, `locked_until`, `last_error`**: let the daily worker retry with backoff, recover a job from a crashed worker, and show why a document failed.
- **`categories` as an array**: one document has several categories (a water bill is `HOME`, `BILL`, `WATER_BILL`, `EXPENSE`). The GIN index makes `?category=WATER_BILL` fast. Arrays cannot have foreign keys, so the worker only ever writes ids that exist in `document_categories`. The module a document's data goes to is decided by `target_key`, not by its categories.
- **`completed_steps` and `lock_token`**: the durable progress of a document. A restart, a pause or another worker never repeats a saved step, and a worker whose lease expired cannot overwrite the one that took over.
- **`uploaded_at` vs `created_at`**: `created_at` is when the row was registered, `uploaded_at` when the file was verified in storage.
