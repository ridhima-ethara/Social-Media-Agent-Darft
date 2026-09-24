# ADR-014 — All scraping goes through the Claude Bridge; Parallel is not a capture source

**Status:** Accepted · **Date:** 2026-09-23 · **Extends:** ADR-013

## Context

ADR-013 moved the Scraping Agent's LinkedIn lane from Apify to the Claude Bridge. The operator then asked for three more changes:

- remove the Parallel key,
- use the Claude Bridge for **all** scraping, and
- give Instagram, Facebook and X the same bridge.

## Decision

1. **Every capture lane is the Claude Bridge, in both tiers.**
   - Node tier: `captureFor()` returns a bridge capture for LinkedIn, Instagram, X and Facebook, and for the open web (`platform === undefined`, the bridge's `web` module).
   - Python tier: `backend/tools/sources.py` calls the bridge CLI (`--mode scraping_agent`). crawl4ai and the Hacker News lane are no longer called. `backend/tools/crawl.py` remains in the repository but nothing imports it.
2. **Each platform module dates items only by decoding what the platform published:**
   - X: the status-id snowflake, `(id >> 22) + 1288834974657`.
   - Instagram: the shortcode, decoded to its media id, then `(id >> 23) + 1314220021721`.
   - Both decodings were checked against posts with publicly known dates.
   - Facebook IDs carry no time, so Facebook items are always undated.
3. **The open web is dated from the page itself:**
   - a full date in the URL path, or
   - the page's own published-date metadata.
   - The page is read only where its robots.txt allows. The fetch is bounded by `page_metadata` in `bridge.config.json`.
4. **An undatable lane skips itself in capture.** `RawPost.postedAt` cannot be unknown, so a Facebook lane would spend searches and yield nothing. It reports itself unavailable, with the reason, unless a date-stating source (an operator URL file) is configured. The Claude Code tool still returns Facebook posts, marked undated.
5. **`PARALLEL_API_KEY` is commented out** in `server/.env` and `server/secrets.env`, not deleted, so it can be restored. Parallel's code remains, because the Knowledge Agent's hashtag research uses it. Without the key those builds report that they found nothing citable.
6. **A trust fix in `sma_captures`.** A stored `posted_at` is trusted only on rows the bridge captured. Earlier paths wrote the capture time as the post date. Re-reading those rows produced "today" dates, which is fabricated evidence.

## Consequences

- **Default recency window is now `past-month`** (the `datePosted` knob), the widest option. With `past-week`, every discovery run failed at capture, so nothing downstream ran. Results are still newest first. A lane that is empty reports why, including the freshest date it did find, and is not retried.
- **Freshness.** Search indexes lag the platforms. On 2026-09-23 the freshest indexed posts were about 20 days old on LinkedIn, 42 on X and 84 on Instagram. Short windows will often be empty on platform lanes, and the output says so, with the freshest date found. The open web is indexed within days and is where fresh material is actually found. Genuinely current platform coverage needs an authorized source, such as the X API recent search or the Instagram Graph API hashtag search, added as another `TrendSourceAdapter`.
- **Engagement.** No lane states engagement, so every capture row carries `metricsAvailable: false`.
- **Cost.** It moves to Claude usage: about one session per keyword per runnable lane, roughly $2.50–5 per discovery run at the defaults.
- **Knowledge Base builds** are inactive until a research key is restored.
