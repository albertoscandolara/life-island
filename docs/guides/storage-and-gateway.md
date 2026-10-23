# Storage and gateway

## Object storage (S3)

Uploaded files never go into the database or through the API. The browser uploads them straight to S3-compatible storage with a short-lived **presigned URL** that the ingestion service creates, and the database keeps only metadata (key, size, MIME type, SHA-256).

| Environment | Provider                                                      | Endpoint                |
| ----------- | ------------------------------------------------------------- | ----------------------- |
| Local       | [SeaweedFS](https://github.com/seaweedfs/seaweedfs) in Docker | `http://localhost:8333` |
| Production  | Cloudflare R2                                                 | Set by `S3_ENDPOINT`    |

Because both speak the S3 API, code uses the AWS SDK (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, added with the upload flow in Week 3) and only the endpoint and credentials change.

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

No bucket exists yet. The ingestion service will create its bucket at startup in Week 3, when the presigned upload flow described in [architecture.md](../architecture.md#upload-flow-presigned-urls-files-never-pass-through-the-api) is built.

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
