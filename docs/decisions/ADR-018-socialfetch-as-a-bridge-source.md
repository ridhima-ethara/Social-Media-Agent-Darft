# ADR-018 — SocialFetch is the Claude Bridge's source for last-week LinkedIn, Instagram and X posts

**Status:** Superseded (2026-09-24) — see the note below · **Date:** 2026-09-24 · **Extends:** ADR-013/014/015

> **SUPERSEDED, same day.** The operator reversed this decision: **platform trends now come from the Claude Bridge's `claude_code` (WebSearch) adapter, and SocialFetch is reserved solely for the Analysis Agent's Social Media Listener.** `platform_trends.source_adapters` sets every platform to `claude_code`. The trade-off the context below describes (public search lags the platforms, and a search result states no engagement) is accepted: trend rows on this path are ranked without engagement, and a platform that returns nothing reports why. The SocialFetch bridge adapter (`adapters/socialfetch.ts`) remains in the codebase but is no longer wired into the trends path.

## Context

The operator needs the trends of the **last 7 days**, with engagement, on each platform. Public web search (the `claude_code` adapter) cannot supply them:

- Live runs on 2026-09-24 found the newest indexed LinkedIn post in June 2026 and the newest Instagram post in February 2026, even with broad Ethara-domain searches and a month hint.
- A search result states no likes, comments or impressions.

SocialFetch, already connected for the Social Media Listener, searches the platforms directly. It has a `last-week` date filter and returns each post's engagement.

## Decision

1. **A `socialfetch` source adapter.**
   - It lives in `server/src/bridges/claude-bridge/adapters/socialfetch.ts`.
   - It is the source for LinkedIn, Instagram and X in `platform_trends.source_adapters`. Facebook stays on `claude_code`, because SocialFetch has no Facebook post search.
   - The bridge still plans the searches (at most 3 per platform), judges Ethara relevance, and groups and orders the trends. The adapter only fetches.
   - Routes:
     - LinkedIn: `/v1/linkedin/posts/search` with `datePosted`.
     - Instagram: `/v1/instagram/search/hashtags` with `datePosted`.
     - X: `/v1/twitter/search` with `since:` and `section=top`.
   - Each route costs 1 credit, so at most 9 credits per run.
2. **A fallback source per platform.**
   - `platform_trends.fallback_adapter` is `claude_code`, applied by `adapters/fallback.ts`.
   - If SocialFetch is unavailable (no key) or every search fails (for example, insufficient credits), Claude Code web search answers instead. The platform's reason says so.
3. **Engagement travels end to end.**
   - Trend posts carry `engagement` (reactions, comments, reposts, views). Captured posts set `metricsAvailable` only when the source stated engagement. Results rows show it.
   - Within a period, trends are ordered by engagement when it is stated, so the most engaged trends lead.

## Consequences

- With credits, discovery returns real last-week posts with engagement on LinkedIn, Instagram and X.
- Without credits, it degrades to web search. It reports older posts labelled as such (ADR-015 fallback), never fabricated freshness.
- This relaxes the earlier "Claude Bridge only, no third-party data service" rule for scraping, at the operator's request. The bridge remains the only discovery pipeline, and SocialFetch is one of its sources.
