# Gateway (Caddy)

One origin for the front end: `/api/<service>/` goes to each service, and
`/healthz` answers without sign-in so health checks keep working.

## Sign-in

The services have no login of their own; the gateway is the door. Pick a mode
with `GATEWAY_AUTH` in `.env`. It has no default: when it is missing the
gateway refuses to start, so a forgotten setting never publishes the island
without sign-in.

| Value   | Effect                                                                 |
| ------- | ---------------------------------------------------------------------- |
| `off`   | No sign-in. Only on your own machine (the default for development).    |
| `basic` | HTTP basic auth for every route but `/healthz`; the browser asks once. |

For `basic`, set a user and a bcrypt hash of the password:

```sh
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'your password'
# then in .env (quote the hash: it contains $ signs)
GATEWAY_AUTH=basic
GATEWAY_USER=you
GATEWAY_PASSWORD_HASH='$2a$14$...'
```

Basic auth is only safe over HTTPS: in production put the gateway behind TLS
(Caddy does it automatically for a real domain name). Do not publish the
service ports (3000-3004) outside the machine; only the gateway should be
reachable. A single-sign-on provider (OIDC) can replace this later without
changing the services.

## Hardening

Every answer gets the browser security headers (HSTS, `nosniff`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, COOP) and loses the
`Server` header. Identity and internal headers a client sends (`X-User-Id`,
`X-User-Role`, `X-Internal-Token`) are dropped before a service sees them, and
bodies over 26 MB are refused. The gateway and storage ports listen on
`127.0.0.1` unless `GATEWAY_BIND` / `STORAGE_BIND` say otherwise; Postgres and
NATS are never published. See [docs/security.md](../../docs/security.md).
