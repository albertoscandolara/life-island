#!/bin/sh
# Gives each service role the password from DB_PASSWORD_<NAME> (docs/guides/publishing.md).
# Runs once when the database is created, after 01 made the roles with their dev
# passwords; `npm run db:passwords` runs it again on an existing database.
# A role whose variable is empty keeps its dev password, which a service refuses
# in production (refuseDevSecretsInProduction), so a forgotten one never goes unnoticed.
# The init entrypoint may source this file rather than run it, so the work happens in a
# subshell: its `set -eu` and variables never leak into the entrypoint.
(
set -eu

changed=0
for name in ingestion review grocery tax730 home people cars work settings studies \
  agenda money goals health subscriptions travel fitness dreams auth; do
  var="DB_PASSWORD_$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  value=$(printenv "$var" || true)
  [ -n "$value" ] || continue
  # psql quotes the role and the password itself (:"role", :'password').
  echo 'alter role :"role" password :'"'"'password'"'"';' | psql -v ON_ERROR_STOP=1 -q \
    -U "${POSTGRES_USER:-postgres}" -d life_island \
    -v role="${name}_svc" -v password="$value"
  changed=$((changed + 1))
done
echo "role passwords: $changed set from DB_PASSWORD_*"
)
