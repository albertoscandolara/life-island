# Security

Life Island holds the most sensitive papers of a household: ID documents, payslips, bills, tax returns, health results. This document is the security review done before publishing the app, what is already in place, and what is still to build. Every new service and route follows the rules at the end.

## What we protect, and from whom

| Asset                                                      | Where it lives                                       |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| Original documents (IDs, payslips, bills, medical results) | Object storage (SeaweedFS locally, R2 in production) |
| Data read from them, and everything typed in the areas     | Postgres, one schema per service                     |
| The Claude API key, and the money it can spend             | Server environment only                              |
| Storage, database and NATS credentials                     | Server environment only                              |

The threats that matter for a published personal app: a stranger on the internet reaching any page, API or file; a link to a file being guessed or leaked; a script on another site acting with your signed-in browser (CSRF); someone spending your Claude budget; a misconfigured deploy that runs with development defaults.

## Review findings

| #   | Finding                                                                                                                                                        | Risk     | Status                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | The gateway's sign-in defaulted to `off`, so a missing setting published everything without a login                                                            | Critical | **Fixed**: `GATEWAY_AUTH` has no default; unset, the gateway refuses to start                                   |
| 2   | Postgres, NATS, storage and the gateway were bound to every network interface                                                                                  | Critical | **Fixed**: bound to `127.0.0.1`; only the gateway and storage can be opened, explicitly                         |
| 3   | Services fall back to the dev database passwords and storage keys when an env var is missing                                                                   | High     | **Fixed**: in production (`NODE_ENV=production`, set by the image) a service with a dev secret refuses to start |
| 4   | No security headers on any answer (HSTS, nosniff, framing, referrer)                                                                                           | High     | **Fixed** at the gateway and in every service                                                                   |
| 5   | Writes had no cross-site check (CSRF once a session cookie exists)                                                                                             | High     | **Fixed**: every service refuses writes a browser sends from another site                                       |
| 6   | No rate limits                                                                                                                                                 | High     | **Fixed** per client and service (`RATE_LIMIT_PER_MINUTE`); login gets its own stricter limit with sign-in      |
| 7   | Services trust any caller: anyone who reaches a service port reads everything; basic auth is the only door and has no lockout, 2FA or logout                   | Critical | Planned: sign-in with sessions (below)                                                                          |
| 8   | `GET /uploads/:id/file` hands out a presigned storage link that works for anyone holding it for 5 minutes                                                      | Medium   | Planned: links only for signed-in users, 60 seconds, files streamed through the API                             |
| 9   | The monthly AI budget is enforced after the fact (usage reaches Settings through events), so a burst of requests can overspend; no per-minute or per-user caps | High     | Planned: AI cost guards (below)                                                                                 |
| 10  | Identity headers from clients (`X-User-Id`) could be forwarded once services read them                                                                         | Medium   | **Fixed** ahead of time: the gateway drops them                                                                 |
| 11  | No CORS: no service sends `Access-Control-Allow-Origin`                                                                                                        | —        | Correct as is: pages on other sites cannot read answers. Keep it off                                            |

## In place

- **Gateway** (`infra/caddy/Caddyfile`): sign-in mode required, security headers, `Server` header removed, client identity headers dropped, bodies over 26 MB refused.
- **Every service** (`applyHttpSecurity` in `libs/be-nest`, called in each `bootstrap.ts`): `nosniff`, `no-referrer`, `SAMEORIGIN` framing, `Cache-Control: no-store` (personal data never cached), `x-powered-by` off, cross-site write check through `Sec-Fetch-Site`, per-client rate limit, and the production dev-secret check (`refuseDevSecretsInProduction` in `libs/be-common`, also called by the parse worker).
- **Storage**: the bucket is private (no public policy); files are streamed through `svc-ingestion` for preview and download.
- **Ports**: Postgres and NATS listen on `127.0.0.1` only. The gateway and storage too, unless `GATEWAY_BIND` / `STORAGE_BIND` open them on a server.

## Planned

### Sign-in

Built into the island, with no outside provider to sign up for:

- A small auth service with its own schema: accounts with an Argon2id password hash and a TOTP second factor, lockout after failed attempts, sessions stored as hashes.
- A `__Host-` session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, with idle and absolute expiry, and sign-out everywhere.
- The gateway asks the auth service about every request (`forward_auth`) and passes the verified user to the service with a shared internal secret; services refuse requests without it, so a leaked port is not a way in.
- A login page in both apps.
- **Skipping sign-in on your own machine**: `AUTH_DEV_BYPASS=true` signs you in as the local owner. It works only when `NODE_ENV=development` is set explicitly; with any other value, or in the production image, the service refuses to start. Fail closed: forgetting it means a login page, never an open island.

### AI cost guards

- The monthly budget checked **before** each call, with the cost of the call reserved first, so parallel requests cannot overspend.
- Per-user daily caps and per-minute limits on every AI tool, and a ceiling on `max_tokens` and web searches per call.
- The Claude key only ever on the server, stored encrypted at rest; never sent to the browser or written to logs.

### Documents

- Presigned links only for a signed-in user, valid 60 seconds; preview and download stay streamed through the API.
- Server-side encryption of the bucket in production (R2 encrypts at rest by default), and encrypted Postgres backups.

## Rules for new code

1. Every new service calls `applyHttpSecurity(app, { service, config })` in its bootstrap.
2. No secret has a production default. A local default is fine only if it matches a dev pattern the production check knows (`dev_*` passwords, the SeaweedFS dev keys).
3. Never send `Access-Control-Allow-Origin`. The front end reaches services on its own origin.
4. Files leave only through an authorised API route; never make a bucket or object public.
5. Never log document contents, extracted personal data or keys.
6. Every model call goes through `AiAssistant` (docs/guides/ai-tools.md), so the cost guards apply to it.

## Publishing checklist

- [ ] `.env` has real, unique passwords for Postgres, every service role and storage; no `dev_` value left.
- [ ] `GATEWAY_AUTH` is not `off`; the gateway is behind HTTPS (Caddy does it for a real domain).
- [ ] Only the gateway (and, if needed, storage for direct uploads) is reachable from the internet: `GATEWAY_BIND=0.0.0.0`, a firewall closing every other port.
- [ ] `STORAGE_CORS_ORIGINS` lists only the published origin.
- [ ] The monthly AI budget is set in Settings, and a spending limit is set on the Claude Console as a last line.
- [ ] Backups are encrypted and a restore was tested.
