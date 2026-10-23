# contracts

Zod contracts shared by every app: versioned contract names (`grocery.receipt@1`), the event envelope, and the NATS subject for each event type.

Import it as `@life-island/contracts`. How it works and how to use it: [Events and the outbox](../../docs/guides/events-and-outbox.md).

```sh
npx nx test contracts    # unit tests
npx nx build contracts
```
