# Cloudflare deployment

Two Cloudflare paths exist for this platform. They are not equivalent, and the
difference is not a matter of effort — it is architectural.

## Why Workers/Pages cannot host the API

Cloudflare Workers run in V8 isolates. This platform's API tier needs four
things that isolates do not provide:

| Requirement | Where it is used | Workers |
|---|---|---|
| **Subprocess spawning** | `api.ts` (×2), `agents/brain-bridge.ts`, `integrations/crawl4ai.ts` | Not available at all |
| **PostgreSQL + pgvector** | 4 × `vector(768)` columns in `schema.sql` | D1 is SQLite, no vector type |
| **A local model daemon** | 7 × `OLLAMA_BASE_URL` references | No localhost to reach |
| **Multi-minute requests** | a discovery run holds one request for ~6 min | CPU time is capped far below |

Losing subprocesses alone removes the Python 8-agent tier, the Brain bridge that
stores operator directives from Ethara, **and crawl4ai** — which is the only
capture source when `APIFY_API_TOKEN` is unset. The scraping agent would have
nothing to scrape with.

So: **`wrangler.toml` here deploys the web tier only.** It is real and useful —
a CDN-served frontend pointed at an API you host elsewhere — but on its own it
renders the empty state and nothing works. That is documented rather than
discovered.

## If the deployed URL says "Blocked request. This host is not allowed."

That is Vite's DNS-rebinding check, not a broken deployment. A quick tunnel
(`*.trycloudflare.com`), a `*.pages.dev` preview, a `.local`/`.lan` name and the
machine's own hostname are all allowed already. A **named tunnel or a real
domain** is a host Vite has never heard of, and its 403 reads as the whole
platform being down.

Name it when starting the dev server — comma-separated, a leading dot matches a
whole domain:

```bash
ALLOWED_HOSTS=socialai.ethara.ai npm run dev
ALLOWED_HOSTS=.internal.example npm run dev
ALLOWED_HOSTS='*' npm run dev        # disables the host check entirely
```

## If the page loads but there are no posts

The bundle asks for `/api` on whatever host served it. That is correct for the
tunnel and for the container, where nginx proxies `/api` to the API service —
both show the real calendar. It is NOT correct for `npm run deploy:pages`:
Cloudflare Pages serves `dist/` and nothing else, so `/api` 404s, the app falls
back to its bundled dataset, and the calendar reads empty. The banner says
"standalone" when this has happened.

Two ways out, in order of preference:

1. **Use the tunnel** (`npm run deploy:tunnel`). One URL serves both the app and
   the API, and nothing degrades.
2. **Point the Pages build at an API you host.** Vite inlines this at BUILD
   time, so it cannot be set in the Pages dashboard afterwards:

   ```bash
   VITE_API_URL=https://<your-tunnel>.trycloudflare.com/api npm run deploy:pages
   ```

   The API must then allow that origin — `CORS_ORIGIN` in `server/.env`.

## Path 1 — Tunnel (recommended: everything works)

`cloudflared` publishes the locally-running platform at a public Cloudflare URL.
Postgres, Ollama, the Python tier and every subprocess keep running on the host,
so **nothing degrades**. This is the only Cloudflare option under which the
product behaves as documented.

```bash
npm run deploy:tunnel
```

Reachable from any system, no Cloudflare account needed for a quick tunnel.

**Set `OPERATOR_PASSWORD` first.** A tunnel is public: without it, anyone holding
the URL can approve, publish and start agent runs, because `auth.enforced` is
false when the key is blank. The script refuses to start without it.

## Path 2 — Pages for the web tier, API hosted elsewhere

`wrangler.toml` deploys `dist/` to Cloudflare Pages. The API must live somewhere
that can run Node, spawn processes and reach Postgres — Fly.io, Railway, Render,
or a VPS. Point the bundle at it with `VITE_API_URL` at build time:

```bash
VITE_API_URL=https://api.your-host.example/api npm run build
npx wrangler pages deploy dist --project-name ethara-socialai
```

Note that this is the one case where an absolute `VITE_API_URL` is correct: the
frontend and API are genuinely on different origins, so the relative `/api`
default cannot resolve. `CORS_ORIGIN` on the API must then name the Pages origin,
and `SESSION_SECURE_COOKIE=true` is required because the session cookie will
cross HTTPS origins.

`Dockerfile` at the repo root already builds the full stack for any host that
runs containers, which is the shorter route to a working deployment than
splitting the tiers.
