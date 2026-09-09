# Going live — what each agent needs

Every agent already runs. There is no demo dataset anywhere in the product: what a screen shows is
what a run captured, or nothing. Scraping is live today via crawl4ai and needs no key; the remaining
connectors below improve what the pipeline does with what it captured, and each one says on the
artefact whether it answered.

Check what is live right now: `GET /api/health` → `integrations`, or **Settings → Prototype mode**.

## The map

| Agent | What it needs live | Connector / key | Cost | Status today |
|---|---|---|---|---|
| **Scraping** | Posts across LinkedIn, Instagram, X, Facebook and the open web | crawl4ai · `CRAWL4AI_PYTHON` (keyless, local) | free — a headless browser on this machine | **Live already** — and the only scraping path |
| **Validation** | Nothing external. Scores what Scraping captured | — | — | Live already |
| **Analysis** | Nothing external | — | — | Live already |
| **Knowledge** | Deep research on the top 25 hashtags | Parallel · `PARALLEL_API_KEY`; crawl4ai reads the open web when it is absent | Parallel paid; crawl4ai free | **Live already** on crawl4ai; Parallel adds synthesis |
| **Calendar** | This account's own hour-by-hour engagement history | Analytics readings (below) | — | Live once Analytics is |
| **Caption** | A language model, grounded in the Knowledge Base | Gemini · `GCP_API_KEY` (or Vertex: `GCP_PROJECT_ID` + `GCP_SERVICE_ACCOUNT_JSON`) | Gemini Flash free tier covers this volume | **Ready** — set the key; the template writer is the fallback |
| **Image** | A background painter (the brand layer is always local) | Imagen · `GCP_API_KEY` **or** Z-Image · `Z_IMAGE_ENDPOINT` | Imagen paid per image; Z-Image self-hosted free | **Ready** — `brand-svg` alone is a complete fallback |
| **Review** | Nothing external. Twenty rules, computed | — | — | Live already |
| **Publishing** | Platform APIs | `LINKEDIN_ACCESS_TOKEN` · `INSTAGRAM_ACCESS_TOKEN` · `X_ACCESS_TOKEN` · `FACEBOOK_ACCESS_TOKEN` + `PUBLISH_MODE=live` | free (LinkedIn/Meta) · X paid tier | **Adapter interface exists; live dispatch not wired** (see below) |
| **Analytics** | Post metrics and monthly rollups | Platform analytics APIs (same tokens) | free with the token | **Not wired** — and nothing is seeded in its place, so the screens are empty until it is |
| **Learning** | Nothing external. Reads Analytics + human decisions | — | — | Live once Analytics is |
| **Command plane** | Intent parsing + narration | Gemini · `ASSISTANT_MODEL_PROVIDER=gcp` + `GCP_API_KEY` | free tier | **Ready** — the deterministic parser is the fallback |

Five agents need nothing at all. Three go live by setting a key today. Two — Publishing and
Analytics — are where real integration work remains.

## Order of operations

1. **crawl4ai first**, and it is already done on a machine that ran `npm run setup`: install the
   backend venv and `playwright install chromium`, set `CRAWL4AI_PYTHON`, then Run Discovery. It is
   the source of everything downstream, and it costs nothing.
2. **Gemini next.** One key turns on Caption, Image backgrounds and the command plane's model
   parser. `GCP_API_KEY` from AI Studio; free tier is enough.
3. **Research** already probes live (arXiv returned real results in `npm run connectors`). Add
   `PARALLEL_API_KEY` only if you want the deep-research synthesis on top.
4. **Platform tokens last** — they are the irreversible side, and they need the two pieces of work
   below before a token does anything.

## What still has to be built for Publishing and Analytics

Both adapters throw honestly rather than pretending. To wire them:

| Platform | Publish | Read metrics | Notes |
|---|---|---|---|
| LinkedIn | `POST /rest/posts` (Community Management API, `w_member_social` / `w_organization_social`) | `GET /rest/organizationalEntityShareStatistics` | Needs a Marketing Developer Platform app; 60-day tokens |
| Facebook | `POST /{page-id}/feed` or `/photos` (Graph API, `pages_manage_posts`) | `GET /{post-id}/insights` | Page access token from a system user; long-lived |
| Instagram | `POST /{ig-user-id}/media` → `/media_publish` (Graph API, `instagram_content_publish`) | `GET /{media-id}/insights` | Business account linked to a Page; image must be a public URL |
| X | `POST /2/tweets` (`tweet.write`) | `GET /2/tweets/:id?tweet.fields=public_metrics` | Basic tier is paid; free tier is write-only, 1,500/mo |

Where it plugs in: `packages/mcp/publisher/index.ts` → `liveAdapter().publish()` per platform, and a
new `packages/mcp/analytics/` connector feeding `analytics.metrics.ingest`. The approval gate, the
receipt, the append-only history and the demo/live stamp are already in place around them.

One structural note: Instagram and X want a **public image URL**, not a data URI. The creative
renderer produces data URIs today, so live publishing to those two also needs an asset upload step
(S3/GCS/Supabase Storage) before dispatch.

## Claude Code skills and MCP in the loop

| Skill / server | What it does here |
|---|---|
| `packages/skills/*/SKILL.md` | The behavioural spec each agent runs under — built into `packages/runtime/.claude/skills/` by `npm run build-skills` |
| `packages/mcp/*` | Typed connectors: similarity (local), research-sources (keyless), kb, render, publisher |
| `npm run connectors` | Proves reachability instead of asserting it |

## What "live" changes in the UI

Nothing moves. The same screens render; the fallback banners disappear and the Settings card shows
each service as `live`. That is the design: binding a different implementation changes which one
answers, never which code path runs. What it will never do is fill a screen — with no key and no
run, the screens are empty, and that is the honest reading.
