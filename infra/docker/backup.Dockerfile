# Nightly encrypted backups (infra/backup/backup.sh): pg_dump from the same Postgres
# version as the database, and gpg for the encryption.
FROM pgvector/pgvector:pg17
RUN apt-get update \
  && apt-get install -y --no-install-recommends gnupg \
  && rm -rf /var/lib/apt/lists/*
COPY infra/backup/backup.sh /usr/local/bin/island-backup
ENTRYPOINT ["island-backup"]
