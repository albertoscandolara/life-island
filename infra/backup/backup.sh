#!/bin/sh
# Encrypted backups of the island (docs/guides/publishing.md#backups).
#
#   island-backup                   every day at BACKUP_TIME (the `backup` service)
#   island-backup now               one backup now
#   island-backup list              the backups in /backups
#   island-backup restore-db <stamp>     the database, from <stamp>-database.dump.gpg
#   island-backup restore-files <stamp>  the files, from <stamp>-files.tar.gpg, into /storage-restore
#                                   (the storage volume, mounted writable, storage stopped)
#
# Each backup is two files in /backups (BACKUP_DIR on the machine), encrypted with
# BACKUP_PASSPHRASE (AES-256, gpg): life-island-<stamp>-database.dump.gpg (pg_dump)
# and life-island-<stamp>-files.tar.gpg (the storage volume). They are safe to copy
# to any cloud drive; without the passphrase they cannot be read, or restored.
set -eu
umask 077

BACKUPS=/backups
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

passphrase_file() {
  if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
    echo "BACKUP_PASSPHRASE must be set, at least 20 characters (npm run secrets:new)." >&2
    exit 1
  fi
  umask 077
  printf '%s' "$BACKUP_PASSPHRASE" > /tmp/backup-passphrase
  echo /tmp/backup-passphrase
}

encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS" \
    --symmetric --cipher-algo AES256 --output "$1"
}

decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS" --decrypt "$1"
}

backup_now() {
  stamp=$(date +%Y-%m-%d_%H%M)
  db="$BACKUPS/life-island-$stamp-database.dump.gpg"
  files="$BACKUPS/life-island-$stamp-files.tar.gpg"
  pg_dump --format=custom | encrypt "$db.partial"
  tar -C /storage -cf - . | encrypt "$files.partial"
  mv "$db.partial" "$db"
  mv "$files.partial" "$files"
  find "$BACKUPS" -maxdepth 1 -name 'life-island-*.gpg' -mtime "+$KEEP_DAYS" -delete
  find "$BACKUPS" -maxdepth 1 -name '*.partial' -mmin +720 -delete
  echo "backup: $(basename "$db"), $(basename "$files")"
}

seconds_until() {
  now=$(date +%s)
  next=$(date -d "today $1" +%s)
  [ "$next" -gt "$now" ] || next=$(date -d "tomorrow $1" +%s)
  echo $((next - now))
}

PASS=$(passphrase_file)
case "${1:-schedule}" in
  schedule)
    echo "backup: every day at ${BACKUP_TIME:-03:30}, kept $KEEP_DAYS days"
    while true; do
      sleep "$(seconds_until "${BACKUP_TIME:-03:30}")"
      backup_now || echo "backup: FAILED, see above" >&2
    done
    ;;
  now) backup_now ;;
  list) ls -lh "$BACKUPS" | grep 'life-island-' || echo "no backups yet" ;;
  restore-db)
    file="$BACKUPS/life-island-${2:?which backup? e.g. 2026-11-20_0330}-database.dump.gpg"
    decrypt "$file" | pg_restore --clean --if-exists --exit-on-error -d "$PGDATABASE"
    echo "restore: database from $(basename "$file")"
    ;;
  restore-files)
    file="$BACKUPS/life-island-${2:?which backup? e.g. 2026-11-20_0330}-files.tar.gpg"
    # The storage volume, mounted writable at /storage-restore for this run only.
    target=/storage-restore
    if [ ! -d "$target" ] || ! touch "$target/.restore-check" 2>/dev/null; then
      echo "Mount the storage volume writable at $target (docs/guides/publishing.md#backups)." >&2
      exit 1
    fi
    decrypt "$file" > /tmp/files.tar
    find "$target" -mindepth 1 -delete
    tar -C "$target" -xf /tmp/files.tar
    rm /tmp/files.tar
    echo "restore: files from $(basename "$file")"
    ;;
  *) echo "usage: island-backup [now|list|restore-db <stamp>|restore-files <stamp>]" >&2; exit 2 ;;
esac
