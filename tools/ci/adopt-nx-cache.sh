#!/usr/bin/env bash
# Nx keeps its cache index in .nx/workspace-data/<machine-id>-<version>.db.
# A GitHub runner gets a new machine id on every run, so a restored index is
# ignored unless it is renamed to this runner's id.
set -euo pipefail

dir="${NX_WORKSPACE_DATA_DIRECTORY:-.nx/workspace-data}"
machine_id="$(cat /etc/machine-id)"
shopt -s nullglob

for db in "$dir"/*.db; do
  name="$(basename "$db")"
  case "$name" in
    "$machine_id"-*) continue ;;
  esac
  target="$dir/$machine_id-${name#*-}"
  echo "Using the restored Nx cache index $name"
  mv -f "$db" "$target"
done
