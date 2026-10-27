# Local infrastructure

`infra/docker-compose.yml` runs everything the services need on your machine. The same file is meant to run on a small VPS in production, with only connection strings and secrets changed.

## Services

| Service    | Image                      | Host port(s)                          | Role                                                                                                                                                     |
| ---------- | -------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `pgvector/pgvector:pg17`   | `5432`                                | The one database: database `life_island`, one schema per service. The pgvector image is used so vector search is available later without changing images |
| `storage`  | `chrislusf/seaweedfs:3.97` | `8333` (S3 API)                       | S3-compatible object storage for uploaded files. Cloudflare R2 replaces it in production                                                                 |
| `nats`     | `nats:2.11-alpine`         | `4222` (clients), `8222` (monitoring) | Message broker, started with JetStream (`-js`) so streams are durable                                                                                    |
| `gateway`  | `caddy:2.10-alpine`        | `8080`                                | Reverse proxy: one origin for the front end, routes `/api/<service>/*` to each service                                                                   |

Every host port can be changed in `.env` (see [Getting started](../getting-started.md#settings-env)).

## Running it

Always use the npm scripts from the repository root:

```sh
npm run infra:up     # docker compose up -d --wait
npm run infra:down   # stop, keep data
npm run infra:reset  # stop and delete volumes
```

The scripts call `docker compose --project-directory . -f infra/docker-compose.yml`. The `--project-directory .` part matters: it makes Compose read the root `.env` and resolve the file's paths (`./infra/...`) from the repository root. Running `docker compose up` from inside `infra/` will not find the mounted files.

`--wait` returns only when every service with a health check is healthy:

| Service    | Health check                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `postgres` | `pg_isready` on database `life_island`                                                                    |
| `nats`     | `GET /healthz?js-enabled-only=true` on the monitoring port, so it is healthy only once JetStream is ready |
| `storage`  | `GET /healthz` on the S3 port, so it is healthy only once the S3 gateway can reach its filer              |
| `gateway`  | None; it counts as ready once started                                                                     |

Useful extras:

```sh
docker compose --project-directory . -f infra/docker-compose.yml ps           # status
docker compose --project-directory . -f infra/docker-compose.yml logs -f nats # follow logs
docker compose --project-directory . -f infra/docker-compose.yml exec postgres psql -U postgres -d life_island
```

## Data and volumes

| Volume          | Mounted at                 | Contains                              |
| --------------- | -------------------------- | ------------------------------------- |
| `postgres-data` | `/var/lib/postgresql/data` | All database data                     |
| `storage-data`  | `/data`                    | Uploaded files and SeaweedFS metadata |
| `nats-data`     | `/data`                    | JetStream streams and consumer state  |

Volumes survive `infra:down` and are deleted by `infra:reset`. Postgres runs its init scripts only when `postgres-data` is empty, so a reset is how you apply changes to them.

Mounted configuration files are read-only:

| File                                           | Mounted into                     | Purpose                                                        |
| ---------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `infra/postgres/init/01-schemas-and-roles.sql` | `postgres` init folder           | Roles and schemas ([Database](database.md))                    |
| `infra/postgres/init/02-outbox.sql`            | `postgres` init folder           | Outbox and idempotency tables                                  |
| `infra/postgres/init/03-check-isolation.sql`   | `/checks/` (not the init folder) | Isolation check, run on demand                                 |
| `infra/seaweedfs/s3.json`                      | `/etc/seaweedfs/s3.json`         | S3 credentials ([Storage and gateway](storage-and-gateway.md)) |
| `infra/caddy/Caddyfile`                        | `/etc/caddy/Caddyfile`           | Gateway routes                                                 |

## NATS

NATS runs with `-js -sd /data -m 8222`: JetStream on, its storage in the `nats-data` volume, and the monitoring server on port 8222. Open `http://localhost:8222` for server info; `http://localhost:8222/jsz?streams=1&consumers=1` lists streams and consumers.

The `EVENTS` stream is not created by Compose. The first service (or test) that calls `ensureEventsStream()` from `@life-island/be-common` creates it. See [Events and the outbox](events-and-outbox.md#the-events-stream).

For a command-line view, the [`nats` CLI](https://github.com/nats-io/natscli) works against `nats://localhost:4222`, for example `nats stream info EVENTS` or `nats sub 'events.>'`.

## Production outlook

The plan in [architecture.md](../architecture.md#database) keeps this shape in production: the same Compose file on a small VPS, or managed Postgres later, with secrets from the platform's secret manager, R2 instead of SeaweedFS, and Caddy serving real HTTPS. Nightly `pg_dump` backups to object storage are on the hardening list of the roadmap.
