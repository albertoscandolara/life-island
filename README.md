# Life Island

A personal life-management platform: an Angular shell (a 3D island) hosts independent modules, each run by a character that handles one area of life. Documents you drop on the island are read by an AI service, reviewed by you, and only then loaded into the module that uses them.

The architecture, rules and roadmap live in [docs/architecture.md](docs/architecture.md). Every feature follows it.

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

## Database isolation

`infra/postgres/init` creates one schema and one login role per service (`ingestion`, `review`, `grocery`, `tax730`). Each role owns its schema, has its `search_path` pinned to it, and has no access to any other schema or to `public`. Every schema has an `outbox` and a `processed_events` table.

## Events

A service writes its domain change and `enqueueEvent(...)` in one transaction. `OutboxRelay` publishes unpublished rows to the `EVENTS` JetStream stream on `events.<domain>.<name>.v<version>`, using the outbox id as the message id so a retried publish is dropped. `startEventConsumer` records each event id in `processed_events` in the same transaction as the handler, so a redelivered event changes nothing.
