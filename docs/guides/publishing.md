# Publishing the island

How to run Life Island on a machine that stays on, reachable from your phone and laptop, with nothing but free tools. The security it relies on is in [Security](../security.md); this guide is the steps.

## What runs where

One machine runs everything with Docker Compose, the same file as on your computer (`infra/docker-compose.yml`, profile `apps`):

| Part       | What it is                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `gateway`  | Caddy: the only door. Serves the pages, forwards `/api/<service>/*`, passes file links to storage |
| `site`     | Builds the pages (shell, documents app, every area) into the `site` volume, then exits            |
| `svc-*`    | The services, each with its own database role and password                                        |
| `postgres` | The database                                                                                      |
| `storage`  | SeaweedFS, the files. Reached only through the gateway: no port of its own                        |
| `nats`     | The event bus                                                                                     |
| `backup`   | Every night, an encrypted copy of the database and the files in `BACKUP_DIR`                      |

About 3–4 GB of memory for the whole island; 8 GB on the machine is comfortable.

## Choose how people reach it

| Option                                 | Cost                 | Who can reach the sign-in page                             | HTTPS by                                                        |
| -------------------------------------- | -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **Tailscale** (recommended)            | Free (personal plan) | Only devices you add to your tailnet                       | `tailscale serve`, a `*.ts.net` address with a real certificate |
| Cloudflare Tunnel                      | Free, plus a domain  | Anyone on the internet (add Cloudflare Access to limit it) | Cloudflare                                                      |
| Your own domain, ports 80 and 443 open | A domain (~€10/year) | Anyone on the internet                                     | Caddy, with Let's Encrypt                                       |

With Tailscale the island is not on the internet at all: a stranger cannot even see the sign-in page. For a household's IDs, payslips and medical results that is the safest choice, and nothing on the machine listens beyond `127.0.0.1`.

The machine can be a computer at home that stays on (an old laptop, a mini PC), or a free cloud machine. Oracle Cloud's Always Free tier (Ampere A1, up to 4 cores and 24 GB) fits; Oracle may reclaim an idle free machine, which switching the account to Pay As You Go prevents while it stays free inside the limits.

## Steps

### 1. Prepare the machine

1. Install Docker (with Compose) and git.
2. Install Tailscale and sign in; install it on your phone and laptop too, with the same account. In the admin console turn on **HTTPS certificates** (DNS → HTTPS Certificates). The machine's address is `https://<machine>.<tailnet>.ts.net`; `tailscale status` shows it.
3. Clone the repository on the machine.

### 2. Make the settings

```sh
npm run env:production -- https://<machine>.<tailnet>.ts.net
mv .env.production .env
```

Without Node on the machine, run it on your computer and copy the file over (`scp`).

`env:production` writes every secret as a new random value: Postgres and each service role, the storage keys, `INTERNAL_TOKEN`, `AUTH_ENCRYPTION_KEY`, the one-time `AUTH_SETUP_TOKEN` and `BACKUP_PASSPHRASE`. It sets `NODE_ENV=production`, `GATEWAY_AUTH=session`, the island's address (`APP_URL`, `S3_PUBLIC_ENDPOINT`) and leaves out `AUTH_DEV_BYPASS`. Then fill in yourself:

- `ANTHROPIC_API_KEY`, if you use the AI tools; and the limits under "AI spending guard" if the defaults ($25 a month, $5 a day per person) do not fit.
- `SMTP_URL` and `MAIL_FROM` for the Agenda's email digest. Gmail works for free with an app password: `SMTP_URL=smtps://you%40gmail.com:<app-password>@smtp.gmail.com:465`.
- `BACKUP_DIR`, if backups should go somewhere other than `./backups`.

**Copy the file into a password manager.** `BACKUP_PASSPHRASE` is the only way to open a backup, and `AUTH_ENCRYPTION_KEY` the only way to read the two-factor seeds.

### 3. Start the island

```sh
docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build
```

The first build takes a while (every service and the pages). Then publish it on your tailnet, with HTTPS:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

### 4. First visit

1. Open `https://<machine>.<tailnet>.ts.net/sign-in` and create the owner account with the code in `AUTH_SETUP_TOKEN`.
2. Set up two-factor sign-in with an authenticator app (it is required).
3. Remove `AUTH_SETUP_TOKEN` from `.env` and restart `svc-auth`:
   `docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d svc-auth`.
4. Invite the people of the household from the Account page. Each one needs Tailscale on their device, invited to your tailnet (Tailscale admin → Users → Invite).

### 5. Last checks

- On the [Claude Console](https://console.anthropic.com/), set a monthly spend limit on the key: the last line behind the island's own caps.
- `docker compose ... exec backup island-backup now` makes a backup at once; see it with `island-backup list`, and try a restore (below) once.
- Copy `BACKUP_DIR` off the machine now and then (a cloud drive, a USB disk): the files are encrypted, so any drive will do.
- Go through the publishing checklist at the end of [Security](../security.md).

## Updating

```sh
git pull
docker compose --project-directory . -f infra/docker-compose.yml --profile apps up -d --build
```

The `site` service rebuilds the pages and copies them in; services run their own database migrations at start.

## Backups

The `backup` service writes two files every night at `BACKUP_TIME` (03:30), and deletes those older than `BACKUP_KEEP_DAYS` (14):

- `life-island-<stamp>-database.dump.gpg`: the whole database (`pg_dump`).
- `life-island-<stamp>-files.tar.gpg`: every uploaded file.

Both are encrypted with `BACKUP_PASSPHRASE` (gpg, AES-256). The script is `infra/backup/backup.sh`.

Restore, from the repository folder (`C` is the long Compose command above):

```sh
C="docker compose --project-directory . -f infra/docker-compose.yml --profile apps"
$C exec backup island-backup list
# The database: services stopped, so nothing writes meanwhile.
$C stop $(echo svc-ingestion svc-review svc-groceries svc-tax730 svc-home svc-people svc-cars svc-work svc-settings svc-studies svc-agenda svc-money svc-goals svc-health svc-subscriptions svc-travel svc-fitness svc-dreams svc-auth svc-parse-worker)
$C exec backup island-backup restore-db 2026-11-20_0330
# The files: storage stopped, its volume mounted writable for the restore.
$C stop storage
$C run --rm --no-deps -v life-island_storage-data:/storage-restore backup restore-files 2026-11-20_0330
$C up -d
```

On a new machine: clone, put the same `.env` back, start the island once, then restore as above.

## Other ways in

**Cloudflare Tunnel.** Keep `SITE_ADDRESS=:80` and `GATEWAY_BIND=127.0.0.1`, create a tunnel in Cloudflare Zero Trust to `http://localhost:8080` with your hostname, and run `cloudflared` on the machine. The island is then public: put a Cloudflare Access policy (free up to 50 people) on the hostname so only your emails reach the sign-in page.

**Your own domain.** Point the domain's DNS at the machine, set `SITE_ADDRESS=island.example.com`, `GATEWAY_BIND=0.0.0.0`, `GATEWAY_PORT=80`, `GATEWAY_HTTPS_PORT=443`, open ports 80 and 443 in the firewall (and only those), and start the island. Caddy gets and renews the certificate itself.

## Settings for publishing

| Variable                                                             | Meaning                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`                                                       | `:80` (default) behind Tailscale serve or a tunnel; a domain for Caddy's own HTTPS                                            |
| `GATEWAY_BIND`, `GATEWAY_PORT`, `GATEWAY_HTTPS_PORT`                 | Where the gateway listens. `127.0.0.1` (default) unless people reach the machine directly                                     |
| `APP_URL`, `S3_PUBLIC_ENDPOINT`                                      | The island's address, as people open it                                                                                       |
| `DB_PASSWORD_<ROLE>`                                                 | Each service role's database password. Set at the database's creation; `npm run db:passwords` changes them on an existing one |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                     | Storage keys, given to SeaweedFS at start                                                                                     |
| `BACKUP_PASSPHRASE`, `BACKUP_DIR`, `BACKUP_TIME`, `BACKUP_KEEP_DAYS` | Backups                                                                                                                       |
| `SITE_DIR`                                                           | Serve pages from a folder instead of the `site` volume (`./dist/site` after `npm run site:build`)                             |
