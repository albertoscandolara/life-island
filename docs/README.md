# Life Island documentation

This folder explains how Life Island is built and how to work on it. Start with the overview, then read the guide for whatever part you are touching.

| Document                                             | Read it when you want to…                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [System overview](overview.md)                       | Understand the whole system: components, data ownership, how a document travels from upload to a module, and what exists today versus what is planned |
| [Getting started](getting-started.md)                | Set up a machine, run the stack and the tests, and fix common local problems                                                                          |
| [Nx workspace](guides/nx-workspace.md)               | Understand the monorepo: projects, tags, module boundaries, targets, caching, `nx affected`, adding apps and libs                                     |
| [Local infrastructure](guides/infrastructure.md)     | Know what Docker Compose runs, on which ports, with which volumes and settings                                                                        |
| [Database](guides/database.md)                       | Work with Postgres: one schema and one role per service, init scripts, the isolation check, connecting, migrations                                    |
| [Events and the outbox](guides/events-and-outbox.md) | Publish or consume events: contracts, the transactional outbox, the relay, idempotent consumers, delivery guarantees                                  |
| [Storage and gateway](guides/storage-and-gateway.md) | Use S3 storage (SeaweedFS locally) and route the front end to services through Caddy                                                                  |
| [Documents loader](guides/documents-loader.md)       | Run or change the upload, parse and review flow: data model, categories, schedule, parser, APIs, storage                                              |
| [Document storage](document-storage.md)              | Know where uploaded files live, how they are retrieved by id, and the SQL of the documents table                                                      |
| [Testing and CI](guides/testing-and-ci.md)           | Write unit and integration tests and understand what the GitHub Actions pipeline checks                                                               |
| [Architecture and ingestion plan](architecture.md)   | Read the source-of-truth plan: principles, AI pipeline, review inbox, roadmap and the new-feature checklist                                           |

## How these documents relate

- [architecture.md](architecture.md) is the **plan**. It is exported from the project's Claude doc and is the source of truth for principles and roadmap. Do not edit it here without re-exporting it; change the Claude doc instead.
- Everything else in this folder describes **what is built** and how to use it. When code changes, update the matching guide in the same pull request.
