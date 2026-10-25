#!/bin/sh
set -eu
umask 077
: "${PGSERVICE:?}" "${PGPASSFILE:?}" "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}" "${DIM_STORAGE_SOURCE:?}" "${BACKUP_WORKDIR:?}"
# DIM_STORAGE_SOURCE is an authenticated rclone remote pointing to the private bucket.
# Keep this directory on an encrypted, private volume. No secret appears in argv.
mkdir -p "$BACKUP_WORKDIR"
pg_dump --schema=custom_dim --format=custom --file="$BACKUP_WORKDIR/custom_dim.dump"
rclone sync "$DIM_STORAGE_SOURCE" "$BACKUP_WORKDIR/storage" --checksum
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_WORKDIR/completed_at"
restic backup "$BACKUP_WORKDIR" --tag dim --tag "${APP_ENV:?}"
restic check
# Retention is an operator-defined policy; this script never prunes snapshots.
