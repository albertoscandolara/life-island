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

Life Island is an Nx monorepo of small apps that each own one job. The **shell** (`apps/shell`) is the 3D island you open in the browser. Each zone of the island is a separate Angular remote (`apps/mfe-*`) that the shell loads at runtime with Native Federation, so every area builds and deploys on its own. Behind each remote sits a NestJS service (`apps/svc-*`) with its own Postgres schema and its own database role, so no service can read another's tables. Services never call each other's databases. They talk through events on NATS, written first to an outbox table in the same transaction as the data. Documents go in through the **documents app** (`apps/documents`). `svc-ingestion` stores the file in S3 storage (SeaweedFS), `svc-parse-worker` reads it with Claude (or a fake parser offline), you confirm the result in `svc-review`, and only then does the area that needs it (taxes, home and bills, people and IDs) receive it. Caddy is the single gateway that routes `/api/<service>` to each service. The principles behind all this are in [docs/architecture.md](docs/architecture.md).

```
apps/shell             The island: hub and routes that load each area's remote
apps/documents         Load documents, review what the AI read, confirm it
apps/mfe-*             One Angular remote per area: tax730, home (home and bills), people (people and IDs)
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

Then, every time, one command starts everything:

```sh
npm start
```

It starts the Docker infrastructure and waits until it is healthy (`npm run infra:up`), adds any schema your database is missing (`npm run db:upgrade`, safe to repeat), then runs every app and service in watch mode (`npm run dev`, which is `nx run-many -t serve`). The first start builds everything, so give it a minute or two. Stop it with Ctrl+C; the infrastructure keeps running until `npm run infra:down`.

When the infrastructure is already up, `npm run dev` alone restarts the apps and services. To run only some of them, name them: `npx nx run-many -t serve -p svc-people mfe-people shell`, or one at a time with `npx nx serve <project>`.

| Open                            | What                                                  | Started by                                                                    |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| http://localhost:4200           | The island, with every area below                     | `shell`                                                                       |
| http://localhost:4200/taxes/730 | 730 & taxes                                           | `mfe-tax730` (4203) + `svc-tax730` (3004)                                     |
| http://localhost:4200/home      | Home, and Bills at `/home/bills`                      | `mfe-home` (4204) + `svc-home` (3005)                                         |
| http://localhost:4200/people    | People & IDs: ID documents, versions, reviews, expiry | `mfe-people` (4205) + `svc-people` (3006)                                     |
| http://localhost:4201           | Documents: upload, review inbox, Parse now            | `documents` + `svc-ingestion` (3001), `svc-review` (3002), `svc-parse-worker` |
| —                               | Groceries service (no page yet)                       | `svc-groceries` (3003)                                                        |

Each remote also runs on its own at its port. The dev servers forward `/api/<service>` to the service's port, the same paths the gateway uses. The parse worker uses a fake parser by default; set `PARSER=claude` and `ANTHROPIC_API_KEY` in `.env` to read documents with Claude.

| Infrastructure         | Local address                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| Postgres               | `localhost:5432`, database `life_island`                           |
| S3 storage (SeaweedFS) | `http://localhost:8333`                                            |
| NATS                   | `nats://localhost:4222`, monitoring on `http://localhost:8222`     |
| Gateway (Caddy)        | `http://localhost:8080`, `/api/<service>/*` routes to each service |

To run the services in Docker instead of on your machine: `docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build`.

## Checks

```sh
npm run db:check-isolation    # each service role sees only its own schema
npx nx run-many -t lint test build typecheck
npm run test:integration      # also runs the tests that need Postgres, NATS and S3
```

`npm run infra:reset` deletes the volumes, so the database init scripts run again on the next `infra:up`.

More detail, including settings and troubleshooting, is in [Getting started](docs/getting-started.md).
