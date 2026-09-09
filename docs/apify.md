# Apify — where the agent file is, and how to run it free

## Where the `.md` files are

Apify publishes agent-readable Markdown at fixed URLs. None of them live in this repo — they are
read live, which is the point: they cannot go stale here.

| What | URL | Used for |
|---|---|---|
| The integration contract | `https://apify.com/agents.md` | Auth, endpoints, cost caps, MCP — `server/src/integrations/apify.ts` follows it |
| Any actor's input schema and pricing | `https://apify.com/<owner>/<actor>.md` | e.g. `https://apify.com/harvestapi/linkedin-post-search.md` |
| The Store, keyless | `GET https://api.apify.com/v2/store?search=linkedin` | Finding actors — `npm run connectors` and `npm run apify:probe` use it |
| The MCP server | `https://mcp.apify.com` | Registered in `.mcp.json` for Claude Code |

What *does* live here:

| File | Role |
|---|---|
| `server/src/integrations/apify.ts` | The adapter — header auth, per-actor input builders, sync→async fallback, normalisation |
| `server/src/config.ts` → `apify` | The env keys and actor defaults |
| `server/scripts/apify-probe.ts` | Proves the setup rather than asserting it |
| `packages/skills/content-scraper/SKILL.md` | The Scraping Agent's specification — what it may and may not do |
| `.mcp.json` | Apify's MCP tools for Claude Code sessions |

## Running it free

Apify's free plan carries **$5 of platform credit a month**, no card required. The default actors
are pay-per-result, so that credit buys real extraction:

| Actor | Price | $5 buys |
|---|---|---|
| `harvestapi~linkedin-post-search` | ~$2 / 1,000 posts | ~2,500 posts |
| `harvestapi~linkedin-company-posts` | ~$2 / 1,000 posts | ~2,500 posts |

A full discovery run at the defaults — 12 keywords × up to 50 posts — is at most 600 posts, so the
free credit covers **four runs a month**, or more with a smaller `APIFY_MAX_ITEMS_PER_KEYWORD`.

1. Sign up at <https://console.apify.com/sign-up>.
2. Copy the token from <https://console.apify.com/settings/integrations>.
3. Put it in `server/.env` as `APIFY_API_TOKEN=…`. Nothing else is required — the actor defaults
   already point at actors that exist and whose output shape the normaliser understands.
4. `npm run apify:probe` — confirms the token and that every actor resolves. Free.
5. `npm run apify:probe -- --live` — one search capped at **3 results**. Costs under a cent.
6. `npm run dev:full`, sign in, **Run SocialAI**. The Scraping Agent now reads LinkedIn live and
   stamps every item `source: 'live'`.

Every cost cap goes in the query string (`maxItems`), never the input body — so a misconfigured
actor cannot run past the cap. `APIFY_MAX_ITEMS_PER_KEYWORD` is the ceiling per keyword per run.

## What comes back

Every trending keyword and hashtag carries the URLs to open it: the LinkedIn content search or
hashtag feed, and the strongest post that carried it.

- Content Intelligence — clickable on every keyword card and hashtag row
- `GET /api/trends` — JSON
- `GET /api/trends.csv` — the same as a download ("Export with URLs" on the Hashtags tab)
- The command plane — *"what's trending this week?"* returns the same URLs in its table

## Other platforms

The research connectors (`packages/mcp/research-sources/`) are keyless and free: arXiv, Semantic
Scholar, Papers with Code, GDELT. They feed the Knowledge Agent, not the scraper. Instagram, X and
Facebook scraping are not wired — the Store has actors for each, and the adapter's per-actor input
builder is where a new family plugs in. Publishing to them runs in demo mode until a platform token
exists (`<PLATFORM>_ACCESS_TOKEN`).

## Without a token

The pipeline runs on the bundled fixture corpus, stamped `source: 'fixture'` with the reason on every
card. That is a supported configuration, not a degraded one — every screen works, and every fallback
says which mode it is in.
