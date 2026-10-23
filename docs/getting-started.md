# Getting started

## Prerequisites

| Tool                   | Version     | Used for                                      |
| ---------------------- | ----------- | --------------------------------------------- |
| Node.js                | 22 or newer | Nx, TypeScript, tests (CI uses 22)            |
| npm                    | 10 or newer | Package manager; the repo uses npm workspaces |
| Docker with Compose v2 | Recent      | Postgres, SeaweedFS, NATS and Caddy           |
| Git                    | Any recent  |                                               |

Optional: `psql` or a GUI such as DBeaver or pgAdmin to look at the database, and the [Nx Console](https://nx.dev/getting-started/editor-setup) extension for VS Code or JetBrains.

## First-time setup

```sh
git clone https://github.com/albertoscandolara/life-island.git
cd life-island
npm ci                     # install exact versions from package-lock.json
cp .env.example .env       # local settings; .env is git-ignored
npm run infra:up           # start Postgres, storage, NATS and the gateway, wait until healthy
npm run db:check-isolation # prints "isolation ok: 4 roles, each limited to its own schema"
```

Then check that everything builds and passes:

```sh
npx nx run-many -t lint test build typecheck
npm run test:integration   # also runs the tests that need Postgres and NATS
```

## Everyday commands

| Command                         | What it does                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run infra:up`              | Starts the Docker stack in the background and waits for health checks                                   |
| `npm run infra:down`            | Stops the stack and keeps the data volumes                                                              |
| `npm run infra:reset`           | Stops the stack and **deletes** the volumes. The database init scripts run again on the next `infra:up` |
| `npm run db:check-isolation`    | Verifies each service role can only see its own schema                                                  |
| `npm run test:integration`      | Loads `.env` and runs every project's tests, including the integration tests, bypassing the Nx cache    |
| `npx nx graph`                  | Opens the interactive project graph in the browser                                                      |
| `npx nx run-many -t <target>`   | Runs a target (`lint`, `test`, `build`, `typecheck`) for every project                                  |
| `npx nx affected -t <target>`   | Runs a target only for projects changed since `main`                                                    |
| `npx nx <target> <project>`     | Runs one target for one project, e.g. `npx nx test be-common`                                           |
| `npx nx show project <project>` | Lists a project's targets and how they were inferred                                                    |
| `npx nx format:write`           | Formats changed files with Prettier                                                                     |
| `npx nx sync`                   | Updates TypeScript project references after you add a dependency between projects                       |

## Settings (`.env`)

`.env.example` holds safe local defaults. Copy it to `.env` and change only what you need, such as a port that clashes with something on your machine.

| Variable                                                                                       | Default                                                     | Used by                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`                                                           | `postgres` / `postgres`                                     | Postgres superuser, for admin work only                                         |
| `POSTGRES_PORT`                                                                                | `5432`                                                      | Host port for Postgres                                                          |
| `NATS_PORT`, `NATS_MONITOR_PORT`                                                               | `4222`, `8222`                                              | Host ports for NATS clients and the monitoring page                             |
| `STORAGE_S3_PORT`                                                                              | `8333`                                                      | Host port for the S3 API                                                        |
| `GATEWAY_PORT`                                                                                 | `8080`                                                      | Host port for Caddy                                                             |
| `INGESTION_DATABASE_URL`, `REVIEW_DATABASE_URL`, `GROCERY_DATABASE_URL`, `TAX730_DATABASE_URL` | `postgres://<role>:<password>@localhost:5432/life_island`   | Each service's own connection; the integration tests use `GROCERY_DATABASE_URL` |
| `NATS_URL`                                                                                     | `nats://localhost:4222`                                     | Services and integration tests                                                  |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                                | `http://localhost:8333`, `dev_access_key`, `dev_secret_key` | Upload flow (from Week 3)                                                       |

Every value here is for local development only. Production gets its secrets from the hosting platform's secret manager.

## Troubleshooting

**A port is already in use.** Change the matching `*_PORT` variable in `.env` and run `npm run infra:up` again. If you change `POSTGRES_PORT`, also change the port in the `*_DATABASE_URL` values.

**I changed an init script but nothing happened.** Postgres runs `infra/postgres/init/01-*.sql` and `02-*.sql` only when its volume is empty. Run `npm run infra:reset` and then `npm run infra:up`. This deletes all local data.

**Integration tests are skipped.** They run only when `GROCERY_DATABASE_URL` and `NATS_URL` are set. Use `npm run test:integration`, which loads `.env`, or export the two variables yourself.

**`nx` says the workspace is out of sync.** Run `npx nx sync` and commit the changed `tsconfig.json` files. CI runs `nx sync:check` and fails until you do.

**The S3 endpoint answers 403.** That is expected for anonymous requests. Sign requests with the keys from `.env`.

**The gateway answers 502 on `/api/...`.** The services behind those routes do not exist yet; the gateway itself is fine if `http://localhost:8080/healthz` answers `ok`.

**Results look stale.** Nx caches task results. Add `--skip-nx-cache` to a command, or run `npx nx reset` to clear the cache.
