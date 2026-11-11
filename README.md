# Life Island

A personal life-management platform: an Angular shell (a 3D island) hosts independent modules, each run by a character that handles one area of life. Documents you drop on the island are read by an AI service, reviewed by you, and only then loaded into the module that uses them.

## Documentation

Full documentation lives in [`docs/`](docs/README.md):

- [System overview](docs/overview.md): components, data ownership, how a document travels from upload to a module, technology choices, and what exists today
- [Getting started](docs/getting-started.md): setup, everyday commands, settings and troubleshooting
- Guides to each tool:
  [Nx workspace](docs/guides/nx-workspace.md) ·
  [Local infrastructure](docs/guides/infrastructure.md) ·
  [Database](docs/guides/database.md) ·
  [Events and the outbox](docs/guides/events-and-outbox.md) ·
  [Storage and gateway](docs/guides/storage-and-gateway.md) ·
  [Testing and CI](docs/guides/testing-and-ci.md)
- [Architecture and ingestion plan](docs/architecture.md): the source-of-truth principles, AI pipeline and roadmap. Every feature follows it.

## Architecture

Life Island is an Nx monorepo of small apps that each own one job. The **shell** (`apps/shell`) is the 3D island you open in the browser. Each zone of the island is a separate Angular remote (`apps/mfe-*`) that the shell loads at runtime with Native Federation, so every area builds and deploys on its own. Behind each remote sits a NestJS service (`apps/svc-*`) with its own Postgres schema and its own database role, so no service can read another's tables. Services never call each other's databases. They talk through events on NATS, written first to an outbox table in the same transaction as the data. Documents go in through the **documents app** (`apps/documents`). `svc-ingestion` stores the file in S3 storage (SeaweedFS), `svc-parse-worker` reads it with Claude (or a fake parser offline), you confirm the result in `svc-review`, and only then does the area that needs it (taxes, home and bills, people and IDs, cars, work) receive it. Caddy is the single gateway that routes `/api/<service>` to each service. The principles behind all this are in [docs/architecture.md](docs/architecture.md).

```
apps/shell             The island: hub and routes that load each area's remote
apps/documents         Load documents, review what the AI read, confirm it
apps/mfe-*             One Angular remote per area: tax730, home (home and bills), people (people and IDs), cars, work
apps/svc-*             One Nest service per area, plus ingestion, review and the parse worker
libs/contracts         Zod contracts: event names and payloads, DTOs shared by remotes and services
libs/be-common         Service DB factory, transactional outbox, outbox relay, idempotent NATS consumer
libs/design-system     Shared UI components and the character themes
libs/be-nest           Shared Nest wiring for the services
libs/ingestion-db      The ingestion tables, shared by svc-ingestion and the parse worker only
infra/                 Docker Compose: Postgres (pgvector), SeaweedFS (S3), NATS JetStream, Caddy
```

## Run it locally

Requires Node 22 and Docker. The first time:

```sh
npm ci
cp .env.example .env
```

Then open `.env` and check the settings in [Settings to check in `.env`](#settings-to-check-in-env) below. Every other value in it already works on your machine.

Then, every time, one command starts everything:

```sh
npm start
```

It starts the Docker infrastructure and waits until it is healthy (`npm run infra:up`), adds any schema your database is missing (`npm run db:upgrade`, safe to repeat), then runs every app and service in watch mode (`npm run dev`, which is `nx run-many -t serve`). The first start builds everything, so give it a minute or two. Stop it with Ctrl+C; the infrastructure keeps running until `npm run infra:down`.

When the infrastructure is already up, `npm run dev` alone restarts the apps and services. To run only some of them, name them: `npx nx run-many -t serve -p svc-people mfe-people shell`, or one at a time with `npx nx serve <project>`.

| Open                                | What                                                     | Started by                                                                    |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| http://localhost:4200               | The island, with every area below                        | `shell`                                                                       |
| http://localhost:4200/taxes/730     | 730 & taxes                                              | `mfe-tax730` (4203) + `svc-tax730` (3004)                                     |
| http://localhost:4200/home          | Home, and Bills at `/home/bills`                         | `mfe-home` (4204) + `svc-home` (3005)                                         |
| http://localhost:4200/people        | People & IDs: ID documents, versions, reviews, expiry    | `mfe-people` (4205) + `svc-people` (3006)                                     |
| http://localhost:4200/cars          | Cars: registration codes, renewals, costs                | `mfe-cars` (4206) + `svc-cars` (3007)                                         |
| http://localhost:4200/work          | Work: workplaces, career timeline, AI feedback           | `mfe-work` (4207) + `svc-work` (3008)                                         |
| http://localhost:4200/studies       | Studies: learning paths, courses, exams, study coach     | `mfe-studies` (4209) + `svc-studies` (3010)                                   |
| http://localhost:4200/agenda        | Agenda: every date of every area, reminders, week brief  | `mfe-agenda` (4210) + `svc-agenda` (3011)                                     |
| http://localhost:4200/money         | Money: accounts, bank CSV import, budgets, recurring     | `mfe-money` (4211) + `svc-money` (3012)                                       |
| http://localhost:4200/goals         | Goals & habits: next steps, streaks, weekly review       | `mfe-goals` (4212) + `svc-goals` (3013)                                       |
| http://localhost:4200/health        | Health: check-ups, visits, medicines, results            | `mfe-health` (4213) + `svc-health` (3014)                                     |
| http://localhost:4200/subscriptions | Contracts & subscriptions: renewals, cancel-by dates     | `mfe-subscriptions` (4214) + `svc-subscriptions` (3015)                       |
| http://localhost:4200/mailbox       | Admin mailbox: official letters and the date to act by   | `mfe-mailbox` (4215) + `svc-mailbox` (3016)                                   |
| http://localhost:4200/travel        | Travel: trips, bookings, checklist, packing, costs       | `mfe-travel` (4216) + `svc-travel` (3017)                                     |
| http://localhost:4200/fitness       | Fitness: active minutes, body and sleep, events, plan    | `mfe-fitness` (4217) + `svc-fitness` (3018)                                   |
| http://localhost:4200/groceries     | Groceries: shopping list, prices, spending               | `mfe-groceries` (4202) + `svc-groceries` (3003)                               |
| http://localhost:4200/settings      | Settings: app settings, AI tools with costs and switches | `mfe-settings` (4208) + `svc-settings` (3009)                                 |
| http://localhost:4201               | Documents: upload, review inbox, Parse now               | `documents` + `svc-ingestion` (3001), `svc-review` (3002), `svc-parse-worker` |

Each remote also runs on its own at its port. The dev servers forward `/api/<service>` to the service's port, the same paths the gateway uses.

| Infrastructure         | Local address                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| Postgres               | `localhost:5432`, database `life_island`                           |
| S3 storage (SeaweedFS) | `http://localhost:8333`                                            |
| NATS                   | `nats://localhost:4222`, monitoring on `http://localhost:8222`     |
| Gateway (Caddy)        | `http://localhost:8080`, `/api/<service>/*` routes to each service |

### Settings to check in `.env`

These are the only values you may need to change. Write them exactly as shown, with no quotes and no spaces around `=`.

| Setting              | Write                                      | What it does                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PARSER`             | `PARSER=fake` (default) or `PARSER=claude` | Who reads your documents. `fake` works offline without a key but does not really understand documents: it cannot read photos or scans at all, and from PDFs and text it picks only totals, dates and a few keywords. `claude` reads everything, photos of IDs included, and needs the key below. |
| `ANTHROPIC_API_KEY`  | `ANTHROPIC_API_KEY=sk-ant-...`             | Your Claude API key, from [console.anthropic.com](https://console.anthropic.com). Needed only with `PARSER=claude`. Leave it empty with `PARSER=fake`.                                                                                                                                           |
| `PARSE_RUN_ON_START` | `true` (default) or `false`                | `true` reads the waiting documents every time the worker starts. Otherwise they are read at `PARSE_SCHEDULE` (06:00 every day) or when you press **Parse now** in the Documents app.                                                                                                             |
| any `*_PORT`         | a free port number                         | Change one only if something else on your machine already uses it.                                                                                                                                                                                                                               |

`PARSER` accepts any case (`claude`, `Claude`, `CLAUDE`). If the worker cannot use a value, for example `PARSER=claude` with no key, it stops at startup with a message that names the setting to fix. The worker reads `.env` only when it starts: after a change, stop `npm run dev` with Ctrl+C and run it again.

The full list of settings, with defaults, is in [Getting started](docs/getting-started.md#settings-env).

### When something does not start

`npm run dev` shows every app and service in one screen, and **if any one of them crashes, Nx stops all of them** and only prints a summary such as "Successfully ran target serve" or a list of failed tasks. The reason is in that service's own output, which the summary does not show. Two ways to read it:

- In the `npm run dev` screen, use the arrow keys to select the task (for example `svc-parse-worker:serve`) and press Space to see its output.
- Or start that service alone, with its output printed straight to the terminal: `npx nx serve svc-parse-worker --tui=false`. The error, if any, is the last thing printed.

If the Documents app says **"The parse worker is not running"**, the worker has crashed or was never started, and no document is read until it runs. Start it alone as above and read its error. The most common causes are a wrong `PARSER` value or a missing `ANTHROPIC_API_KEY`. More cases are in [Troubleshooting](docs/getting-started.md#troubleshooting).

### Run in Docker

To run the services in Docker instead of on your machine: `docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build`.

## Checks

```sh
npm run db:check-isolation    # each service role sees only its own schema
npx nx run-many -t lint test build typecheck
npm run test:integration      # also runs the tests that need Postgres, NATS and S3
```

`npm run infra:reset` deletes the volumes, so the database init scripts run again on the next `infra:up`.

More detail, including settings and troubleshooting, is in [Getting started](docs/getting-started.md).
