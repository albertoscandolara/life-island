# Nx workspace

Life Island is one [Nx](https://nx.dev) monorepo. Nx understands which projects depend on which, runs tasks in the right order, caches their results, and runs only what a change affects. It also enforces the rule that apps never import from each other.

## Projects and where they live

| Folder  | Holds                                                                                   | Naming                                                       |
| ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/` | Deployable things: the Angular shell and remotes, the NestJS services, the parse worker | `shell`, `mfe-<module>`, `svc-<module>`                      |
| `libs/` | Code shared between apps. Nothing is deployed from here                                 | `contracts`, `be-common`, later `design-system`, `fe-common` |

Today the workspace has two projects, both libraries:

| Project     | Import path              | Tags                       | Purpose                                                 |
| ----------- | ------------------------ | -------------------------- | ------------------------------------------------------- |
| `contracts` | `@life-island/contracts` | `type:lib`, `scope:shared` | Zod contracts: event envelope, versioned contract names |
| `be-common` | `@life-island/be-common` | `type:lib`, `scope:shared` | DB factory, outbox, relay, idempotent consumer          |

Run `npx nx show projects` to list projects and `npx nx graph` to see how they depend on each other.

### How a project is defined

There are no `project.json` files. Each project is a folder with a `package.json`, and Nx reads its name and tags from the `nx` key:

```jsonc
// libs/be-common/package.json
{
  "name": "@life-island/be-common",
  "nx": {
    "name": "be-common",
    "tags": ["type:lib", "scope:shared"],
  },
  "dependencies": {
    "@life-island/contracts": "*",
    "pg": "^8.23.1",
    // ...
  },
}
```

The root `package.json` declares `apps/*` and `libs/*` as **npm workspaces**, so `@life-island/contracts` resolves to `libs/contracts` through `node_modules` symlinks. Each library lists the packages it uses in its own `dependencies`; the `@nx/dependency-checks` lint rule fails if one is missing or unused.

### Targets are inferred by plugins

Nobody writes build or test commands by hand. Plugins in `nx.json` look at the files in each project and create targets:

| Plugin              | Looks for           | Creates                                                |
| ------------------- | ------------------- | ------------------------------------------------------ |
| `@nx/js/typescript` | `tsconfig.lib.json` | `build` (tsc), `typecheck`, `build-deps`, `watch-deps` |
| `@nx/eslint/plugin` | `eslint.config.mjs` | `lint`                                                 |
| `@nx/vitest`        | `vitest.config.mts` | `test`, `test-ci`                                      |

`npx nx show project be-common` prints the resulting targets and the command behind each one. `targetDefaults` in `nx.json` adds one rule on top: `test` depends on `^build`, so a library's dependencies are built before its tests run.

### TypeScript setup

- `tsconfig.base.json` holds the shared compiler options: strict mode, `module: nodenext`, ES2022, and the custom condition `@life-island/source`.
- Each library's `package.json` `exports` has a `@life-island/source` entry pointing at `src/index.ts`. Because of the custom condition, TypeScript and Vitest read other libraries' **source** directly, so you never need to build a library just to use it in another one during development. The `import` and `types` entries point at `dist/` for the built output.
- The root `tsconfig.json` and each project's `tsconfig.json` use **project references**. Nx keeps them in sync: after you add a dependency between projects, run `npx nx sync`. CI runs `npx nx sync:check` and fails if you forget.
- Imports between files use the `.js` extension (`import { x } from './db.js'`), as `nodenext` requires.

## Module boundaries

Tags describe what a project is (`type:*`) and which module it belongs to (`scope:*`). The `@nx/enforce-module-boundaries` rule in `eslint.config.mjs` turns them into hard rules that fail lint:

| A project tagged… | May import only projects tagged…                    |
| ----------------- | --------------------------------------------------- |
| `type:app`        | `type:lib` (so an app can never import another app) |
| `type:lib`        | `type:lib`                                          |
| `scope:shared`    | `scope:shared`                                      |
| `scope:review`    | `scope:review` or `scope:shared`                    |
| `scope:groceries` | `scope:groceries` or `scope:shared`                 |
| `scope:tax730`    | `scope:tax730` or `scope:shared`                    |
| `scope:ingestion` | `scope:ingestion` or `scope:shared`                 |
| `scope:shell`     | `scope:shell` or `scope:shared`                     |

A project must satisfy every rule that matches one of its tags. For example `mfe-groceries`, tagged `type:app, scope:groceries`, may import `design-system` (`type:lib, scope:shared`) but not `mfe-tax730` (an app) or a `scope:tax730` library.

When you add a new module, add its `scope:<module>` line to `depConstraints`.

## Running tasks

```sh
npx nx test be-common                         # one target, one project
npx nx run-many -t lint test build typecheck  # several targets, every project
npx nx affected -t lint test                  # only projects changed since the base
npx nx test be-common --skip-nx-cache         # ignore cached results
```

### Caching

Nx hashes a task's inputs (its project's files, its dependencies' outputs, the relevant config) and replays the stored result when nothing changed. Inputs are set by `namedInputs` in `nx.json`: `production` excludes spec files and lint config, so editing a test does not invalidate a dependent project's build. The cache lives in `.nx/cache` and is git-ignored. `npx nx reset` clears it.

### `nx affected`

`nx affected` compares the current commit with a base (by default `main`) and runs the target for changed projects plus every project that depends on them. In CI the `nrwl/nx-set-shas` action sets the base to the last commit on `main` with a successful run. Changing a file outside any project, such as `package.json` or `nx.json`, marks every project as affected.

## Adding projects

Use generators rather than copying folders; they write the tsconfig files, test setup, lint config and workspace wiring.

**A shared TypeScript library:**

```sh
npx nx g @nx/js:lib libs/<name> --name=<name> --importPath=@life-island/<name> \
  --bundler=tsc --linter=eslint --unitTestRunner=vitest \
  --tags="type:lib,scope:shared" --useProjectJson=false
```

**A NestJS service** (from Week 3; install `@nx/nest` first):

```sh
npm i -D @nx/nest
npx nx g @nx/nest:app apps/svc-<module> --tags="type:app,scope:<module>"
```

**An Angular remote** (from Week 2): the shell and remotes use Native Federation; the setup is described in [architecture.md](../architecture.md#micro-frontends) and will be added here when the shell exists.

After generating, check the tags, run `npx nx sync`, and run `npx nx run-many -t lint test build typecheck`. A new module must also pass the [new-feature checklist](../architecture.md#new-feature-checklist).

## Formatting and editor setup

- Prettier formats the code; settings are in `.prettierrc`. `npx nx format:write` formats changed files and `npx nx format:check` (run in CI) fails on unformatted ones.
- `.vscode/extensions.json` recommends the Nx Console, ESLint and Prettier extensions.
- `CLAUDE.md` and `AGENTS.md` hold instructions for AI coding assistants working in the repo.
