#!/usr/bin/env bash
# MOVE THE EXISTING DATA INTO THE CONTAINERISED DATABASE.
#
# The stack owns its own Postgres volume, so a fresh `docker compose up` starts
# empty and seeds fixtures. This copies what the host database already holds —
# the calendar, the captured posts, the drafts, the creatives — into it, so the
# hosted URL shows the work rather than a fresh install.
#
#   ./docker/import-host-data.sh
#
# It is safe to re-run: the target database is dropped and recreated from the
# dump each time, so the result is the dump, not the dump merged with whatever
# was there.
#
# WHAT IT DOES NOT DO. It does not touch the host database. The dump is read-only
# on the source side, and the file is left behind so you can inspect or keep it.

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# ── Where the data is coming FROM ────────────────────────────────────────────
# The host connection string the API is using right now. Read from the same file
# the server reads, so this cannot drift from what is actually live.
SOURCE_URL="${SOURCE_DATABASE_URL:-$(
  sed -n 's/^DATABASE_URL=//p' server/.env | head -1
)}"

if [ -z "${SOURCE_URL}" ]; then
  echo "Could not read DATABASE_URL from server/.env." >&2
  echo "Set SOURCE_DATABASE_URL=postgresql://... and run again." >&2
  exit 1
fi

# ── Where it is going TO ─────────────────────────────────────────────────────
DB_USER="${POSTGRES_USER:-ethara}"
DB_NAME="${POSTGRES_DB:-ethara_socialai}"
DUMP="${DUMP_FILE:-/tmp/ethara-host-dump.sql}"

echo "→ source   ${SOURCE_URL%%:*}://…/$(basename "${SOURCE_URL}")"
echo "→ target   compose service 'db', database ${DB_NAME}"
echo

# ── 1 · Find a pg_dump that matches the SERVER ───────────────────────────────
# pg_dump refuses to dump a server newer than itself, and a machine with several
# Postgres versions installed usually has the wrong one first on PATH. On this
# host that was exactly the case — server 17.11, `pg_dump` 16.15 — and the dump
# aborted with "server version mismatch". So the server is asked its version and
# a matching binary is resolved, rather than trusting PATH.
server_major="$(psql "${SOURCE_URL}" -tAc 'SHOW server_version;' 2>/dev/null | cut -d. -f1 | tr -d ' ')"
PGDUMP="${PGDUMP:-}"

for candidate in \
  "/opt/homebrew/opt/postgresql@${server_major}/bin/pg_dump" \
  "/usr/local/opt/postgresql@${server_major}/bin/pg_dump" \
  "/usr/lib/postgresql/${server_major}/bin/pg_dump" \
  "$(command -v pg_dump || true)"
do
  [ -n "${candidate}" ] && [ -x "${candidate}" ] || continue
  if [ "$("${candidate}" --version | grep -oE '[0-9]+' | head -1)" = "${server_major}" ]; then
    PGDUMP="${candidate}"
    break
  fi
done

if [ -z "${PGDUMP}" ]; then
  echo "No pg_dump matching server major version ${server_major} was found." >&2
  echo "Install it (brew install postgresql@${server_major}), or set" >&2
  echo "PGDUMP=/path/to/pg_dump and run again." >&2
  exit 1
fi
echo "→ using ${PGDUMP} ($("${PGDUMP}" --version))"

# ── 2 · Dump ─────────────────────────────────────────────────────────────────
# --clean --if-exists so the restore replaces objects rather than colliding with
# the ones migration created. --no-owner --no-privileges because the roles on the
# host are not the roles in the container.
echo "→ dumping the host database"
"${PGDUMP:-pg_dump}" "${SOURCE_URL}" \
  --clean --if-exists --no-owner --no-privileges \
  --file "${DUMP}"
echo "  $(wc -l < "${DUMP}") lines written to ${DUMP}"

# ── 3 · Check the stack is up ────────────────────────────────────────────────
if ! docker compose ps db --status running >/dev/null 2>&1; then
  echo
  echo "The 'db' service is not running. Start the stack first:" >&2
  echo "    docker compose up -d db" >&2
  exit 1
fi

# ── 4 · Restore ──────────────────────────────────────────────────────────────
echo "→ restoring into the container"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME}" < "${DUMP}"

# ── 5 · Prove it landed ──────────────────────────────────────────────────────
echo
echo "→ what the container database now holds"
docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "
  SELECT
    (SELECT COUNT(*) FROM content_ideas)  || ' ideas, '     ||
    (SELECT COUNT(*) FROM drafts)         || ' drafts, '    ||
    (SELECT COUNT(*) FROM media_assets)   || ' creatives, ' ||
    (SELECT COUNT(*) FROM scraped_items)  || ' captured posts, ' ||
    (SELECT COUNT(*) FROM content_ideas WHERE calendar_slot = 'primary'
       AND status NOT IN ('suggested','rejected')) || ' cards on the calendar'
"

echo
echo "Done. The API seeds only an empty database (RUN_SEED=auto), so this data"
echo "will not be overwritten on restart. Restart the API to pick it up:"
echo "    docker compose restart api"
