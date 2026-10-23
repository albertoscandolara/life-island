# Storage and gateway

## Object storage (S3)

Uploaded files never go into the database or through the API. The browser uploads them straight to S3-compatible storage with a short-lived **presigned URL** that the ingestion service creates, and the database keeps only metadata (key, size, MIME type, SHA-256).

| Environment | Provider                                                      | Endpoint                |
| ----------- | ------------------------------------------------------------- | ----------------------- |
| Local       | [SeaweedFS](https://github.com/seaweedfs/seaweedfs) in Docker | `http://localhost:8333` |
| Production  | Cloudflare R2                                                 | Set by `S3_ENDPOINT`    |

Because both speak the S3 API, code uses the AWS SDK (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, wrapped by `ObjectStorage` in `@life-island/be-common`) and only the endpoint and credentials change. R2 has no egress fees and a free tier that covers a personal archive, which is why it is the production choice; any S3-compatible store (AWS S3, Backblaze B2, MinIO) works by changing the variables below.

### Local setup

The `storage` container runs `weed server -s3` with all SeaweedFS parts (master, volume, filer and S3 gateway) in one process, data in the `storage-data` volume and a 1 GB volume size limit.

Credentials come from `infra/seaweedfs/s3.json`:

| Setting               | Value                                            |
| --------------------- | ------------------------------------------------ |
| Access key            | `dev_access_key`                                 |
| Secret key            | `dev_secret_key`                                 |
| Region                | any (e.g. `us-east-1`)                           |
| Path-style addressing | required (`forcePathStyle: true` in the AWS SDK) |

Anonymous requests get `403`, which shows authentication is on. To try it with the AWS CLI:

```sh
export AWS_ACCESS_KEY_ID=dev_access_key AWS_SECRET_ACCESS_KEY=dev_secret_key AWS_REGION=us-east-1
aws --endpoint-url http://localhost:8333 s3 mb s3://uploads
aws --endpoint-url http://localhost:8333 s3 cp ./receipt.jpg s3://uploads/
aws --endpoint-url http://localhost:8333 s3 ls s3://uploads/
```

`svc-ingestion` creates the `S3_BUCKET` bucket (default `uploads`) at startup and sets its CORS rules from `STORAGE_CORS_ORIGINS`, so browsers on those origins can PUT files with presigned URLs. Objects are stored as `YYYY/MM/<uploadId>/<filename>`; the database row keeps that key, and `GET /api/ingestion/uploads/:id/file` redirects to a presigned GET for it.

| Variable                                                   | Meaning                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `S3_ENDPOINT`                                              | Where services reach storage                                                   |
| `S3_PUBLIC_ENDPOINT`                                       | Host put in presigned URLs, which the browser opens; defaults to `S3_ENDPOINT` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_BUCKET` | Credentials, region (`auto` on R2) and bucket                                  |
| `STORAGE_CORS_ORIGINS`                                     | Comma-separated origins allowed to upload from the browser                     |

For R2: create a bucket and an API token with object read and write, then set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto` and the token's keys. R2 also supports bucket CORS, which the service sets for you.

## Gateway (Caddy)

The front end talks to exactly one origin. Caddy receives every request and forwards `/api/<service>/*` to the right service, removing the prefix:

| Path               | Forwarded to             | Example                                                 |
| ------------------ | ------------------------ | ------------------------------------------------------- |
| `/healthz`         | answered by Caddy (`ok`) |                                                         |
| `/api/ingestion/*` | `svc-ingestion:3000`     | `/api/ingestion/uploads` → `svc-ingestion:3000/uploads` |
| `/api/review/*`    | `svc-review:3000`        |                                                         |
| `/api/groceries/*` | `svc-groceries:3000`     |                                                         |
| `/api/tax730/*`    | `svc-tax730:3000`        |                                                         |
| anything else      | answered by Caddy        | Will serve the shell once it exists                     |

Services are reached by their Compose service name on port 3000. Until a service exists, its route answers `502`; that is expected.

The configuration is `infra/caddy/Caddyfile`. Its admin API is off. To add a service, add a `handle_path /api/<service>/* { reverse_proxy svc-<service>:3000 }` block and restart the gateway:

```sh
docker compose --project-directory . -f infra/docker-compose.yml restart gateway
```

In production the same Caddyfile gains a real site address, and Caddy obtains HTTPS certificates automatically. Authentication (OIDC with Keycloak or Zitadel) is planned at the gateway, so services receive only authenticated requests.
