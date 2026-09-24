# Claude Bridge — trend intelligence and all Scraping Agent capture

The Claude Bridge finds the latest trends relevant to the brand on **LinkedIn, Instagram, X, Facebook and the open web**. It is the **only** scraping mechanism in the product: Apify and Parallel are not used for capture. It serves three callers:

| Caller | How it's reached | Adapters it uses |
|---|---|---|
| **Claude Code** | MCP tools `linkedin_trend_intelligence` and `social_trend_intelligence` (take `platform`), registered in `.mcp.json` as `claude-bridge` | `acquisition.adapters` |
| **The SMA app** | `POST /api/bridges/linkedin-trends` (add `?format=markdown` for the table) | `acquisition.adapters` |
| **The Scraping Agent** (Node tier) | Platform-level trend discovery (`trends/platform-trends.ts`), called by the capture skill | `claude_code` |
| **The Scraping Agent** (Python tier) | `backend/tools/sources.py` → this CLI (`--platform-trends`) | `claude_code` |

## Platform-level trend discovery (the Scraping Agent's capture)

`trends/platform-trends.ts`:

```
Knowledge Base (+ research corpus) + Ethara brand context + every keyword
  → Claude Bridge → one quoted topic per search, the month named
  → LinkedIn · Instagram · Facebook · X (separately)
  → the CURRENT MONTH (default), each post labelled trending TODAY or earlier
  → Ethara relevance filter (an Ethara keyword must appear in the post)
  → extract posts + hashtags + URLs + authors
  → sort newest first
  → Validation Agent (as `platformTrends` beside `posts`)
```

- **One source adapter per platform:** `platform_trends.source_adapters` in `config/bridge.config.json` names the adapter each platform runs on. Every platform defaults to `claude_code`. Change one platform's entry, or add an adapter to `adapters/` and the factory in `adapters/linkedin-source-adapter.ts`, to replace that platform's source without touching the others. Each run records which adapter every platform used (`platforms[].adapter`).
- **Budget and query shape (ADR-020):** one quoted topic per search with the month named — `"AI agents" September 2026` — because an OR of quoted phrases returned nothing recent. `default_searches_per_platform` (16; the Scraping Agent passes its `maxSearchesPerPlatform` knob, ceiling `max_searches_per_platform`) per platform: half to the top-priority keywords every run, the rest rotating daily through every other keyword, then the day's corpus topics, one broad term, and a hashtag search. Keywords naming Ethara are not searched. At most 5 posts per trend. Platforms run in parallel. Results from any search not in the plan are discarded.
- **Analysis** (relevance and grouping) is deterministic and local. It costs no tokens and runs over the de-duplicated results in batches of `analysis_batch_size`.
- **A trend** is the posts on one platform that mention the same Ethara keyword. Its hashtags are the ones those posts wrote. Its reason is computed from the evidence: count, recency, and which searches surfaced it.
- **Window:** `platform_trends.window` (`current_month`) for the CLI, MCP tool and REST route; the Scraping Agent's `datePosted` setting (default `current-month`). The current month runs from midnight on the 1st in the workspace's time zone to now. Every post and trend carries `period: 'today' | 'earlier' | 'older'`, and trends trending today are listed first. The rolling options are `past-24h`, `past-48h`, `past-week`, `past-month` and `past-quarter`. Search indexes lag the platforms — LinkedIn by weeks — and that is reported.
- **Platform trends come from the Claude Bridge** (ADR-018, revised 2026-09-24). `source_adapters` sets every platform to `claude_code`: Claude Code's WebSearch tool runs the keyword and hashtag searches, and the bridge keeps only real post URLs from the raw search results, dating each from what the platform states. A search result carries no engagement, so trend rows on this path are ranked without it. **SocialFetch is no longer a trends source — it is used only by the Analysis Agent's Social Media Listener.** There is no web-search or news fallback beyond `claude_code` itself (`fallback_adapter` is unset): when a platform's search returns nothing, that platform reports why and yields nothing.
- **The reference is the Knowledge Base, the research corpus and every keyword.** `context.knowledge_base.subject_categories` includes `Brand Corpus` (the papers in `corpus/`, ingested with `npm run corpus:ingest`) and `max_entries` holds all of them; `context.keywords.merge_sources` merges the keywords table with `shared/keywords.ts`. The corpus's topics, methods and benchmarks (`context/corpus-topics.ts`, derived once per corpus by Claude with no tools, cached in `server/data/corpus-topics.json`) fill `platform_trends.corpus_topics.corpus_searches` of each platform's searches — rotating daily through the list — join the hashtag search, and count as Ethara's field when judging relevance. Each run reports them under `corpus`.
- **Searches name the current month** ("September 2026") on the keyword searches (`recency_hint`). Search engines rank by relevance, not date, and naming the month measurably surfaces recent posts. On X it found posts from the last week that plain keywords missed. The hashtag search is left unhinted.
- **Older and undated posts.** `fallback_to_latest` and `include_undated` are on. The fallback lists a platform's newest relevant posts from before the window only when it has none inside it (labelled `older`), and undated Facebook posts go into `undated[]`. Neither is ever presented as current.
- **Related posts.** With `accept_related`, a post naming no keyword is kept when it carries at least `related_min_signals` brand-topic and Knowledge Base signals and reaches `related_minimum_relevance`. It is flagged `related` and grouped under its brand topic.
- **New hashtags → Knowledge Base → next run.** Hashtags that are neither a keyword nor already learned are flagged `newHashtags`. After validation, the orchestrator writes those on validated posts to the Knowledge Base as "Discovered Hashtag" entries. The next run puts the strongest of them into its hashtag search (`learned_hashtags_per_search`).
- **Instagram is scoped to post and reel URLs** (`site:instagram.com/p`, `site:instagram.com/reel`). An unscoped search returns profile and tag pages, which are not posts. X `/article/` URLs are accepted, since they are dated from the same snowflake id.
- **Where to run it:** `npm run linkedin-trends -- --platform-trends [--markdown] [--hours 48] [--platforms linkedin,x] [--keywords a,b]`, the MCP tool `platform_trend_discovery`, or `POST /api/bridges/platform-trends`.
- **Where to see it:** the Scraping Agent records each run's discovery on the pipeline run (`summary.platformDiscovery`). The app shows it in **Content Intelligence → Scraped Data** and in the **pipeline run screen**.
- **The results popup:** once scraping and validation are done, the orchestrator records `summary.discoveryResults` (`server/src/discovery-results.ts`) and publishes a `discovery.results` event. The app then opens a **Discovery results** popup listing each post's **Topic + Date + Hashtags + Post URL + Platform**, with its matched keyword, the trend reason and the Validation Agent's verdict, newest first. It can be reopened with **View results** on the scraping panel. An empty run shows each platform's reason instead of rows.

Output, one entry per trend:

```json
{ "platform": "LinkedIn", "trend": "RLVR", "hashtags": ["#RLVR"],
  "posts": [{ "url": "…", "publishedAt": "…", "author": "@handle" }],
  "matchedEtharaKeywords": ["RLVR"],
  "reason": "3 LinkedIn posts in the last 48 hours mention “RLVR” (newest 5 hours ago); …" }
```

## Lanes

| Lane | Module | How an item is dated | Notes |
|---|---|---|---|
| LinkedIn | `platforms/linkedin.ts` | Activity id → timestamp (`id >> 22`) | `/posts/` only |
| X | `platforms/x.ts` | Status id snowflake (`(id >> 22) + 1288834974657`) | Verified against a post with a known date |
| Instagram | `platforms/instagram.ts` | Shortcode → media id → `(id >> 23) + 1314220021721` | Verified against a post with a known date |
| Facebook | `platforms/facebook.ts` | **Cannot be dated.** Its IDs carry no time | Undated in the tool; the Scraping Agent skips this lane unless a date-stating source is configured |
| Open web | `platforms/web.ts` | A full date in the URL, or the page's own published-date tag | The page is read only where robots.txt allows (`processing/page-metadata.ts`) |

## How a run works

```
Knowledge Base + Brand Voice + Keywords  (read from the SMA: Postgres, shared/brand-voice.ts)
        ↓ discovery/query-builder.ts      bounded query plan, breadth-first
        ↓ adapters/*                      acquisition, behind TrendSourceAdapter
        ↓ processing/normalizer.ts        source validation, canonical URL, date, hashtags
        ↓ processing/deduplicator.ts      post id / canonical URL, then text similarity
        ↓ processing/freshness.ts         window + age bands
        ↓ processing/relevance.ts         keyword / topic / KB overlap, hype and restriction penalties
        ↓ processing/trend-ranking.ts     weighted score, newest-first sort
        ↓ output (schemas/trend-output.ts, output/markdown.ts)
```

## Acquisition adapters

No adapter bypasses authentication, CAPTCHA, robots rules or rate limits. None fetches a social-platform page; only open-web pages are read, and only where robots.txt allows.

| id | What it reads | Notes |
|---|---|---|
| `claude_code` | Claude Code's **WebSearch** results, scoped with the lane's `site:` filters (`-site:` exclusions for the open web) | Runs headless `claude -p` in an empty directory, with no settings, no MCP servers and only WebSearch allowed. URLs are harvested **only from the raw search results**, never from Claude's prose, so a made-up URL cannot get through. |
| `sma_captures` | The lane's rows already in `scraped_items` | Free. Stored dates are trusted only on rows the bridge captured. Not offered to the Scraping Agent, since it would re-read its own output. |
| `manual_urls` | `post_urls` passed on a call, plus an optional JSON file (`LINKEDIN_TRENDS_MANUAL_URLS_FILE`) | Analysed from the URL and any stated metadata; never fetched. |
| `fixture` | `tests/fixtures/claude-bridge/linkedin-posts.json` | Test data only. Output is stamped `source_status: "fixture"` with a banner. |

To add a source (an official API, an approved provider), implement `TrendSourceAdapter` in `adapters/` and register it in `adapters/linkedin-source-adapter.ts`. Nothing downstream changes.

**Adding a platform:** write a `PlatformModule` in `platforms/` (hosts, post-URL rules, id→date decoding, site filter) and list it in `platforms/index.ts`.

## What is verified and what is computed

- **Verified source data:** `post_url` (a real post URL returned by the source), `published_at` (`date_source` is `platform_id`, `url_path`, `page_metadata` or `source`), and `hashtags` and `snippet` (only text the source or page showed).
- **Computed by the bridge:** `topic`, `trend_score` with its `score_breakdown`, `brand_relevance`, `relevance_reason` and `trend_reason`. This is deterministic, not model judgement.
- **Never invented:** a missing date is `null` with `date_status: "unknown"`. Missing engagement is `null` with `engagement_available: false`, and it is left out of the score rather than counted as 0. An empty source produces empty `results`, with the reason.

## Known limitation: search indexes lag the social platforms

Public search engines index social posts late. Live tests on 2026-09-23 found the freshest indexed posts were about 20 days old on LinkedIn, 42 days on X and 84 days on Instagram. The open web is indexed much faster: news and blog pages dated within days were found. So on a platform lane a 7–14 day window often comes back empty; that is the correct answer, not a bug. When it happens the output says how old the freshest post was. For more recent platform coverage:

- widen `date_from`, or
- supply post URLs (`post_urls` or the manual file), or
- add an adapter for an authorized source, such as the official X API recent-search endpoint or the Instagram Graph API hashtag search. Both need credentials and approval from the platform.

## Commands

```bash
npm run test:linkedin-trends          # unit tests, then a full sample run on fixtures (no network, no DB)
npm run linkedin-trends               # live run from the SMA's own context; prints JSON then Markdown
npm run linkedin-trends -- --keywords "RLVR,AI agent evaluation" --from 2026-08-01 --max-results 10
npm run linkedin-trends -- --platform x --keywords "agentic AI" --from 2026-06-01     # instagram | x | facebook | web
npm run linkedin-trends -- --lanes                                                     # which capture lanes can run (no search)
npm run mcp:claude-bridge             # the MCP server (Claude Code starts it itself via .mcp.json)
```

In Claude Code, opened in this repository: *"Find the latest LinkedIn trends relevant to our brand."*

## Configuration

`config/bridge.config.json` holds every limit, weight and threshold: the window, query forms and budgets, per-adapter limits, relevance and ranking weights, and dedup similarity. A few environment variables override it per deployment; they're listed under "Claude Bridge" in `server/.env.example`. The main ones:

- `CLAUDE_CODE_BIN`: path to the `claude` binary. By default the bridge looks on PATH, then `~/.claude/local`, then the VS Code extension's bundled binary.
- `CLAUDE_BRIDGE_MODEL`
- `LINKEDIN_TRENDS_WINDOW_DAYS`, `LINKEDIN_TRENDS_MAX_*`, `LINKEDIN_TRENDS_ADAPTERS`, `LINKEDIN_TRENDS_MIN_RELEVANCE`
- `LINKEDIN_TRENDS_LOG_FILE`: appends one JSON line per execution. Every run also writes that line to stderr.

The bridge stores no credentials. Claude Code authenticates with its own login, and log lines pass through `redact()`.

**Cost.** One Claude Code search session has measured about $0.05–0.10. The Scraping Agent's capture runs one session per platform, with at most 3 searches in each. That is 3 sessions (Facebook is skipped) and about 9 searches, roughly $0.15–0.30 and 15–30 seconds per discovery run. A trend-intelligence tool call runs at most `claude_code.max_queries` queries (12), so 3 sessions.
