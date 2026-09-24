# What the Claude Bridge scrapes

The Claude Bridge is the Scraping Agent's only way of collecting data. On every pipeline run it finds what is trending on **LinkedIn, X, Instagram and Facebook** in the **current month**, related to Ethara's Knowledge Base, brand and keywords.

This page covers:

- what data is collected
- where each field comes from
- what is never collected
- where the data ends up

The code lives in `server/src/bridges/claude-bridge/`. The rules are in `packages/skills/content-scraper/SKILL.md`, and the decision record is `docs/decisions/ADR-020-current-month-one-topic-searches.md`.

---

## 1. How it collects

| | |
|---|---|
| **Mechanism** | A headless Claude Code session (`claude -p`) with a single tool, **WebSearch**. It gets no file, shell or fetch tool, and it runs in an empty folder with no project context. |
| **What is read** | Public **search-engine results**: each result's URL and title. The bridge never logs in to a platform and never opens a platform page. |
| **Instructions** | The "Trend Intelligence Acquisition Agent" system prompt (32 sections, the operator's text word for word) and the session prompt, both in `adapters/claude-code.ts`. The three input files are supplied as File 1 — Keywords (`KEYWORD_INSTRUCTION_MAP.md`), File 2 — Knowledge Base (`CORPUS_SUMMARY.md`) and File 3 — Brand Voice (`BRAND_VOICE_INSTRUCTION_MAP.md`). LinkedIn also gets its own research strategy (see §5). |
| **Window** | The current month: from the 1st, in the workspace's time zone (Asia/Kolkata), to now. |
| **Budget** | Up to 16 searches per platform in the plan. Each research session may run at most 16 searches, and the bridge uses no more than that. |
| **Frequency** | Once per pipeline run, all four platforms in parallel. |

### What the searches are built from (the reference)

- **Keywords:** every keyword in the `keywords` table, merged with `shared/keywords.ts`. The highest-priority keywords are searched every run and the rest rotate daily. Keywords that name Ethara itself are not searched.
- **Research corpus:** topics derived from the papers in `corpus/`, cached in `server/data/corpus-topics.json`.
- **Knowledge Base:** active entries, including the Brand Corpus and hashtags learned on earlier runs.
- **Brand voice:** `shared/brand-voice.ts`, which sets the domains, audience, hype and pitch language, generic hashtags and sensitive subjects.
- **Reference documents:** `corpus/reference/BRAND_VOICE_INSTRUCTION_MAP.md`, `CORPUS_SUMMARY.md` and `KEYWORD_INSTRUCTION_MAP.md`.

---

## 2. The data collected

Each run produces two layers, which are kept apart.

### Layer A: captured posts (source data)

These come from the raw search results. Every field is either what the search result showed or something computed from it. None of it is written by a model.

| Field | What it is | How it is obtained |
|---|---|---|
| `url` | Link to an individual post | Returned by the search engine, then made canonical: tracking parameters removed, one host per platform |
| `publishedAt` | When the post was published | **Decoded from the post ID** (LinkedIn activity ID, X status ID, Instagram shortcode). A post whose date cannot be decoded is left out. |
| `text` | The post's opening line | The title the search engine indexed. It is not the full post. |
| `hashtags` | Hashtags on the post | Only those visible in the indexed title |
| `author` | The author's handle | Read from the URL (for example `linkedin.com/posts/<handle>_…`), or empty |
| `platform` | LinkedIn, X, Instagram or Facebook | From the URL's host |
| `matchedEtharaKeywords` | Which Ethara keywords the post names | Computed by the bridge |
| `brandRelevance` | High, medium or low | Computed against keywords, brand topics and the Knowledge Base |
| `related` | Kept for brand-topic signal but names no keyword | Computed |
| `newHashtags` | Hashtags Ethara doesn't track yet | Computed. After validation they are learned into the Knowledge Base. |
| `period` | `today`, `earlier` (this month) or `older` | Computed from `publishedAt`. `older` posts are supporting context only (see below). |
| `engagement` | Likes, comments, reposts | **Always empty.** A search result states no engagement (`metricsAvailable: false`). It is never zero. |

Posts are grouped by topic, one group per topic per platform. Each group has an **evidence level** (system prompt §5, §8 and §15):

- **`platform_trend`:** current-month posts from at least 2 independent authors. Several URLs from one author count as one source.
- **`platform_activity`:** current-month posts, but too few independent authors to call it a platform trend.
- **`supporting_context`:** posts from before the month. They are kept in the run record for context only and are **never passed to the Validation Agent**, because previous-month evidence cannot establish a current trend.

Each group records:

- the topic
- its hashtags
- up to 5 posts, newest first
- the matched keywords
- whether it is trending today
- its evidence level and its number of independent authors
- a computed reason, for example "3 X posts this month mention 'AI agents' (newest 2 days ago)…"

### Layer B: Claude's trend intelligence (interpretation)

This is Claude's JSON reply, in the output schema fixed by the system prompt (§31). It is stored per platform as `claudeTrends` and always labelled as Claude's findings.

| Field | What it is |
|---|---|
| `topic` | The canonical trend. Variants are listed in `relatedKeywords`. |
| `trendType` | `emerging`, `active`, `established` or `news_event` |
| `trendStatus` | `emerging`, `active`, `established` or `declining` |
| `platform` | The platform it is reported for |
| `hashtags`, `relatedKeywords` | As Claude reported them |
| `whyTrending` | Claude's explanation. It must say when momentum could not be verified. |
| `observedSignals` | What Claude observed, for example announcements, repeated posts or releases |
| `evidence[]` | Title, URL, source, publish date and evidence summary |
| `brandRelevance` | `high`, `medium`, `low` or `unknown`, with a reason. Taken from the Knowledge Base and Brand Voice files, and never used as evidence of trending. |
| `confidence` | High, medium or low |
| `windowStatus` | Set by the bridge: `current_month` if some evidence is dated this month, `unverified` if no date could be read |

**Checks the bridge applies to Claude's reply:**

- **Evidence links:** a link is kept only if a search in that same session returned it. Any other link is dropped and counted (`unverifiedEvidenceDropped`), so an invented URL cannot get through.
- **Trends without evidence:** a trend left with no verified evidence is dropped.
- **Dates:** decoded from the post ID where the platform encodes one, including X links cited in LinkedIn sessions (`dateSource: platform_id`). An arXiv link is dated to the month its ID encodes, e.g. `2609.16816` is September 2026 (`arxiv_id`). A date Claude wrote is used only when it starts as an ISO date or month, and is marked `claude_stated`.
- **The current-month rule:** checked, not trusted. A trend whose every dated piece of evidence predates the month is dropped, and the drop is recorded in the platform's notes.
- **Duplicates:** the same finding from two parallel sessions is listed once.

Claude also reports `platforms_with_insufficient_data` and `search_limitations`: in its own words, what it could not find or verify.

### The run record

Each run also stores:

- which reference it used: Knowledge Base entries, brand topics, keyword count and corpus topics
- the window and its name, for example "this month (since 1 September 2026)"
- every search it ran
- per platform: results found, how many were not posts, duplicates, undated, older than the window and not relevant, how many were kept, and the newest date seen
- a plain-language reason for any platform that produced little or nothing

---

## 3. What is never collected

- **Engagement figures:** likes, comments, shares or views. Search results don't state them.
- **Follower counts, profile details, bios or contact information.** Only the handle already in the post URL.
- **Full post bodies, comments, replies, images or videos.** Only the indexed title line.
- **Anything private or behind a login.** No LinkedIn, X, Instagram or Facebook page is opened, and no CAPTCHA, rate limit or access control is bypassed.
- **Invented data.** No made-up post, URL, date, hashtag, author or number. A missing value stays missing, and an empty platform is reported as empty with its reason.

---

## 4. Platform by platform

| Platform | How it's searched | How a post is dated | What to expect |
|---|---|---|---|
| **X** | WebSearch `allowed_domains: ["x.com"]` | Status ID (snowflake) | The best-covered platform: posts from the current month are found most runs. |
| **Instagram** | `site:instagram.com/p`, `site:instagram.com/reel` | Shortcode → media ID | A few posts from the current month per run. Search engines index little of Instagram. |
| **LinkedIn** | WebSearch `allowed_domains: ["linkedin.com"]` | Activity ID | Search engines index LinkedIn posts **weeks late**, so current-month posts are rarely found. See §5. |
| **Facebook** | `site:facebook.com` | **Cannot be dated.** Its post IDs carry no time. | Relevant posts are listed with "date not stated", for reference only. They are never passed on as dated evidence. |

Open-web pages (arXiv, news, blogs) are **not** captured as posts. They appear only as evidence inside Claude's analysis (layer B).

---

## 5. LinkedIn

Because LinkedIn posts reach the search index weeks late, LinkedIn sessions get an extra research strategy in their system prompt (`research.platform_notes.linkedin` in `bridge.config.json`). It works within the system prompt's rules:

1. **Search linkedin.com first,** with the current month named, then the hashtags. Individual post URLs are cited and dated from their activity IDs.
2. **An older LinkedIn post is supporting historical context only** (§5). It can appear in `observedSignals` but never establishes a trend.
3. **When current-month LinkedIn evidence is insufficient** (§7), current-month public web evidence (X, arXiv, lab announcements, industry publications) can describe what the LinkedIn audience is discussing. Such a trend is never called "trending on LinkedIn" (§8), and the real source is named on each piece of evidence.
4. **LinkedIn's indexing limit is reported** in `search_limitations`, and LinkedIn is listed in `platforms_with_insufficient_data` when no current-month LinkedIn post was found.

In layer A, LinkedIn usually reports status `older`: its newest relevant posts are listed as supporting context and are not passed on.

## 6. Where the data goes

| Destination | What |
|---|---|
| `pipeline_runs.summary.platformDiscovery` | The full run record, both layers included |
| `scraped_items` table | Current-month captured posts (layer A) with verified dates, as rows for the Validation Agent. Supporting-context posts are not stored here. |
| Validation Agent | Scores credibility, relevance, freshness and duplicates, and gives each post a verdict |
| Knowledge Base | New hashtags from validated posts, saved as "Discovered Hashtag" entries (up to 10 per run) |
| The app (sma.ethara.ai) | Content Intelligence → Scraped Data, the pipeline run screen, and the **Discovery results** popup: Topic + Date + Hashtags + Post URL + Platform |

Claude's analysis (layer B) is stored in the run record and appears in the command-line output. It is not yet shown in the app.

---

## 7. Running it by hand

```bash
npm run linkedin-trends -- --platform-trends --markdown                        # all platforms, readable table
npm run linkedin-trends -- --platform-trends --platforms linkedin --markdown   # one platform
npm run linkedin-trends -- --platform-trends                                   # full JSON report
```

A full four-platform run takes one to two minutes and costs a few dollars of Claude usage.
