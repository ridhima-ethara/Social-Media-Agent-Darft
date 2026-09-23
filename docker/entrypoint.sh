#!/bin/sh
# The API container's first move: bring the schema up, seed only if there is
# nothing to lose, then hand over.
#
# MIGRATIONS are safe to repeat. `db:migrate` applies one idempotent schema.sql
# and then refuses to continue on drift — the same discipline the repo holds
# itself to.
#
# SEEDING IS NOT. `db:seed` is a reset: it DELETEs this workspace's ideas,
# drafts, media, captured posts and hashtags before writing the starting set.
# This script used to run it on every boot, so a restart, an OOM kill or a host
# reboot destroyed whatever the operator had built and replaced it with
# fixtures. On a deployment that is data loss on a timer.
#
#   RUN_SEED=auto   (default) seed only when the workspace holds no ideas and no
#                   captured posts. A first boot is seeded; every boot after it
#                   is left alone.
#   RUN_SEED=true   seed unconditionally. This DELETES existing content — use it
#                   only when you mean to start over.
#   RUN_SEED=false  never seed.
#
# RUN_MIGRATIONS=false hands a managed database its own migration window.

set -e

cd /app/server

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "→ applying schema"
  # A drift failure exits non-zero here on purpose. Serving an API against a
  # schema that does not match the code fails later, deeper, and less legibly
  # than refusing to start.
  npm run --silent db:migrate
else
  echo "→ migrations skipped (RUN_MIGRATIONS=false)"
fi

case "${RUN_SEED:-auto}" in
  true)
    echo "→ seeding workspace (RUN_SEED=true — this replaces existing content)"
    npm run --silent db:seed
    ;;
  auto)
    echo "→ checking whether this database is empty"
    # Exit 0 from the check means empty. `set -e` would abort on the non-zero
    # "already has work" answer, so the branch is explicit.
    if npm run --silent db:needs-seed; then
      npm run --silent db:seed
    else
      echo "→ seed skipped — existing content left untouched"
    fi
    ;;
  *)
    echo "→ seed skipped (RUN_SEED=${RUN_SEED})"
    ;;
esac

exec "$@"
