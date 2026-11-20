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

| #   | Finding                                                                                                                                                           | Risk     | Status                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | The gateway's sign-in defaulted to `off`, so a missing setting published everything without a login                                                               | Critical | **Fixed**: `GATEWAY_AUTH` has no default; unset, the gateway refuses to start                                    |
| 2   | Postgres, NATS, storage and the gateway were bound to every network interface                                                                                     | Critical | **Fixed**: bound to `127.0.0.1`; only the gateway and storage can be opened, explicitly                          |
| 3   | Services fall back to the dev database passwords and storage keys when an env var is missing                                                                      | High     | **Fixed**: in production (`NODE_ENV=production`, set by the image) a service with a dev secret refuses to start  |
| 4   | No security headers on any answer (HSTS, nosniff, framing, referrer)                                                                                              | High     | **Fixed** at the gateway and in every service                                                                    |
| 5   | Writes had no cross-site check (CSRF once a session cookie exists)                                                                                                | High     | **Fixed**: every service refuses writes a browser sends from another site                                        |
| 6   | No rate limits                                                                                                                                                    | High     | **Fixed** per client and service (`RATE_LIMIT_PER_MINUTE`); login gets its own stricter limit with sign-in       |
| 7   | Services trust any caller: anyone who reaches a service port reads everything; basic auth is the only door and has no lockout, 2FA or logout                      | Critical | **Fixed**: sign-in with password, two-factor and sessions; every service checks it (below)                       |
| 8   | `GET /uploads/:id/file` hands out a presigned storage link that works for anyone holding it for 5 minutes                                                         | Medium   | **Fixed**: the route needs sign-in and links last 60 seconds; preview and download are streamed                  |
| 9   | The monthly AI budget was enforced after the fact (usage reaches Settings through events), so a burst of requests could overspend; no per-minute or per-user caps | High     | **Fixed**: every model call reserves its worst-case cost first, with monthly, per-user and per-call caps (below) |
| 10  | Identity headers from clients (`X-User-Id`) could be forwarded once services read them                                                                            | Medium   | **Fixed** ahead of time: the gateway drops them                                                                  |
| 11  | No CORS: no service sends `Access-Control-Allow-Origin`                                                                                                           | —        | Correct as is: pages on other sites cannot read answers. Keep it off                                             |

## In place

- **Gateway** (`infra/caddy/Caddyfile`): `GATEWAY_AUTH` required (an optional extra door in front of sign-in), security headers, `Server` header removed, client identity headers dropped, bodies over 26 MB refused.
- **Every service** (`applyHttpSecurity` in `libs/be-nest`, called in each `bootstrap.ts`): `nosniff`, `no-referrer`, `SAMEORIGIN` framing, `Cache-Control: no-store` (personal data never cached), `x-powered-by` off, cross-site write check through `Sec-Fetch-Site`, per-client rate limit, and the production dev-secret check (`refuseDevSecretsInProduction` in `libs/be-common`, also called by the parse worker).
- **Storage**: the bucket is private (no public policy); files are streamed through `svc-ingestion` for preview and download, after sign-in. Presigned links (`/file`, uploads) are handed only to a signed-in person; a download link lasts 60 seconds.
- **Ports**: Postgres and NATS listen on `127.0.0.1` only. The gateway and storage too, unless `GATEWAY_BIND` / `STORAGE_BIND` open them on a server. Published, storage needs no port: presigned links go through the gateway (`S3_PUBLIC_ENDPOINT` is the island's address), which drops cookies on that route.
- **Secrets**: every database role password (`DB_PASSWORD_<ROLE>`) and the storage keys come from `.env`; `npm run env:production` writes all of them as new random values ([Publishing](guides/publishing.md)).
- **Pages**: the gateway serves them with a Content-Security-Policy that loads code only from the island itself.
- **Backups**: the `backup` service writes an encrypted copy (gpg, AES-256, `BACKUP_PASSPHRASE`) of the database and the files every night.

## Sign-in

Built into the island (`apps/svc-auth`, schema `auth`), with no outside provider to sign up for. One household: the owner, and the people the owner invites; everyone sees the same island, only the owner manages people.

| Piece       | How                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords   | scrypt (memory-hard, Node's own crypto), at least 12 characters, never the email. Unknown emails take as long as known ones                                                                                             |
| Two-factor  | TOTP from any authenticator app, ±30 s for clock drift, each code once. Seeds encrypted at rest with AES-256-GCM (`AUTH_ENCRYPTION_KEY`). Required for every account in production (`AUTH_REQUIRE_TWO_FACTOR`)          |
| Sessions    | 256-bit random token in a `__Host-li_session` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`); only its SHA-256 is stored. Ends after 12 idle hours or 30 days; password change and "sign out everywhere" end them all |
| Brute force | 10 attempts a minute per address on every route that checks a secret; 5 wrong passwords or codes lock the account for 15 minutes                                                                                        |
| First owner | `/sign-in` offers to create the owner only while there is no account, and only with `AUTH_SETUP_TOKEN` from the server. Remove it afterwards                                                                            |
| Invites     | The owner creates a one-time link (7 days, only its hash stored) on the Account page and sends it; removing a person ends their sessions at once                                                                        |
| Audit       | Sign-ins, failures, locks, password and two-factor changes, invites in `auth.audit`, with the address                                                                                                                   |

**Every service checks every request** (`requireSignIn` in `libs/be-nest`, applied by `applyHttpSecurity`): a browser request needs a session cookie svc-auth vouches for (asked over `GET /session`, remembered 30 seconds); a call from another service needs `INTERNAL_TOKEN` in `X-Internal-Token` (`internalHeaders()` from `libs/be-common`, and the gateway drops that header from clients). Anything else answers 401, and 503 if svc-auth cannot be reached. A leaked service port is not a way in. The handler reads the person with `currentUser()`.

**One route answers without sign-in: the Agenda's private calendar link** (`GET /api/agenda/calendar/feed/<secret>.ics`), because calendar apps cannot sign in. It carries a 256-bit secret, of which only the SHA-256 is stored; only `GET` of exactly that shape passes (`openPaths` in `applyHttpSecurity`, and its own block in the Caddyfile that skips `GATEWAY_AUTH`); any other secret answers 404; a new link or turning it off stops the old one at once. It shows dates only (titles, areas, amounts), never documents or personal data. See [Calendar link](guides/calendar-feed.md). A new open path needs the same: a secret checked by the route, the narrowest regex, and a line here.

The front end (`libs/auth-ui`): the sign-in page (sign-in, two-factor code, first owner, invite, two-factor setup), a guard on every route of both apps, an interceptor that sends a 401 back to sign-in, and the Account page (sign out, sign out everywhere, password, two-factor, people and invites).

### Skipping sign-in on your own machine

`AUTH_DEV_BYPASS=true` signs you in as the local owner, with no login page. It fails closed:

- it works only with `NODE_ENV=development` (or `test`, for the integration tests); with any other value, unset included, and in the service image (`NODE_ENV=production`), every service **refuses to start**;
- without it, services need `INTERNAL_TOKEN` or refuse to start; forgetting both stops the island, it never opens it;
- with it and no `INTERNAL_TOKEN`, services call each other with the fixed `DEV_INTERNAL_TOKEN`, which a service accepts only while it runs the bypass with no token of its own. Without that, internal-only routes such as the AI spending guard refused them and every AI feature quietly ran on its own rules.

To try the real sign-in locally, set `AUTH_DEV_BYPASS=false`, `INTERNAL_TOKEN`, `AUTH_ENCRYPTION_KEY` and `AUTH_SETUP_TOKEN` in `.env`, restart, and open `/sign-in`.

## AI spending

Every model call goes through `AiAssistant` (the parse worker through `GatedAnalyzer`), which asks svc-settings to **reserve** the call's worst-case cost before calling Claude (input tokens, `max_tokens` and web searches at list price) and **settles** the real cost afterwards. svc-settings takes a lock for each reservation, so parallel requests cannot pass the limit together.

| Limit                | Env (svc-settings)    | Default |
| -------------------- | --------------------- | ------- |
| Whole island, month  | `AI_HARD_MONTHLY_USD` | $25     |
| One person, day      | `AI_USER_DAILY_USD`   | $5      |
| One person, minute   | `AI_USER_PER_MINUTE`  | 6 calls |
| One person, hour     | `AI_USER_PER_HOUR`    | 60      |
| One call, worst case | `AI_MAX_CALL_USD`     | $3      |

- The monthly ceiling is the lower of `AI_HARD_MONTHLY_USD` and the Settings budget when its stop is on. The limits live in the server environment so that a signed-in browser cannot raise them.
- A refused call answers 429 with the reason; the parse worker reads the document without AI. If svc-settings cannot be reached, calls are refused (fail closed).
- The reserve and settle routes accept only `INTERNAL_TOKEN`; `GET /api/settings/ai-guard` shows the limits and what is spent.
- **One Claude key, on the server.** The island is one household, so there is no per-person key: the key is read from the server environment only, never stored in the database, sent to the browser or written to logs. Per-person caps stop one account from spending for everyone. Set a spending limit on the Claude Console too, as the last line.

## Planned

### Documents

- Encryption at rest of the files and the database on the island's own disk. Until then, use full-disk encryption on the machine (FileVault, BitLocker, LUKS); R2 encrypts at rest by default.

## Rules for new code

1. Every new service calls `applyHttpSecurity(app, { service, config })` in its bootstrap, which also puts it behind sign-in.
2. Every call to another service spreads `internalHeaders()` into its headers; never send it to an outside URL.
3. No secret has a production default. A local default is fine only if it matches a dev pattern the production check knows (`dev_*` passwords, the SeaweedFS dev keys).
4. Never send `Access-Control-Allow-Origin`. The front end reaches services on its own origin.
5. Files leave only through an authorised API route; never make a bucket or object public.
6. Never log document contents, extracted personal data or keys.
7. Every model call goes through `AiAssistant` (docs/guides/ai-tools.md), so the spending guard applies to it.

## Publishing checklist

- [ ] `.env` comes from `npm run env:production`: real, unique passwords for Postgres, every service role and storage, `INTERNAL_TOKEN`, `AUTH_ENCRYPTION_KEY`, `AUTH_SETUP_TOKEN` (first visit only) and `BACKUP_PASSPHRASE`; no `dev_` value and no `AUTH_DEV_BYPASS` left. A copy is in a password manager.
- [ ] The owner account has two-factor sign-in on; `AUTH_SETUP_TOKEN` was removed after creating it.
- [ ] `GATEWAY_AUTH=session` (or `basic` for a second password); the island is opened only over HTTPS (Tailscale serve, a tunnel, or Caddy with `SITE_ADDRESS` set to the domain).
- [ ] With Tailscale: `tailscale serve`, never `funnel`; the access policy lets members reach only the island's port 443; key expiry is off for the island's machine.
- [ ] Only the gateway is reachable, and only by the people it is for: with Tailscale nothing listens beyond `127.0.0.1`; with a domain, `GATEWAY_BIND=0.0.0.0` and a firewall that opens 80 and 443 only. Storage stays closed.
- [ ] `AI_HARD_MONTHLY_USD` and the per-person limits fit your budget; the monthly AI budget is set in Settings, and a spending limit is set on the Claude Console as a last line.
- [ ] `island-backup list` shows a backup, a restore was tested, and `BACKUP_DIR` is copied off the machine now and then.
- [ ] The machine's disk is encrypted.
