#!/bin/sh
# The API container's first move: bring the schema up, then hand over.
#
# Both steps are safe to repeat. `db:migrate` applies one idempotent schema.sql
# and then refuses to continue on drift; `db:seed` clears and rewrites only this
# workspace's rows. Running them on every boot is the same discipline the repo
# already holds itself to — "db:reset must run clean twice in a row".
#
# Set RUN_MIGRATIONS=false to hand a managed database its own migration window.

set -e

cd /app/server

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "→ applying schema"
  # A drift failure exits non-zero here on purpose. Serving an API against a
  # schema that does not match the code fails later, deeper, and less legibly
  # than refusing to start.
  npm run --silent db:migrate

  if [ "${RUN_SEED:-true}" = "true" ]; then
    echo "→ seeding workspace"
    npm run --silent db:seed
  else
    echo "→ seed skipped (RUN_SEED=false)"
  fi
else
  echo "→ migrations skipped (RUN_MIGRATIONS=false)"
fi

exec "$@"
