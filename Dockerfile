# syntax=docker/dockerfile:1.7
#
# ETHARA SOCIALAI — on-prem image set.
#
# Three targets, built from one context:
#
#   web-build    the Vite bundle, built once
#   web          nginx serving that bundle and proxying /api to the API
#   runtime      the API: Node 22, the Python tier, and Chromium
#
# WHY THE API IMAGE CARRIES PYTHON. The Node server does not call crawl4ai over
# a socket — it `spawn`s `backend/.venv/bin/python` as a sidecar process, and
# the agent bridge spawns `backend/api.py` the same way. A process boundary is
# not a network boundary, so the two tiers cannot be split into two services
# without changing the code. They share an image on purpose.
#
# WHAT THIS IMAGE CANNOT DO. mflux (FLUX.2 Klein on MLX) is Apple-Silicon-only
# and needs Metal, which no Linux container has. `MFLUX_PYTHON` is therefore
# left unset here and creatives render through the local brand SVG renderer,
# stamped with the reason — the product's own documented degradation, not a
# broken deployment.


########################################################################
# 1 — the web bundle
########################################################################
FROM node:22-bookworm-slim AS web-build

WORKDIR /app

# Dependencies first, so a source edit does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# A RELATIVE api base. nginx proxies /api to the API service, so the bundle
# carries no hostname and the same image serves any host, port or domain
# without a rebuild. Baking http://some-host:4001 in here is what makes a
# frontend image single-use.
ENV VITE_API_URL=/api

# `vite build`, NOT `npm run build`.
#
# The npm script is `tsc -b && vite build`, and `tsconfig.node.json` now
# includes `server/src` — so the typechecker needs the SERVER's dependencies,
# which this stage has no reason to install. Packaging a bundle and gating on
# types are different jobs: the gate is `npm run typecheck` in development and
# CI, where a failure is actionable, not in an image build where it only means
# a slower, larger stage.
#
# Skipping tsc also avoids the stale-emit problem vite.config.ts documents:
# `tsc -b` writes a .js beside every .tsx, and the resolver has to be told to
# prefer the source. Vite transpiles the TypeScript itself; nothing is lost.
RUN npx vite build


########################################################################
# 2 — nginx, serving the bundle
########################################################################
FROM nginx:1.27-alpine AS web

COPY --from=web-build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1


########################################################################
# 3 — the API, the agent runtime and the Python tier
########################################################################
FROM python:3.12-slim-bookworm AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production

# The base is Python and Node comes on top, not the other way round: pinning a
# Python minor version on a Node image means a third-party PPA, while adding
# Node to a Python image is one signed apt repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && node --version && npm --version \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── The Python tier ───────────────────────────────────────────────────
# `playwright install --with-deps chromium` is not optional: crawl4ai drives a
# real browser, and the wheel alone will not crawl. `--with-deps` apt-installs
# the shared libraries Chromium needs, which is the step most Dockerfiles miss
# and then fail at runtime with a bare "Host system is missing dependencies".
COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m venv /app/backend/.venv \
 && /app/backend/.venv/bin/pip install --upgrade pip setuptools wheel \
 && /app/backend/.venv/bin/pip install -r /app/backend/requirements.txt \
 && /app/backend/.venv/bin/python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# ── Node dependencies ─────────────────────────────────────────────────
# TWO installs, and both are needed.
#
#   /app/node_modules     `shared/` sits BESIDE `server/`, not inside it, so
#                         Node resolves its `zod` import from the root tree.
#                         Dropping this install fails at first request with a
#                         "Cannot find package 'zod'" that points at a file
#                         nobody edited.
#   /app/server/...       express, pg, node-cron — and tsx, which runs the
#                         TypeScript directly. tsx is a devDependency, so this
#                         install deliberately does NOT omit dev.
# Root: production deps only. None of them build native code, so install
# scripts are skipped — one less thing a transitive dependency can run at
# build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Server: devDependencies and install scripts are BOTH required here.
#
#   --include=dev   `npm start` is `tsx src/index.ts` and tsx is a
#                   devDependency. NODE_ENV=production (set above, for the
#                   app's own behaviour) makes npm omit dev by default, so
#                   without this flag the image builds clean and then
#                   crash-loops on `sh: 1: tsx: not found`.
#   scripts ON      tsx pulls esbuild, whose postinstall resolves the platform
#                   binary. The root package.json's `allowScripts` block names
#                   esbuild for exactly this reason.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --include=dev \
 && ./node_modules/.bin/tsx --version \
 && echo "tsx present"

# ── The source ────────────────────────────────────────────────────────
# The server runs TypeScript through tsx rather than a build step, so the
# sources ARE the artefact. The layout matters: `brain-bridge.ts` and the agent
# bridge in `api.ts` both resolve `../backend/...` from the process cwd, so
# /app/server and /app/backend must stay siblings.
COPY . .

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Chromium is happier with a writable temp and its own cache dir.
ENV HOME=/root \
    TMPDIR=/tmp

WORKDIR /app/server
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4001/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "start"]
