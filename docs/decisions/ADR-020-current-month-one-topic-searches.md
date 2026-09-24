# ADR-020 — The Scraping Agent discovers this month's trends, one quoted topic per search

**Status:** Accepted · **Date:** 2026-09-24 · **Extends:** ADR-013/014/015 · **Confirms:** ADR-018's supersession note

## Context

The operator asked for the Scraping Agent to be the Claude Bridge's agent on every run, and to report what is trending **this month**, platform by platform. Each result should relate to Ethara's Knowledge Base, brand and keywords.

Runs before this change captured almost nothing current. The trace showed three causes:

1. **The window.** The handler's fallback, the SKILL.md and the Python tier all said "past week". The registry said "past month". Nothing expressed "this month".
2. **The query shape.** Each search ORed four or five quoted phrases, for example `site:linkedin.com/posts ("AI post-training" OR "reward models" OR …) September 2026`. We tested this against Claude Code WebSearch on 2026-09-24. This shape returned nothing newer than 2025 on LinkedIn, and on X it returned only a handful of results from August.
3. **Coverage.** The plan searched about 8 of the 151 keywords, because only as many OR-groups as the rota needed were built.

Probes on the same day compared query forms. Counts are posts both from September and naming the topic:

| Form | X, four topics |
|---|---|
| `site:x.com "reinforcement learning" September 2026` (quoted, one topic) | **4** |
| `site:x.com reinforcement learning September 2026` (unquoted) | 2, plus many off-topic posts that only matched the date (cricket squads, K-pop rankings) |

On **LinkedIn** no form returned a single September post. We tried with and without the month, `/posts`, `/feed/update`, the whole domain, and "Sep 2026". The newest indexed LinkedIn post was from 14 August. The limit is the search index, not the query.

## Decision

1. **Window.** `datePosted` gains `current-month`, and it is the default. The window runs from midnight on the 1st, in the workspace time zone, to now. The bridge's own default (`platform_trends.window: current_month`) matches, so the CLI, the MCP tool and the REST route default to it too. Reasons name the window in words ("this month (since 1 September 2026)").
2. **One quoted topic per search, month named.** `platformSearches()` builds one search per topic:
   - `fixed_keyword_share` of the keyword searches go to the highest-priority keywords on every run.
   - The rest rotate daily through every other keyword.
   - Then the day's research-corpus topics, `broad_searches` broad field terms, and one hashtag search.
   - Keywords naming Ethara itself are not searched (`exclude_brand_named_searches`), because they find Ethara's own posts. They still count for relevance.
3. **Budget.** `maxSearchesPerPlatform` defaults to 16, with the bridge ceiling at 30. At about 3 cents a search, a four-platform run costs about $2 and takes under a minute: sessions of 8 searches, 2 at a time per platform.
4. **Honest emptiness stays.** `showOlderWhenEmpty` remains on. A platform with nothing inside the month, which is typical of LinkedIn, lists its newest relevant posts labelled `older`. They are never presented as current.

## Consequences

- X and Instagram return this month's posts. LinkedIn usually returns only `older` rows until an authorized LinkedIn source exists, such as an official API adapter behind `TrendSourceAdapter`, or `manual_urls`.
- Every keyword is searched within about a week of daily runs. Relevance reads all of them on every run.
- Cost per run rises from about $0.30 to about $2. The knob controls it.

## Amendment (2026-09-24, later the same day): the research brief

At the operator's request, the Claude Code session no longer runs a fixed list of searches. It gets a research brief: the "Trend Intelligence Acquisition Agent" system prompt and session prompt in `adapters/claude-code.ts`. It may run its own related searches and replies with JSON trends.

- **Raw results.** The raw results of every search the session ran are still what the run captures. There is one difference: they are no longer limited to the planned queries. The limit is `acquisition.claude_code.research.max_searches_per_session`. It is stated in the brief and enforced on what is used.
- **Claude's JSON.** It is kept as `claudeTrends` per platform, a labelled analysis layer. An evidence URL is kept only if a search in the same session returned it. Dates come from the post id where the platform encodes one; otherwise they are marked `claude_stated`. A trend with no verified evidence is dropped.
- **Cost.** It rises: each session runs more searches and writes a JSON reply. `max_budget_usd_per_session` is 1.5 and the timeout is 8 minutes.

## Amendment 2 (2026-09-24): reference documents, and the month in words

- **Reference documents.** The three maps in `corpus/reference/` are given to Claude with every research brief (`research.reference_files`), inside the system prompt as `<reference>` blocks. They are read on each run, so an edit takes effect immediately. They were also ingested into the Knowledge Base as Brand Corpus entries (`npm run corpus:ingest`), so deterministic relevance scoring reads them too.
- **The month in words.** The brief's time window now reads "September 2026 — the current month: 1 September 2026 to 24 September 2026 (today), Asia/Kolkata". Before, it gave UTC dates, and midnight on the 1st in India printed as "2026-08-31".
- **Instructions added to the brief.** A "Current month" section tells Claude to name the month in its searches. Hashtags get their own line instead of appearing as a raw query in the topic list. Each trend carries a `corpus_theme` (A–E).
- **LinkedIn instructions** (`research.platform_notes.linkedin`). Cite individual post URLs, never profiles, company pages, jobs or `/pulse` articles. When no current-month post exists, report that rather than cite an older one as current.

## Amendment 3 (2026-09-24): the enhanced system prompt, and the bridge aligned to it

The operator replaced the system prompt with an enhanced "Trend Intelligence Acquisition Agent" prompt, 32 sections long. It is stored word for word in `adapters/claude-code.ts` (`SYSTEM_PROMPT`), and a test confirms the string sent at run time matches it. The bridge was brought into line with its rules:

- **§1 input files.** The three reference documents are passed in role order, each labelled: File 1 — Keywords (`KEYWORD_INSTRUCTION_MAP.md`), File 2 — Knowledge Base (`CORPUS_SUMMARY.md`), File 3 — Brand Voice (`BRAND_VOICE_INSTRUCTION_MAP.md`). They appear under "INPUT FILES PROVIDED" after the prompt.
- **§31 output schema ("use exactly").** The session prompt no longer asks for fields outside the schema (`corpus_theme`, `window_status`). The parser reads `trend_type`, `trend_status`, `observed_signals`, `evidence_summary`, `brand_relevance` and `search_limitations`.
- **§4–5 current month.** Checked by the bridge, not trusted. A trend whose every dated piece of evidence predates the window is dropped and counted in the platform's notes. In the bridge's own layer, previous-month posts are `supporting_context`: they stay in the discovery record and are **no longer passed to the Validation Agent**.
- **§8 and §15, platform trend vs platform activity.** A group of current-month posts is a `platform_trend` only when `platform_trend_min_authors` (2) independent authors posted it. Otherwise it is `platform_activity`. Several URLs from one author count as one source.
- **LinkedIn strategy.** Rewritten to fit §5, §7 and §8. Search linkedin.com first. An older LinkedIn post is supporting context only. Current-month web evidence may describe what the LinkedIn audience is discussing when LinkedIn-native evidence is insufficient, but is never called trending on LinkedIn. The earlier "latest available" trend part is withdrawn.
