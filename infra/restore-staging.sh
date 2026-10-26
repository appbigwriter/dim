#!/bin/sh
set -eu
umask 077
: "${APP_ENV:?}" "${PGSERVICE:?}" "${PGPASSFILE:?}" "${RESTORE_DIRECTORY:?}" "${STAGING_STORAGE_TARGET:?}" "${SNAPSHOT_ID:?}" "${RESTORE_REPORT:?}"
[ "$APP_ENV" = staging ] || { echo 'Restore is permitted only in staging'; exit 1; }
[ "${CONFIRM_ISOLATED_TARGET:-}" = DIM_STAGING ] || { echo 'Confirm an isolated target using CONFIRM_ISOLATED_TARGET=DIM_STAGING'; exit 1; }
# Never --clean a shared/production database. The target must be a disposable staging DB
# with compatible auth.users and Supabase roles restored by the platform team.
case "$RESTORE_DIRECTORY" in /*) ;; *) echo 'Absolute private restore directory required'; exit 1;; esac
[ ! -e "$RESTORE_DIRECTORY" ] || { echo 'Restore directory must be new'; exit 1; }
[ "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_namespace WHERE nspname='custom_dim'")" = 0 ] || { echo 'Destination schema must be absent'; exit 1; }
[ "$(rclone lsf "$STAGING_STORAGE_TARGET" --files-only --recursive | wc -l | tr -d ' ')" = 0 ] || { echo 'Destination bucket prefix must be empty'; exit 1; }
started=$(date +%s)
restic restore "$SNAPSHOT_ID" --target "$RESTORE_DIRECTORY"
dump=$(find "$RESTORE_DIRECTORY" -type f -name custom_dim.dump)
[ "$(printf '%s\n' "$dump" | wc -l | tr -d ' ')" = 1 ] && [ -f "$dump" ] || { echo 'Exactly one DIM dump required'; exit 1; }
root=$(dirname "$dump")
(cd "$root" && sha256sum -c database.sha256 && sha256sum -c storage.sha256)
pg_restore --dbname="service=$PGSERVICE" --no-owner --exit-on-error --single-transaction "$dump"
rclone copy "$root/storage" "$STAGING_STORAGE_TARGET" --checksum
rclone check "$root/storage" "$STAGING_STORAGE_TARGET" --download
tables=$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname='custom_dim' AND tablename<>'schema_migrations'")
[ "$tables" -ge 79 ] || { echo 'Incomplete DIM schema'; exit 1; }
finished=$(date +%s)
snapshot_epoch=$(date -d "$(cat "$root/completed_at")" +%s)
printf '{"environment":"staging","tables":%s,"database_restored":true,"storage_readback_verified":true,"rto_seconds":%s,"snapshot_age_seconds":%s}\n' "$tables" "$((finished-started))" "$((started-snapshot_epoch))" > "$RESTORE_REPORT"
echo 'Staging database and Storage restored and verified. Report written.'
