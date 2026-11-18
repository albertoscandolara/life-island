# Testing and CI

## Test runner

Tests use [Vitest](https://vitest.dev). Each project has its own `vitest.config.mts`, and the `@nx/vitest` plugin turns it into the project's `test` target. Tests sit next to the code they test:

| File pattern    | Kind             | Needs                                          |
| --------------- | ---------------- | ---------------------------------------------- |
| `*.spec.ts`     | Unit test        | Nothing                                        |
| `*.int.spec.ts` | Integration test | The Docker stack and two environment variables |

Vitest globals are on, so `describe`, `it`, `expect` and `vi` need no import.

## Running tests

```sh
npx nx test contracts                    # one project
npx nx run-many -t test                  # every project; integration tests are skipped
npm run infra:up && npm run test:integration   # every project, integration tests included
```

`npm run test:integration` loads `.env` with `dotenv-cli` and runs every `test` target with `--skip-nx-cache`, so results always come from a real run against the current database.

### How integration tests switch on

An integration test suite is wrapped in `describe.skipIf(...)`, keyed on the environment variables it needs:

```ts
const databaseUrl = process.env['GROCERY_DATABASE_URL'];
const natsUrl = process.env['NATS_URL'];

describe.skipIf(!databaseUrl || !natsUrl)(
  'outbox → NATS → idempotent consumer',
  () => {
    // ...
  },
);
```

Without the variables, the suite is reported as skipped and the rest of the tests still run, so `nx test` works on a machine without Docker.

### Writing an integration test

- Connect as the **service's own role**, never as `postgres`, so the test sees what the service will see.
- Create what you need in `beforeAll` and remove it in `afterAll`; the existing suite creates a scratch table and drops it at the end.
- Give durable consumers and event types a random suffix, so test runs never interfere with each other or with leftover state.
- Drive the relay with `publishBatch()` instead of timers, and use `vi.waitFor` for asynchronous delivery.

## What exists today

| Suite                                           | Checks                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/contracts/src/lib/event-envelope.spec.ts` | Contract names parse and reject bad input; subject mapping; envelope validation                                                                  |
| `libs/be-common/src/lib/schema-name.spec.ts`    | Schema names that could inject SQL are rejected                                                                                                  |
| `libs/be-common/src/lib/outbox.int.spec.ts`     | Outbox rolls back with the transaction; events published once and applied once; repeated ids skipped; republished rows deduplicated by JetStream |
| `npm run db:check-isolation`                    | Every role sees only its own schema ([Database](database.md#the-isolation-check))                                                                |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. A new push to the same branch cancels the run still in progress. It has two jobs that run side by side:

- **checks** needs no database. It runs format, lint, build, type-check and the unit tests of every project except the services and `be-common`, three projects at a time.
- **integration** starts the compose stack and runs the tests of the services and `be-common`, one project at a time, because their integration tests share one database and the reclassification tests briefly hold its global write lock.

| Step                                                  | Job         | What it checks                                                                             |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| Checkout with full history                            | both        | `nx affected` needs history to compare commits                                             |
| Set up Node 22 with npm cache, `npm ci`               | both        | Exact dependencies from the lockfile                                                       |
| `nrwl/nx-set-shas`                                    | both        | Sets the comparison base to the last commit on `main` with a green run                     |
| Restore and save the Nx cache                         | both        | Tasks whose inputs did not change since an earlier run are replayed instead of run again   |
| `npx nx format:check`                                 | checks      | Code is Prettier-formatted                                                                 |
| `npx nx sync:check`                                   | checks      | TypeScript project references are up to date                                               |
| `npm run lint:styles`                                 | checks      | Stylelint: apps use design tokens, no raw colours or px/rem spacing                        |
| `npx nx affected -t lint build typecheck`             | checks      | Lint (including module boundaries and dependency checks), build and type-check             |
| `npx nx affected -t test --exclude='svc-*,be-common'` | checks      | Unit tests of the apps and libraries                                                       |
| `npm run infra:up`                                    | integration | Starts Postgres, SeaweedFS, NATS and Caddy in the runner                                   |
| `npm run db:check-isolation`                          | integration | Schema isolation still holds                                                               |
| `curl …/healthz`                                      | integration | Gateway configuration loads                                                                |
| `npx nx affected -t test` on `svc-*` and `be-common`  | integration | Unit and integration tests, with the `*_DATABASE_URL`, `NATS_URL` and `S3_*` variables set |
| `npm run infra:down`                                  | integration | Always runs, even after a failure                                                          |

### The Nx cache in CI

Both jobs keep Nx's cache in `.nx/cache` and its index in `.nx/workspace-data/*.db` (set by `NX_CACHE_DIRECTORY` and `NX_WORKSPACE_DATA_DIRECTORY`) and carry them between runs with `actions/cache`, one cache per job, capped at 2 GB by `NX_MAX_CACHE_SIZE`. A pull request starts from the latest cache of its own branch, or of `main`. Nx names the index after the machine id, which changes on every runner, so `tools/ci/adopt-nx-cache.sh` renames the restored index before Nx runs. If a cached result ever looks wrong, rerun the job after deleting the `nx-checks-*` or `nx-integration-*` entries under the repository's Actions caches.

A new service or library with integration tests must be picked up by the integration job: name it `svc-*`, or add it to both `--exclude` lists in the workflow.

### Reproducing CI locally

```sh
npm ci
npm run infra:up
npm run db:check-isolation
npx nx format:check
npx nx sync:check
npm run lint:styles
cp .env.example .env
npx dotenv -e .env -- nx affected -t lint test build typecheck --base=origin/main
```

### When CI fails

| Failing step                            | Usual fix                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `format:check`                          | `npx nx format:write`, commit                                                                                     |
| `sync:check`                            | `npx nx sync`, commit the changed `tsconfig.json` files                                                           |
| `lint` with `enforce-module-boundaries` | You imported an app, or a library from another module's scope. Move the shared code into a `scope:shared` library |
| `lint` with `dependency-checks`         | Add the missing package to (or remove the unused one from) the library's own `package.json`                       |
| `db:check-isolation`                    | An init script granted too much; see [Database](database.md)                                                      |

## Planned additions

- **AI evals** in `tools/evals/`: golden documents with expected JSON, scored per field and per document cost, run in CI whenever a prompt version changes (Weeks 5–6).
- **One CI job per app**, so each app builds and deploys independently. Services already share one Dockerfile, `infra/docker/node-service.Dockerfile`, picked with `--build-arg SERVICE=<project>`.

## Front-end tests

Angular projects (`design-system`, `documents`, `shell`) run Vitest through `@angular/build:unit-test` in jsdom: `npx nx test design-system`. Test components through a small host component and signals, as in `libs/design-system/src/lib/dropdown/dropdown.spec.ts`. jsdom lacks `HTMLDialogElement.showModal`, so dialog specs add a two-line polyfill.
