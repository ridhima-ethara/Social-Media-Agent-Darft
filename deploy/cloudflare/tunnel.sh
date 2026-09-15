#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# PUBLISH THE RUNNING PLATFORM ON A PUBLIC CLOUDFLARE URL
#
# A Cloudflare Tunnel, not Workers. Everything keeps running on this host —
# PostgreSQL with pgvector, the Ollama daemon, the Python agent tier, crawl4ai
# and its headless browser — so nothing degrades. That is the whole reason to
# choose a tunnel over Pages: see deploy/cloudflare/README.md.
#
# IT REFUSES TO START WITHOUT A PASSWORD. A tunnel is genuinely public. With
# OPERATOR_PASSWORD blank the product accepts any password by design, so exposing
# it would let anyone holding the URL approve a post, publish it, or start an
# agent run that spends Apify credit. That is not a warning worth printing and
# then ignoring, so this exits instead.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }
bold() { printf '\033[1m%s\033[0m\n' "$1"; }

# ── 1 · cloudflared ────────────────────────────────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
  red "cloudflared is not installed."
  echo "  brew install cloudflared"
  exit 1
fi

# ── 2 · The credential gate ────────────────────────────────────────────────
password=""
for f in server/.env server/secrets.env; do
  [ -f "$f" ] || continue
  # `|| true` on every link: a grep that finds nothing exits 1, and under
  # `set -e` that would kill this script silently — which is exactly what it did.
  v=$(grep -E '^OPERATOR_PASSWORD=' "$f" 2>/dev/null | head -1 | cut -d= -f2- || true)
  v=$(printf '%s' "$v" | tr -d ' "'"'"'' || true)
  if [ -n "$v" ]; then password="$v"; fi
done

if [ -z "${password}${OPERATOR_PASSWORD:-}" ]; then
  red "OPERATOR_PASSWORD is not set — refusing to expose an unauthenticated platform."
  echo ""
  echo "  A tunnel is public. Without a password, anyone with the URL can approve"
  echo "  and publish posts, and start agent runs."
  echo ""
  echo "  Set one in server/secrets.env (gitignored), then run this again:"
  echo "      echo 'OPERATOR_PASSWORD=choose-something-strong' >> server/secrets.env"
  exit 1
fi

# ── 3 · Is the platform actually up? ───────────────────────────────────────
PORT=$(grep -E '^PORT=' server/.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' ' || true)
PORT="${PORT:-4001}"
PORT="${PORT:-4001}"
WEB_PORT="${WEB_PORT:-5173}"

if ! curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  red "The API is not answering on :${PORT}."
  echo "  Start it first:  npm run dev:full"
  exit 1
fi

if ! curl -sf -m 5 -o /dev/null "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null; then
  red "The web app is not answering on :${WEB_PORT}."
  echo "  Start it first:  npm run dev:full"
  exit 1
fi

enforced=$(curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null \
  | grep -o '"enforced":[a-z]*' | head -1 | cut -d: -f2 || true)
enforced="${enforced:-unknown}"

bold ""
bold "Publishing the web app on a Cloudflare tunnel"
dim  "  web  → http://127.0.0.1:${WEB_PORT}  (proxies /api to :${PORT} same-origin)"
dim  "  auth → enforced=${enforced}"
dim  "  Ctrl-C ends the tunnel. The platform keeps running."
bold ""

# The tunnel points at the WEB port, not the API. Vite proxies /api same-origin,
# so one tunnel carries both and the bundle's relative `/api` base resolves
# correctly through it — which is exactly why the API base was made relative.
exec cloudflared tunnel --url "http://127.0.0.1:${WEB_PORT}"
