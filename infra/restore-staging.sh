#!/bin/sh
set -eu
umask 077
: "${APP_ENV:?}" "${STAGING_DATABASE_URL:?}" "${RESTORE_DIRECTORY:?}" "${STAGING_STORAGE_TARGET:?}" "${SNAPSHOT_ID:?}"
[ "$APP_ENV" = staging ] || { echo 'Restore is permitted only in staging'; exit 1; }
[ "${CONFIRM_ISOLATED_TARGET:-}" = DIM_STAGING ] || { echo 'Confirm an isolated target using CONFIRM_ISOLATED_TARGET=DIM_STAGING'; exit 1; }
# Never --clean a shared/production database. The target must be a disposable staging DB
# with compatible auth.users and Supabase roles restored by the platform team.
restic restore "$SNAPSHOT_ID" --target "$RESTORE_DIRECTORY"
echo 'Snapshot restored locally. Locate custom_dim.dump and storage, then follow docs/runbook.md.'
echo 'No database or remote storage has been overwritten.'
