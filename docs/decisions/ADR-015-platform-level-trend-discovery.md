# ADR-015 — Capture is platform-level trend discovery over the last 48 hours

**Status:** Accepted · **Date:** 2026-09-23 · **Extends:** ADR-013, ADR-014

## Context

The capture skill used to call the bridge once per keyword per lane. That meant dozens of Claude Code sessions per run. It also asked "what exists for this keyword" rather than "what is trending on this platform now". The operator asked for a different flow:

- per platform,
- the last 48 hours,
- at most 3 searches per platform and 5 posts per trend,
- only Ethara-relevant trends,
- newest first, handed to the Validation Agent,
- with no generated content.

## Decision

1. `scraping.linkedin.fetch` (the id is a storage key, so it is kept) now calls `discoverPlatformTrends()` once.
   - For each of LinkedIn, Instagram, Facebook and X, the bridge builds at most `maxSearchesPerPlatform` searches (ceiling 3). They come from this run's keywords, the brand context and the Knowledge Base, with broad terms ORed together and a final hashtag search.
   - One Claude Code session runs per platform, all in parallel. Results from any search not in the plan are discarded.
2. **A post is kept only if both hold:**
   - its date is verified inside the window (`datePosted`, default `past-48h`) by decoding its post id, and
   - a configured Ethara keyword appears in the post.
   Kept posts are de-duplicated, grouped into trends by that keyword (at most `maxPostsPerTrend`, ceiling 5), and sorted newest first.
3. **Trends travel to the Validation Agent** as `platformTrends` beside `posts`. The Validation Agent is unchanged. The discovery (each platform's searches, counts, reasons and the trends) is also recorded on the pipeline run as `summary.platformDiscovery`, so the app can show it even when nothing was captured. `finishPipelineRun` now merges into the summary instead of replacing it.
4. **Removed:**
   - the per-keyword × per-lane capture loop;
   - the capture knobs `maxItemsPerKeyword`, `sortBy`, `retries` and `maxParallel`;
   - Apify completely: the integration, the CLI runner, the actor index, the normaliser, their tests, the `apify-cli` dev dependency, its config section and `/health` entry, and its env keys (commented out in the live env files);
   - the Python crawl4ai crawler (`backend/tools/crawl.py`).
5. **Hashtag expansion is off by default.** Discovery already searches hashtags within its budget, and each expansion would be an extra search.
6. **The open web is off by default** (`includeOpenWeb`), because the flow is platform-level.

## Consequences

- **A 48-hour window is usually empty on every platform.** Search engines index social posts late. On 2026-09-23 the newest indexed posts found were weeks old (X: 2026-08-04; LinkedIn: over a year). Each platform reports that with the newest date it found, and the run stops at capture, saying why. Nothing is widened or substituted silently.
- **Cost** falls from about 48 sessions per run to 3 sessions and about 9 searches.
- **Facebook contributes nothing** until a source that states Facebook post dates exists.
- **A `past-quarter` (90-day) window option was added** to `datePosted`, alongside the existing options. The default stays `past-48h`. On 2026-09-23 the newest indexed posts for broad Ethara keywords were 44 days old (X) and 51 days old (LinkedIn), so the 48-hour and 30-day windows came back empty. A 90-day run went through the whole chain: Claude Bridge → Scraping (4 posts) → Validation (4 validated) → Analysis (4 opportunities) → Calendar (6 ideas).
