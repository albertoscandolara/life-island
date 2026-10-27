# Life Island — Architecture & Ingestion Plan

> Source of truth: the Claude doc at https://claude.ai/artifact/Livdq5mvafdV837hERPFQY (exported 2026-10-27).
> When the doc changes, re-export it here so the repository and the doc stay in sync.

Life Island is a personal life-management platform: two Angular apps. The documents app is where you load documents and review what was read from them; the Life Island app, a shell (a 3D island), hosts independent modules, each run by a character that handles one area of life. Every feature in this project follows the rules in this document.

## Vision

You drop any document (receipt photo, PDF, spreadsheet, email) onto the island. A background AI service reads it, decides what it is and where its data belongs, and puts it in an inbox. You review and approve it, and only then does it reach the module that uses it.

| Character             | Module                    | Mission                                                         | Status        |
| --------------------- | ------------------------- | --------------------------------------------------------------- | ------------- |
| Ptera (pterodactyl)   | Review inbox              | Lists AI-extracted records; you edit, approve or reject them    | First release |
| Trice (triceratops)   | Groceries                 | Receipts, items, merchants, spending by category, price history | First release |
| Ankylo (ankylosaurus) | 730 tax return            | Deductible expenses per tax year, totals, export for the CAF    | First release |
| More to come          | Sport, travel, bills, car | Each a new module following the same checklist                  | Later         |

Goals: a project you use every day, practice with modern Angular, micro-frontends, microservices, AI agent workflows, and a portfolio piece with a real wow moment.

## Architecture principles

These rules are non-negotiable. Every new feature, service or module is checked against them.

1. **Each service owns its data.** One Postgres schema per service, accessed with its own database user. No service reads or writes another service's tables, and there are no foreign keys across schemas.
2. **Services talk through APIs or events only.** Synchronous reads go through HTTP APIs; state changes travel as events on NATS JetStream.
3. **Every event leaves through a transactional outbox.** The database change and the outbox row are written in the same transaction, so a change and its event can never disagree.
4. **Every consumer is idempotent.** It records processed event ids (`processed_events`), and domain rows carry a unique `source_staging_id`, so a redelivered event never creates duplicates.
5. **Deploy independently.** Each app has its own Dockerfile, version, migrations and deployment. A monorepo is fine; a monolith is not.
6. **No cross-imports between apps.** Nx module-boundary lint rules enforce it. Shared code lives only in `libs/`.
7. **Contracts first.** Events, AI target schemas and DTOs are Zod schemas in `libs/contracts`, versioned (`grocery.receipt@1`). FE API clients are generated from OpenAPI.
8. **The AI never writes domain data directly.** It writes to staging; a human approves; the domain service loads it.
9. **The AI never reads raw tables.** It reads the target catalog each domain service publishes.
10. **One design system.** Apps use only semantic CSS tokens; raw colours and spacing are blocked by Stylelint.
11. **3D only where it adds meaning.** The island hub, character avatars and one data-flow animation. Everything else is clean 2D.
12. **Files never go into the database.** They live in S3-compatible storage; the database keeps metadata only.

## Big picture and tech stack

```
Each service owns one schema; events flow through NATS

┌─ Documents app ──────┐ ┌──── Life Island app · the shell hosts module remotes ─────────────────┐
│ [Loader + Review]    │ │ [Shell (host): 3D hub, routing] [mfe-groceries: Trice] [mfe-tax730: Ankylo] │
│  Ptera · standalone  │ └────────────────────────────────┬──────────────────────────────────────┘
└───────┬──────────────┘                                  │
        │ direct upload (presigned)                             │ /api/*
 ┌──────▼─────────┐                                    ┌────────▼────────┐
 │ Object storage │                                    │ Gateway (Caddy) │
 └──────┬─────────┘                                    └────────┬────────┘
        │ reads files              ┌───────────────┬────────────┼──────────────┐
 ┌──────▼───────┐          ┌───────▼─────┐  ┌──────▼──────┐ ┌───▼───────┐ ┌────▼──────┐
 │ parse worker │          │ ingestion   │  │ review      │ │ groceries │ │ tax730    │
 │ AI, no HTTP  │          │ upload API  │  │ catalog,    │ │ Trice     │ │ Ankylo    │
 └──────┬───────┘          └──────┬──────┘  │ staging     │ │ domain    │ │ domain    │
        │                         │         └──────┬──────┘ └───┬───────┘ └────┬──────┘
 ┌──────▼─────────────────────────▼────────────────▼────────────▼──────────────▼──────┐
 │ PostgreSQL:   [ingestion schema]            [review]       [grocery]     [tax730]  │
 └──────────────────────┬─────────────────────────┬──────────────┬─────────────┬──────┘
 ┌──────────────────────▼─────────────────────────▼──────────────▼─────────────▼──────┐
 │ NATS JetStream · events published from every schema outbox                         │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

The browser uploads files straight to storage and calls services only through the gateway; each service writes only its own schema, and its outbox relay publishes events to NATS.

| Concern            | Choice                                                                                     | Why                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Monorepo           | Nx                                                                                         | Builds only what changed, enforces module boundaries, Angular and Nest generators             |
| Frontend           | Angular (latest, v21+): zoneless, signals, standalone, Signal Forms                        | The main learning goal                                                                        |
| Micro-frontends    | Native Federation (`@angular-architects/native-federation`)                                | Angular standard with esbuild; remotes load at runtime from a manifest, so each deploys alone |
| Backend            | NestJS (TypeScript everywhere)                                                             | Shared types and contracts with the FE                                                        |
| Database           | PostgreSQL (pgvector image), one schema and one DB user per service                        | Your own DB with a real service boundary, one instance to run and back up                     |
| ORM and migrations | Drizzle ORM + drizzle-kit                                                                  | Close to SQL; migrations per service                                                          |
| File storage       | S3-compatible: SeaweedFS or Garage locally, Cloudflare R2 in production                    | Files out of the DB, presigned uploads                                                        |
| Messaging          | NATS JetStream + transactional outbox                                                      | Lightweight, durable, exactly-once effect with idempotent consumers                           |
| AI                 | Claude API: Haiku 5.5 to classify, Sonnet 5.5 to extract, structured outputs (JSON Schema) | Cheap where possible, accurate where needed, guaranteed JSON shape                            |
| Contracts          | Zod in `libs/contracts`, converted to JSON Schema and OpenAPI; FE clients via orval        | One source of truth                                                                           |
| Gateway            | Caddy                                                                                      | One origin for the FE, automatic HTTPS                                                        |
| Observability      | OpenTelemetry + Langfuse                                                                   | Trace one upload end to end; AI prompts, costs and evals                                      |

## Repository layout

One Nx monorepo named `life-island`, with independently built and deployed apps.

```
life-island/
├── apps/
│   ├── documents/             # Angular app: start screen, loader, Ptera's review inbox
│   ├── shell/                 # Angular host + 3D island hub (Life Island app)
│   ├── mfe-groceries/         # Angular remote of the shell — Trice
│   ├── mfe-tax730/            # Angular remote of the shell — Ankylo
│   ├── svc-ingestion/         # Nest: upload API
│   ├── svc-parse-worker/      # Nest standalone app (no HTTP): background AI processor
│   ├── svc-review/            # Nest: target catalog, staging, approvals
│   ├── svc-groceries/         # Nest: grocery domain
│   └── svc-tax730/            # Nest: 730 domain
├── libs/
│   ├── design-system/         # tokens (CSS vars) + Angular components + Storybook
│   ├── contracts/             # Zod: events, target schemas, DTOs
│   ├── be-common/             # db factory, outbox relay, NATS client, consumer helper, logger
│   └── fe-common/             # auth, interceptors, event bus, generated API clients
├── infra/
│   ├── docker-compose.yml
│   ├── postgres/init/01-schemas-and-roles.sql
│   └── caddy/Caddyfile
└── tools/evals/               # golden documents + expected JSON
```

Naming: Angular remotes are `mfe-<module>`, Nest services `svc-<module>`. Nx tags: `type:app | type:lib`, `scope:<module> | scope:shared`. Lint fails if an app imports from another app, or a `scope:groceries` lib from `scope:tax730`.

## Database

One PostgreSQL instance in Docker, one schema per service, each service connecting with its own login role, so it physically cannot read other services' tables.

```sql
-- infra/postgres/init/01-schemas-and-roles.sql
create role ingestion_svc login password 'dev_ingestion';
create schema ingestion authorization ingestion_svc;

create role review_svc login password 'dev_review';
create schema review authorization review_svc;

create role grocery_svc login password 'dev_grocery';
create schema grocery authorization grocery_svc;

create role tax730_svc login password 'dev_tax730';
create schema tax730 authorization tax730_svc;

revoke all on schema public from public;
```

Every schema also gets the shared outbox and idempotency tables:

```sql
create table <schema>.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create table <schema>.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
```

| Lifecycle  | How                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Local      | Docker volume; inspect with DBeaver or pgAdmin                                                                           |
| Migrations | Each service has its own `drizzle/` folder, run by `drizzle-kit migrate` at startup or in CI; only its schema is touched |
| Backups    | Nightly `pg_dump` container uploading to object storage; test a restore once                                             |
| Production | Small VPS (e.g. Hetzner) with the same compose file, or managed Postgres (Neon) later; only connection strings change    |
| Secrets    | `.env` locally (git-ignored), the platform secret manager in production                                                  |

## Design system

All visual consistency comes from three tiers of CSS custom properties in `libs/design-system`: primitives (raw values), semantic tokens (what components use), and character themes (re-tint the accent per module).

```css
/* primitives.css — raw values, never used directly by apps */
:root {
  --jungle-500: #2f8f5b;
  --sand-50: #fbf7ef;
  --sand-900: #2b241a;
  --lava-500: #e2553f;
  --sky-400: #5aa9e6;
  --leaf-400: #7cc36b;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-display: 'Fredoka', sans-serif;
}
/* semantic.css — what components use */
:root {
  --surface-page: var(--sand-50);
  --surface-card: #fff;
  --text-primary: var(--sand-900);
  --accent: var(--jungle-500);
  --accent-contrast: #fff;
  --danger: var(--lava-500);
}
:root[data-theme='dark'] {
  --surface-page: #14110c;
  --surface-card: #1f1a13;
  --text-primary: #f3ece0;
}
/* character themes */
[data-character='trice'] {
  --accent: var(--leaf-400);
} /* groceries */
[data-character='ankylo'] {
  --accent: #c08a3e;
} /* 730 */
[data-character='ptera'] {
  --accent: var(--sky-400);
} /* review inbox */
```

- Components use only semantic tokens. Stylelint blocks raw hex colours and px spacing in apps.
- Optional: keep tokens in JSON and generate the CSS with Style Dictionary.
- Base components: standalone Angular on Angular CDK / Angular Aria for accessibility: `ui-button`, `ui-card`, `ui-badge`, `ui-table` (selection, sorting), `ui-dropzone`, `ui-dialog`, `ui-toast`, `ui-empty-state`, `ui-character-header`.
- Storybook documents every component in light, dark and every character theme.
- A new module adds only a `[data-character]` block; it never defines new primitives locally.

## Front-end apps and micro-frontends

The front end is two Angular apps, built and deployed separately and served on one origin by the gateway. The documents app (under /documents/) handles documents only: a start screen to choose the loader or the review, then each screen. The Life Island app (at /) is for using the data: its shell is a Native Federation host, and every domain module is a remote that exposes a routes file and can also run standalone on its own port. The two apps link to each other and share only libs (design system, contracts).

```ts
// shell routes
{ path: 'groceries', loadChildren: () =>
    loadRemoteModule('mfe-groceries', './routes').then(m => m.ROUTES) }
```

- **Runtime manifest:** `shell/public/federation.manifest.json` maps remote names to URLs and is swapped per environment, so a remote redeploys without rebuilding the shell.
- **Shared singletons:** Angular, RxJS and the design system. The shell loads the token CSS once; remotes import it themselves only in standalone mode.
- **Shell responsibilities:** the island hub, routing, auth, a link to the documents app, toasts, theme switch.
- **Communication:** URL first (`/review?upload=…`); cross-module notifications through a typed `window` CustomEvent bus in `fe-common`; no shared global store.
- **Data:** a remote talks only to its own service through the gateway (`/api/<service>`), with clients generated from OpenAPI.

## Ingestion pipeline

A document goes through four owners: the ingestion service stores it, the parse worker extracts it with AI, the review service holds it for your approval, and the domain service loads it.

```
Nothing reaches a domain table until you approve it

           NOTIFY           document.extracted                     record.approved
┌───────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────┐   ┌────────────────┐
│ Upload    │──►│ Parse worker │──►│ Staging        │──►│ YOU REVIEW   │──►│ Domain load    │
│ UPLOADING │   │ PARSING      │   │ PENDING_REVIEW │   │ APPROVED     │   │ LOADED         │
│ UPLOADED  │   │ PARSED       │   │ one per target │   │ or REJECTED  │   │ grocery,tax730 │
└───────────┘   └──────┬───────┘   └────────────────┘   └──────▲───────┘   └───────┬────────┘
                       │ errors, with backoff                  │ retry             │ business error
                ┌──────▼───────────┐                           │           ┌───────▼────────┐
                │ FAILED           │                           └───────────│ LOAD_FAILED    │
                │ after 5 attempts │                                       │ shown in inbox │
                └──────────────────┘                                       └────────────────┘
```

Each arrow is an event or a NOTIFY, never a direct write into another schema; `record.loaded` flows back to set the staging record to LOADED.

### Upload registry (schema `ingestion`)

```sql
create type ingestion.upload_status as enum
  ('UPLOADING','UPLOADED','PARSING','PARSED','FAILED');

create table ingestion.uploads (
  id                uuid primary key default gen_random_uuid(),
  original_filename text not null,
  declared_mime     text,
  detected_mime     text,                 -- from magic bytes, never trusted from the client
  size_bytes        bigint,
  sha256            char(64),
  storage_key       text not null,
  status            ingestion.upload_status not null default 'UPLOADING',
  attempts          int not null default 0,
  next_attempt_at   timestamptz not null default now(),   -- retry backoff
  locked_until      timestamptz,                         -- worker lease
  last_error        text,
  parent_upload_id  uuid references ingestion.uploads(id), -- ZIP / email attachments
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on ingestion.uploads (status, next_attempt_at);
create unique index on ingestion.uploads (sha256) where sha256 is not null;
```

### Upload flow (presigned URLs, files never pass through the API)

1. `POST /api/ingestion/uploads` with `{filename, mime, size}`: validate type and size, insert a row as UPLOADING, return `{uploadId, presignedPutUrl}`.
2. The browser PUTs the file directly to storage, with a progress bar.
3. `POST /api/ingestion/uploads/:id/complete`: read the object head, detect the real MIME type (`file-type`), compute SHA-256 (a duplicate returns the existing upload), set UPLOADED, `NOTIFY uploads_ready`.
4. `GET /api/ingestion/uploads?status=…` and `GET /api/ingestion/uploads/:id/file` (presigned GET for previews).
5. A cleanup job marks rows stuck in UPLOADING for more than 1 hour as FAILED.

Accepted formats: JPG, PNG, WEBP, HEIC, PDF (digital or scanned), DOCX, XLSX, CSV, EML, ZIP. EML and ZIP are unpacked into child uploads. On mobile, `<input capture="environment">` opens the camera.

### Parse worker: claim loop

```sql
update ingestion.uploads
set status = 'PARSING',
    locked_until = now() + interval '5 minutes',
    attempts = attempts + 1,
    updated_at = now()
where id in (
  select id from ingestion.uploads
  where (status = 'UPLOADED' and next_attempt_at <= now())
     or (status = 'PARSING'  and locked_until < now())      -- recover crashed jobs
  order by created_at
  limit $1
  for update skip locked                                     -- workers never grab the same row
)
returning *;
```

- Wake-up: `LISTEN uploads_ready` for instant pickup, plus a 30-second fallback poll.
- Parallelism: `p-limit(4)` per worker; scale to N worker containers safely thanks to `SKIP LOCKED`.
- Lease heartbeat extends `locked_until` during long jobs.
- Failure: store `last_error`, set `next_attempt_at = now() + backoff(attempts)`, back to UPLOADED; after 5 attempts, FAILED.
- Graceful shutdown on SIGTERM: stop claiming, finish jobs in progress.

### Normalization

| Input                | Processing                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| JPG, PNG, WEBP, HEIC | `sharp`: EXIF auto-rotate, HEIC to JPEG, long side at most ~1600 px, light contrast boost |
| PDF                  | Sent to the model as a native PDF document (text and scans)                               |
| DOCX                 | `mammoth` to text                                                                         |
| XLSX, CSV            | `exceljs` / `papaparse` to a markdown table                                               |
| EML, ZIP             | Unpacked into child uploads; the parent becomes PARSED with no records                    |

### AI extraction workflow

Start as a workflow with fixed steps; evolve to an agent with tools only after evals prove it is better.

1. **Classify** (Haiku 5.5): content + catalog summary (target keys and descriptions) returns `{category, title, description, language, targets[], confidence}`. One document can feed several targets: a pharmacy receipt with your codice fiscale goes to `grocery.receipt@1` and `tax730.expense@1`.
2. **Extract** (Sonnet 5.5): one call per target, with that target's JSON Schema as structured output. Instructions and catalog sit in a cached system prompt.
3. **Validate**: Ajv against the schema, plus domain rules: line totals add up to the total (±0.05), no future dates, valid codice fiscale checksum, plausible tax year.
4. **Self-correct**: on failure, one retry that tells the model its errors.
5. **Enrich**: flags `possible_duplicate` (same merchant, date, total, via the domain API), `low_confidence` (below 0.8), `needs_attention` (still invalid; it still goes to review, never lost).
6. **Persist**: in one transaction, write `parse_runs`, one outbox event `document.extracted` per target, and set the upload to PARSED. A 429 or overloaded response counts as a retry, respecting `retry-after`.

```sql
create table ingestion.parse_runs (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references ingestion.uploads(id),
  step text not null,                 -- classify | extract | correct
  model text not null, prompt_version text not null,
  input_tokens int, output_tokens int, latency_ms int,
  raw_output jsonb, error text,
  created_at timestamptz not null default now()
);
```

### Evals

`tools/evals/` holds 20–30 anonymized documents with expected JSON. A script scores per-field accuracy, category accuracy and cost per document, and runs in CI whenever `prompt_version` changes. Later, compare an agent version (tools: `search_merchants`, `find_similar_records`, `get_target_schema`, `ask_user`) against the workflow on the same evals.

## Target catalog and review inbox

The AI learns where data can go from a catalog that each domain service publishes, never from raw tables; you approve every record before it reaches a domain.

### Target catalog

Targets are versioned Zod schemas in `libs/contracts`:

```ts
// grocery.receipt@1
export const GroceryReceiptV1 = z.object({
  merchant: z.object({
    name: z.string(),
    vatNumber: z.string().optional(),
    address: z.string().optional(),
  }),
  purchasedAt: z.string().datetime(),
  currency: z.string().default('EUR'),
  total: z.number(),
  paymentMethod: z.enum(['cash', 'card', 'other']).optional(),
  items: z.array(
    z.object({
      rawName: z.string(),
      normalizedName: z.string(),
      category: z.enum([
        'produce',
        'dairy',
        'meat',
        'fish',
        'bakery',
        'pantry',
        'beverages',
        'household',
        'personal_care',
        'pharmacy',
        'other',
      ]),
      quantity: z.number(),
      unitPrice: z.number().optional(),
      lineTotal: z.number(),
    }),
  ),
});

// tax730.expense@1
export const Tax730ExpenseV1 = z.object({
  taxYear: z.number(),
  expenseType: z.enum([
    'medical',
    'medicines',
    'medical_devices',
    'veterinary',
    'education',
    'sport_kids',
    'mortgage_interest',
    'insurance',
    'renovation',
    'other',
  ]),
  frame730: z.string().optional(), // suggested section/row, e.g. "E1" — always reviewed
  date: z.string(),
  amount: z.number(),
  beneficiaryFiscalCode: z.string().optional(),
  traceablePayment: z.boolean().optional(),
  issuer: z.string(),
  documentNumber: z.string().optional(),
});
```

On startup each domain service publishes `catalog.target.registered` `{targetKey, version, description, category, jsonSchema, examples}`. The review service stores it in `review.target_catalog`; the worker reads it via `GET /api/review/catalog`. A new module that registers its targets starts receiving documents with no worker change.

### Staging table (schema `review`)

```sql
create type review.staging_status as enum
  ('PENDING_REVIEW','APPROVED','REJECTED','LOADED','LOAD_FAILED');

create table review.staging_records (
  id               uuid primary key default gen_random_uuid(),
  upload_id        uuid not null,              -- reference by id only, no cross-schema FK
  target_key       text not null,              -- 'grocery.receipt@1'
  category         text not null,
  title            text not null,
  description      text,
  ai_payload       jsonb not null,             -- what the model produced, never modified
  reviewed_payload jsonb,                      -- your edits
  confidence       numeric(3,2),
  flags            text[] not null default '{}',
  status           review.staging_status not null default 'PENDING_REVIEW',
  domain_record_id uuid,
  load_error       text,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index on review.staging_records (status, category);
```

Keeping `ai_payload` and `reviewed_payload` apart turns every correction into free eval data.

### Review API

| Endpoint                                                          | Purpose                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /staging-records?status=&category=&targetKey=&flag=&cursor=` | Inbox list, cursor pagination                                |
| `GET /staging-records/:id`                                        | Detail with a presigned preview of the original file         |
| `PATCH /staging-records/:id`                                      | Save `reviewed_payload`, validated against the target schema |
| `POST /staging-records/approve` `{ids}`                           | Approve one, a selection, or many                            |
| `POST /staging-records/approve-all`                               | Approve by filter, e.g. confidence ≥ 0.9 and no flags        |
| `POST /staging-records/reject` `{ids, reason}`                    | Reject                                                       |
| `POST /staging-records/:id/retarget`                              | Change target and request re-extraction                      |
| `POST /staging-records/:id/retry-load`                            | Retry a LOAD_FAILED record                                   |

Approve is an intent, not a write: one transaction sets APPROVED and adds an outbox row `record.approved` `{stagingId, targetKey, payload: reviewed ?? ai}`. The review service never writes into domain tables.

## Loading into domain services

Each domain service consumes `record.approved` for its own target keys and reports back with `record.loaded` or `record.load_failed`.

1. `svc-groceries` subscribes to `grocery.receipt@*`. In one transaction: upsert the merchant, insert the receipt and items with a unique `source_staging_id`, add outbox `record.loaded` `{stagingId, domainRecordId}`.
2. `svc-tax730` does the same for `tax730.expense@*`.
3. A business error emits `record.load_failed` `{stagingId, error}`; the review service sets LOAD_FAILED and the UI shows a retry button.
4. The review service consumes `record.loaded` and sets LOADED plus `domain_record_id`.
5. Versioning: when `grocery.receipt@2` arrives, the domain registers v2 and keeps accepting v1 (upcasting in the consumer) until no v1 records remain in staging.

Initial domain tables: `grocery.merchants`, `grocery.receipts`, `grocery.receipt_items`, `tax730.tax_years`, `tax730.expenses`.

## Front-end modules and 3D

Modules are clean 2D screens on the design system; 3D appears in exactly three places.

### Modules

- **documents app (Ptera):** a start screen to choose Loader or Review; the loader (camera, drag and drop, browse, paste, progress per file); the review inbox grouped by upload; filter chips for category, target, flags, confidence; split view with the original file (zoomable image or PDF) beside an editable form generated from the target's JSON Schema with Signal Forms; diff badge on edited fields; checkboxes for approve selected, approve all high-confidence, reject; keys `j`/`k` move, `a` approve, `r` reject, `e` edit, `x` select; optimistic UI with signals; live status over SSE.
- **mfe-groceries (Trice):** receipts list and detail, spending by category per month, top items, price history per item.
- **mfe-tax730 (Ankylo):** tax-year selector, deductible expenses by type, running totals against thresholds, warnings for missing data (e.g. non-traceable payment), CSV/PDF export for the CAF, a note to verify with a professional.

### 3D rules

1. **Island hub in the shell:** low-poly island (angular-three), one zone per character; hover highlights, click flies the camera in, then routes to the module.
2. **Character avatars:** small animated models in each module header, or pre-rendered sprites when performance matters.
3. **One data-flow animation:** on approval, an item flies from Ptera's inbox to the target character's zone.

Three.js is lazy-loaded with `@defer`; `prefers-reduced-motion` gets a 2D hub; models are Draco/meshopt GLTF, about 1 MB each at most.

## Roadmap

Ten weeks to the first full loop; the 3D island comes last, once the data flow works.

1. **Week 1 — Foundations:** Nx workspace, Docker Compose (Postgres, storage, NATS, Caddy), schemas and roles, outbox library, CI with `nx affected`. Done when each service user sees only its own schema.
2. **Week 2 — Design system and shell:** tokens, base components, Storybook; the documents app with its start screen; the Native Federation shell with two empty remotes and a 2D hub. Done when character themes apply and each remote also runs standalone.
3. **Week 3 — Uploads:** registry table, presigned flow, global drop zone. Done when 10 mixed files land in storage as UPLOADED with correct MIME and hash.
4. **Week 4 — Catalog and worker:** domain services register targets; claim loop with a fake extractor. Done when a killed worker's job is recovered and a corrupt file ends FAILED with a readable error.
5. **Weeks 5–6 — AI pipeline:** classify, extract, validate, self-correct, enrich, persist, evals. Done when a real receipt becomes a correct record in under ~15 s and evals pass.
6. **Week 7 — Review and loading:** staging, approval API, domain consumers. Done when 20 bulk-approved records reach LOADED across two services with no duplicates on replay.
7. **Weeks 8–9 — Module UIs:** review, groceries, 730.
8. **Week 10 — 3D island.**
9. **Ongoing — Hardening:** OIDC (Keycloak or Zitadel) at the gateway; never log payloads; encrypted backups; HTTPS; optional codice fiscale redaction before AI calls; OpenTelemetry trace per upload; status dashboard; VPS deploy.

First demo: photograph a pharmacy receipt, see two records in Ptera's inbox (groceries and 730), approve both with one key, then see them in Trice's spending and Ankylo's deductible total.

## New feature checklist

Every new module (sport, travel, bills) or feature goes through this list before it is called done.

- [ ] A character and a `[data-character]` accent token; no new primitives
- [ ] `apps/svc-<module>` with its own schema, DB role, Drizzle migrations, outbox and `processed_events`
- [ ] Target schemas in `libs/contracts` as versioned Zod (`<module>.<entity>@1`), registered in the catalog on startup
- [ ] Consumer for `record.approved` on its target keys, idempotent via a unique `source_staging_id`, replying `record.loaded` / `record.load_failed`
- [ ] OpenAPI published; FE client generated with orval
- [ ] `apps/mfe-<module>` remote exposing `./routes`, added to the federation manifest, runnable standalone
- [ ] Only design-system components and semantic tokens; Stylelint passes
- [ ] Nx tags set; no imports from other apps
- [ ] Eval documents added in `tools/evals/` for its targets
- [ ] Own Dockerfile and CI job; deploys independently
- [ ] 3D only if it fits the three 3D rules
- [ ] This document updated (vision table, layout, roadmap)
