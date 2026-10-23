# Database

There is one PostgreSQL instance and one database, `life_island`. Inside it, each service has its own **schema** and its own **login role**. A role owns its schema and has no access to anything else, so a service physically cannot read another service's tables. This is architecture principle 1: each service owns its data.

## Schemas and roles

| Service                            | Schema      | Role            | Dev password    | Connection string (local)                                           |
| ---------------------------------- | ----------- | --------------- | --------------- | ------------------------------------------------------------------- |
| svc-ingestion and svc-parse-worker | `ingestion` | `ingestion_svc` | `dev_ingestion` | `postgres://ingestion_svc:dev_ingestion@localhost:5432/life_island` |
| svc-review                         | `review`    | `review_svc`    | `dev_review`    | `postgres://review_svc:dev_review@localhost:5432/life_island`       |
| svc-groceries                      | `grocery`   | `grocery_svc`   | `dev_grocery`   | `postgres://grocery_svc:dev_grocery@localhost:5432/life_island`     |
| svc-tax730                         | `tax730`    | `tax730_svc`    | `dev_tax730`    | `postgres://tax730_svc:dev_tax730@localhost:5432/life_island`       |

The `postgres` superuser is for admin work only (running init scripts, the isolation check, inspecting data). Services never use it.

## What the init scripts do

Postgres runs the files mounted into `/docker-entrypoint-initdb.d/` in name order, once, when its data volume is created.

### `01-schemas-and-roles.sql`

1. `revoke all on schema public from public` and `revoke all on database life_island from public`: by default every role could create tables in `public` and connect to the database; this removes both.
2. Creates the four login roles.
3. `grant connect on database life_island` to those four roles only.
4. Creates each schema with `authorization <role>`, so the role **owns** it. An owner has every privilege on its schema and nobody else has any.
5. `alter role <role> set search_path = <schema>`, so unqualified table names resolve to the service's own schema.

### `02-outbox.sql`

Creates, in every service schema, the two tables the [event system](events-and-outbox.md) relies on:

```sql
create table <schema>.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,          -- versioned contract name, e.g. grocery.receipt@1
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz             -- null until the relay has published it
);
create index outbox_unpublished_idx on <schema>.outbox (created_at) where published_at is null;

create table <schema>.processed_events (
  event_id     uuid primary key,       -- id of every event this service has handled
  processed_at timestamptz not null default now()
);
```

The tables are created with `set local role <service role>`, so the service role owns them and needs no grants. The partial index keeps the relay's "find unpublished rows" query fast however large the outbox grows.

## The isolation check

`03-check-isolation.sql` proves the Week 1 "done" rule. It is mounted outside the init folder and run on demand:

```sh
npm run db:check-isolation
```

For every role and every schema it checks, using `has_schema_privilege` and `has_table_privilege`, that:

- the role can use its own schema and insert into its own `outbox`;
- the role has neither `USAGE` nor `CREATE` on any other service's schema;
- the role cannot create objects in `public`.

The first violation raises an exception and the command exits non-zero. On success it prints `isolation ok: 4 roles, each limited to its own schema`. CI runs it on every push.

You can also see the isolation by hand:

```sh
PGPASSWORD=dev_grocery psql -h localhost -U grocery_svc -d life_island
```

```sql
select count(*) from outbox;          -- works: grocery.outbox
select count(*) from review.outbox;   -- ERROR: permission denied for schema review
create table public.x (id int);       -- ERROR: permission denied for schema public
```

## Connecting from code

Services use `createServiceDb` from `@life-island/be-common`:

```ts
import { createServiceDb, withTransaction } from '@life-island/be-common';

const { pool, db, close } = createServiceDb({
  connectionString: process.env.GROCERY_DATABASE_URL!,
  schema: 'grocery',
});

// Plain SQL through the pool
await pool.query('select count(*) from outbox');

// Drizzle ORM on the same pool
// const receipts = await db.select().from(receiptsTable);

// A transaction: committed if the callback resolves, rolled back if it throws
await withTransaction(pool, async (client) => {
  await client.query('insert into receipts (...) values (...)');
});

await close();
```

`createServiceDb` creates a `pg` connection pool (10 connections by default) whose connections start with `search_path` set to the given schema, and wraps it with Drizzle. The schema name is checked against `^[a-z][a-z0-9_]{0,62}$` because it is placed into SQL text; anything else throws.

## Rules for schema design

- **No foreign keys across schemas.** Refer to another service's data by id and fetch it through that service's API.
- **No cross-schema queries.** The roles make them impossible; do not work around it with the superuser.
- **Domain rows loaded from review carry a unique `source_staging_id`**, so a redelivered `record.approved` cannot insert twice.
- **Files never go into the database.** Store them in S3 and keep only metadata (key, size, MIME, hash).

## Migrations

Each service will own a `drizzle/` folder inside its app and run `drizzle-kit migrate` with its own role at startup or in CI, touching only its own schema. Drizzle ORM and drizzle-kit are already installed; the first migrations arrive with the first service in Week 3. Until then, the init scripts define the only tables.

Adding a new service's schema today means:

1. Add a role, `grant connect`, a schema and a `search_path` line to `01-schemas-and-roles.sql`.
2. Add a `call pg_temp.create_outbox_tables('<schema>', '<role>')` line to `02-outbox.sql`.
3. Add the role and schema to the two arrays at the top of `03-check-isolation.sql`.
4. Add a `<SERVICE>_DATABASE_URL` to `.env.example`.
5. Run `npm run infra:reset && npm run infra:up && npm run db:check-isolation`.

## Inspecting the data

Use any Postgres client (DBeaver, pgAdmin, TablePlus, `psql`) against `localhost:5432`, database `life_island`. Log in as a service role to see exactly what that service sees, or as `postgres` to see everything.
