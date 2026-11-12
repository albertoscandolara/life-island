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
| `npm start`                     | Starts the infrastructure, applies `db:upgrade`, then serves every app and service (`npm run dev`)      |
| `npm run dev`                   | Serves every app and service in watch mode (`nx run-many -t serve`); needs the infrastructure up        |
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

| Variable                                                                                                                | Default                                                                                                                                                    | Used by                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`                                                                                    | `postgres` / `postgres`                                                                                                                                    | Postgres superuser, for admin work only                                                                                                                                                                                                                                                         |
| `POSTGRES_PORT`                                                                                                         | `5432`                                                                                                                                                     | Host port for Postgres                                                                                                                                                                                                                                                                          |
| `NATS_PORT`, `NATS_MONITOR_PORT`                                                                                        | `4222`, `8222`                                                                                                                                             | Host ports for NATS clients and the monitoring page                                                                                                                                                                                                                                             |
| `STORAGE_S3_PORT`                                                                                                       | `8333`                                                                                                                                                     | Host port for the S3 API                                                                                                                                                                                                                                                                        |
| `GATEWAY_PORT`                                                                                                          | `8080`                                                                                                                                                     | Host port for Caddy                                                                                                                                                                                                                                                                             |
| `INGESTION_DATABASE_URL`, `REVIEW_DATABASE_URL`, `GROCERY_DATABASE_URL`, `TAX730_DATABASE_URL`                          | `postgres://<role>:<password>@localhost:5432/life_island`                                                                                                  | Each service's own connection; the integration tests use `GROCERY_DATABASE_URL`                                                                                                                                                                                                                 |
| `NATS_URL`                                                                                                              | `nats://localhost:4222`                                                                                                                                    | Services and integration tests                                                                                                                                                                                                                                                                  |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_ENDPOINT`, `STORAGE_CORS_ORIGINS` | `http://localhost:8333`, dev keys, `us-east-1`, `uploads`                                                                                                  | Upload flow ([storage guide](guides/storage-and-gateway.md))                                                                                                                                                                                                                                    |
| `HOME_URL`                                                                                                              | `http://localhost:3005`                                                                                                                                    | Where `svc-people` reads the houses that a person's Residence can point to                                                                                                                                                                                                                      |
| `GROCERY_PORT`, `TAX730_PORT`, `HOME_PORT`, `PEOPLE_PORT`, `CARS_PORT`, `INGESTION_URL`                                 | `3003`, `3004`, `3005`, `3006`, `3007`, `http://localhost:3001`                                                                                            | Local ports of the domain services; where `svc-tax730` reads original files for the commercialista's zip                                                                                                                                                                                        |
| `CARS_DATABASE_URL`, `CARS_PORT`                                                                                        | `postgres://cars_svc:dev_cars@localhost:5432/life_island`, `3007`                                                                                          | svc-cars; both default to the local stack, so an older `.env` needs no change                                                                                                                                                                                                                   |
| `WORK_DATABASE_URL`, `WORK_PORT`, `WORK_FEEDBACK_MODEL`                                                                 | `postgres://work_svc:dev_work@localhost:5432/life_island`, `3008`, `claude-sonnet-5-5`                                                                     | svc-work; all default to the local stack, so an older `.env` needs no change. On an older database it adds its own schema and role at startup. Career feedback uses `ANTHROPIC_API_KEY` when set, else offline rules                                                                            |
| `SETTINGS_TIMEZONE`                                                                                                     | `Europe/Rome`                                                                                                                                              | The time zone svc-settings counts months in, for the monthly AI budget                                                                                                                                                                                                                          |
| `SETTINGS_DATABASE_URL`, `SETTINGS_PORT`                                                                                | `postgres://settings_svc:dev_settings@localhost:5432/life_island`, `3009`                                                                                  | svc-settings; both default to the local stack. On an older database it adds its own schema and role at startup                                                                                                                                                                                  |
| `STUDIES_DATABASE_URL`, `STUDIES_PORT`, `STUDIES_AI_MODEL`                                                              | `postgres://studies_svc:dev_studies@localhost:5432/life_island`, `3010`, `claude-sonnet-5-5`                                                               | svc-studies; all default to the local stack. On an older database it adds its own schema and role at startup. The study coach and the resource scout use `ANTHROPIC_API_KEY` when set (the coach falls back to offline rules). `STUDIES_SCOUT_SCHEDULE=false` stops the scout's scheduled scans |
| `AGENDA_DATABASE_URL`, `AGENDA_PORT`, `AGENDA_AI_MODEL`, `AGENDA_SOURCES`                                               | `postgres://agenda_svc:dev_agenda@localhost:5432/life_island`, `3011`, `claude-haiku-5-5`, the local ports of every area                                   | svc-agenda; `AGENDA_SOURCES` is `module=url,…` for where each area answers `GET /deadlines`                                                                                                                                                                                                     |
| `MONEY_*`, `GOALS_*`, `HEALTH_*`, `SUBSCRIPTIONS_*`, `TRAVEL_*`, `FITNESS_*` (`_DATABASE_URL`, `_PORT`, `_AI_MODEL`)    | `postgres://<area>_svc:dev_<area>@localhost:5432/life_island`, ports `3012` to `3015`, `3017` and `3018`, `claude-sonnet-5-5` (Fitness `claude-haiku-5-5`) | The new areas; all default to the local stack. Their AI tools use `ANTHROPIC_API_KEY` when set, else offline rules                                                                                                                                                                              |
| `GROCERIES_AI_MODEL`                                                                                                    | `claude-haiku-5-5`                                                                                                                                         | The shopping list suggestions of svc-groceries                                                                                                                                                                                                                                                  |
| `INGESTION_PORT`, `REVIEW_PORT`                                                                                         | `3001`, `3002`                                                                                                                                             | Local ports of `svc-ingestion` and `svc-review` (3000 in containers)                                                                                                                                                                                                                            |
| `PARSE_SCHEDULE`, `PARSE_TIMEZONE`, `PARSE_RUN_ON_START`                                                                | `06:00`, `Europe/Rome`, `true`                                                                                                                             | When the parse worker runs ([documents loader](guides/documents-loader.md)). Once you set them in Settings → App settings → Documents, Settings wins                                                                                                                                            |
| `PARSE_QUOTA_RETRY_MINUTES`, `CATEGORY_AUTO_APPROVE`, `FAKE_QUOTA_STEPS`                                                | `360`, `false`, `0`                                                                                                                                        | Quota pauses, category approval, simulated quota ([documents loader](guides/documents-loader.md))                                                                                                                                                                                               |
| `PARSER`                                                                                                                | `fake`                                                                                                                                                     | Who reads documents: `fake` (offline, keywords only, cannot read photos) or `claude` (needs the key). Any case is accepted; any other value stops the worker at startup                                                                                                                         |
| `ANTHROPIC_API_KEY`                                                                                                     | empty                                                                                                                                                      | Claude API key, required when `PARSER=claude`. Without it the worker stops at startup                                                                                                                                                                                                           |

Write each value exactly as shown in `.env.example`: no quotes and no spaces around `=`. Services read `.env` only when they start, so restart `npm run dev` after a change.

Every value here is for local development only. Production gets its secrets from the hosting platform's secret manager.

## Troubleshooting

**`npm run dev` stops everything, or says "Successfully ran target serve" and nothing runs.** One app or service crashed, and Nx stops all the others when that happens. Its error is in its own output, not in the summary. Start it alone so the output prints straight to the terminal, for example `npx nx serve svc-parse-worker --tui=false`, and read the last lines. While `npm run dev` runs, you can also select a task with the arrow keys and press Space to see its output.

**The Documents app says "The parse worker is not running".** The worker has not reported in for over a minute, so nothing is read: neither Parse now nor the daily run. Run `npx nx serve svc-parse-worker --tui=false` and read its error. Common causes: `PARSER` is neither `claude` nor `fake`, or `PARSER=claude` without `ANTHROPIC_API_KEY`; the infrastructure is down (`npm run infra:up`); the database is missing a newer column (`npm run db:upgrade`). When it runs, it prints `svc-parse-worker started with the … parser` and reads the waiting documents.

**Documents are read but get no category and no details, especially photos.** The worker is using the fake parser (`PARSER=fake`), which cannot read images and only spots keywords in file names and PDF text. Set `PARSER=claude` and `ANTHROPIC_API_KEY` in `.env`, restart, and press **Parse again** on each document.

**A port is already in use.** Change the matching `*_PORT` variable in `.env` and run `npm run infra:up` again. If you change `POSTGRES_PORT`, also change the port in the `*_DATABASE_URL` values.

**A new service says its role or schema does not exist.** Your database volume was created before that service was added. Run `npm run db:upgrade`: it adds the missing schemas and roles and keeps your data.

**I changed an init script but nothing happened.** Postgres runs `infra/postgres/init/01-*.sql` and `02-*.sql` only when its volume is empty. Run `npm run infra:reset` and then `npm run infra:up`. This deletes all local data.

**Integration tests are skipped.** They run only when their variables are set (`*_DATABASE_URL`, `NATS_URL`, `S3_ENDPOINT`). Use `npm run test:integration`, which loads `.env`, or export them yourself.

**`nx` says the workspace is out of sync.** Run `npx nx sync` and commit the changed `tsconfig.json` files. CI runs `nx sync:check` and fails until you do.

**The S3 endpoint answers 403.** That is expected for anonymous requests. Sign requests with the keys from `.env`.

**The gateway answers 502 on `/api/...`.** The services behind those routes are not running in Docker. Start them with the `apps` profile (see the [documents loader guide](guides/documents-loader.md)), or use the apps' dev servers, which proxy to services started with `npx nx serve`. The gateway itself is fine if `http://localhost:8080/healthz` answers `ok`.

**Results look stale.** Nx caches task results. Add `--skip-nx-cache` to a command, or run `npx nx reset` to clear the cache.
