# ADR-013 — The Scraping Agent's platform lanes are served by the Claude Bridge, not Apify

**Status:** Accepted · **Date:** 2026-09-23 · **Supersedes:** the Apify platform-lane arrangement in `integrations/capture.ts`

## Context

The four platform lanes were served only by Apify actors. On 2026-09-23 the Apify account had hit its monthly usage hard limit ("Monthly usage hard limit exceeded"), so the platform lanes were capturing nothing. The requirement was to remove Apify from the Scraping Agent completely, without adding another third-party scraping service, and to acquire LinkedIn trend data through a Claude Code bridge instead.

## Decision

1. **A new module, `server/src/bridges/claude-bridge/`, does the acquisition.**
   - It reads the Knowledge Base (`knowledge_entries`), the brand voice (`shared/brand-voice.ts` plus `workspaces.brand_voice`/`audience` plus the KB's guideline entries) and the keywords (`keywords` plus `keyword_schedule`).
   - It builds bounded discovery queries.
   - It runs them through Claude Code's WebSearch tool in a headless, isolated session.
   - It keeps only real post URLs taken from the **raw search results**.
   - It dates each post by decoding the timestamp LinkedIn embeds in the activity id.
   - It de-duplicates, applies the freshness window, and scores relevance and trend strength deterministically.
2. **`captureFor(platform)` routes platform lanes to the bridge.** `integrations/capture.ts` and the Scraping Agent handlers no longer import Apify. The `CaptureSource` → `RawPost` contract is unchanged, so the Validation Agent and everything downstream are untouched.
3. **The bridge is platform-modular.** LinkedIn is the only `PlatformModule` today. Instagram, X and Facebook lanes report themselves unavailable, once, at connect time, with that reason. Nothing else is reached for.
4. **The bridge is also a Claude Code tool.** It's an MCP server in `.mcp.json`, and the app can call it at `POST /api/bridges/linkedin-trends`.
5. **Apify's own code stays** for `doctor`'s history, the Apify skill tests and `/health`, but the Scraping Agent does not use it. `/health` now reports `claudeBridge.platformLanes`.

## Consequences

- **No engagement figures on platform rows.** A search result states none, so `metricsAvailable` is `false` and the Validation Agent's engagement, velocity and growth components are inert for those rows. It already handles this (Constraint 2).
- **Freshness is bounded by the search index.** Public indexes lag LinkedIn by weeks. In live tests on 2026-09-23 the freshest indexed post was 20–26 days old. A `past-week` window will therefore often capture nothing, and the run says so. Recent coverage needs a wider window, operator-supplied URLs, or a future authorized adapter (for example an official LinkedIn API) behind the same `TrendSourceAdapter` interface.
- **An undated post never reaches the Scraping Agent.** `RawPost.postedAt` has no "unknown", so it is left out and counted rather than given the capture time.
- **Cost moves from Apify credit to Claude usage.** That is about $0.05–0.10 per search session, bounded by `acquisition.claude_code` in `bridge.config.json`.
- **Author identity.** The public handle in a `/posts/<handle>_…` URL is passed as `authorName`, so keyword discovery counts distinct voices. No other author data is collected unless `include_author_names` is turned on.
