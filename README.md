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

## Layout

```
apps/                  Angular remotes (mfe-*) and Nest services (svc-*), added from Week 2
libs/contracts         Zod contracts: versioned event names and the event envelope
libs/be-common         Service DB factory, transactional outbox, outbox relay, idempotent NATS consumer
infra/                 Docker Compose: Postgres (pgvector), SeaweedFS (S3), NATS JetStream, Caddy
```

## Getting started

Requires Node 22 and Docker.

```sh
npm ci
cp .env.example .env
npm run infra:up              # Postgres, storage, NATS, gateway
npm run db:check-isolation    # each service role sees only its own schema
npx nx run-many -t lint test build typecheck
npm run test:integration      # also runs the outbox → NATS → consumer tests against the stack
```

| Service                | Local address                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| Postgres               | `localhost:5432`, database `life_island`                           |
| S3 storage (SeaweedFS) | `http://localhost:8333`                                            |
| NATS                   | `nats://localhost:4222`, monitoring on `http://localhost:8222`     |
| Gateway (Caddy)        | `http://localhost:8080`, `/api/<service>/*` routes to each service |

`npm run infra:reset` deletes the volumes, so the database init scripts run again on the next `infra:up`.

More detail, including settings and troubleshooting, is in [Getting started](docs/getting-started.md).
