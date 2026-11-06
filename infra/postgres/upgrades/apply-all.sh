#!/bin/sh
# Applies every upgrade in this folder, in order, stopping at the first error.
# Run inside the postgres container by `npm run db:upgrade`; it lives in a file
# so the npm script needs no shell quoting (cmd.exe on Windows has none).
set -e
for f in /upgrades/*.sql; do
  psql -U postgres -d life_island -v ON_ERROR_STOP=1 -q -f "$f"
done
