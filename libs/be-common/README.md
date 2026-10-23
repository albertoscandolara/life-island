# be-common

Back-end building blocks: the per-service database factory, the transactional outbox, the outbox relay to NATS JetStream, and the idempotent event consumer.

Import it as `@life-island/be-common`. How it works and how to use it: [Events and the outbox](../../docs/guides/events-and-outbox.md) and [Database](../../docs/guides/database.md#connecting-from-code).

```sh
npx nx test be-common    # unit tests (integration tests too when GROCERY_DATABASE_URL and NATS_URL are set)
npx nx build be-common
```
