# Going live — what each agent needs

Every agent already runs. There is no demo dataset anywhere in the product: what a screen shows is
what a run captured, or nothing. Scraping is live today through the Claude Bridge (Claude Code web search on this host) and needs no scraping key; the remaining
connectors below improve what the pipeline does with what it captured, and each one says on the
artefact whether it answered.

Check what is live right now: `GET /api/health` → `integrations`, or **Settings → Prototype mode**.

## The map

| Agent | What it needs live | Connector / key | Cost | Status today |
|---|---|---|---|---|
| **Scraping** | The latest relevant trends on LinkedIn, Instagram, Facebook and X | The Claude Bridge · the Claude Code CLI on the host (`CLAUDE_CODE_BIN` if not on PATH); one source adapter per platform in `bridge.config.json` | Claude Code usage, capped at 3 searches per platform per run and a per-session budget | **Live already**. A search result states no engagement, so none is shown |
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
3. **Research** reads the open web with crawl4ai already. Add
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

Where it plugs in: `liveAdapter` in `server/src/agents/publishing/handlers.ts` — it already
implements the `PlatformAdapter` interface and throws with a specific reason, so a real
implementation replaces its `dispatch()` and `uploadMedia()` without touching a caller. Reading
metrics needs a new adapter in `server/src/integrations/` feeding `analytics.metrics.ingest`. The
approval gate, the receipt, the append-only history and the demo/live stamp are already in place
around them.

One structural note: Instagram and X want a **public image URL**, not a data URI. The creative
renderer produces data URIs today, so live publishing to those two also needs an asset upload step
(S3/GCS/Supabase Storage) before dispatch.

## Claude Code skills and MCP in the loop

| Skill / server | What it does here |
|---|---|
| `packages/skills/*/SKILL.md` | The behavioural spec each agent runs under — built into `packages/runtime/.claude/skills/` by `npm run build-skills` |
| `server/src/integrations/*` | The typed connectors: `capture` (lane routing to the Claude Bridge), `parallel` (Knowledge research only), `gcp-llm`, `embeddings` |
| `server/src/bridges/claude-bridge/` | All scraping: per-platform trend discovery, the `claude-bridge` MCP server in `.mcp.json`, and `/api/bridges/*` |
| `GET /api/health` | Proves reachability instead of asserting it — every adapter's `configured` and the reason it is not |

## What "live" changes in the UI

Nothing moves. The same screens render; the fallback banners disappear and the Settings card shows
each service as `live`. That is the design: binding a different implementation changes which one
answers, never which code path runs. What it will never do is fill a screen — with no key and no
run, the screens are empty, and that is the honest reading.
