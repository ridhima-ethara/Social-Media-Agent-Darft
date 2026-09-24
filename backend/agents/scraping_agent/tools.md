## `available_sources`

Reports which platforms the Claude Bridge can discover on right now — LinkedIn, Instagram, Facebook,
X — and, for any it cannot, why (for example, Facebook post ids carry no date). It makes no search.

**Call this first, every run.** Without it you cannot honestly state what the capture could cover.

## `fetch_posts(keywords, max_items, window_days)`

Runs **one** platform-level trend discovery through the Claude Bridge: one quoted topic per search,
with the current month named, built from the keywords, the research corpus, the brand context and
the Knowledge Base. Returns
the posts it kept (newest first), the trends (`platform_trends`: platform, trend, hashtags, post
URLs with dates and authors, matched Ethara keywords, reason), and, in `unreachable`, the reason
each platform produced nothing.

- `keywords` — pass the full list you were given, in the order given; call this once, not per keyword
- `max_items` — from the resolved settings; the bridge's own cap of five posts per trend governs
- `window_days` — from the resolved settings; `0` (the default) is the current month so far,
  anything else a rolling window of that many days

**Never** call this with a keyword that was not supplied to you.

## `harvest_hashtags(posts, min_occurrences)`

Extracts hashtags from post bodies, counts occurrences, and records the strongest post carrying
each tag.

- `posts` — the posts returned by `fetch_posts`, unmodified
- `min_occurrences` — from the resolved settings

This tool counts. It does not rank, score or validate — a hashtag candidate leaves here with no
verdict attached, and it is not your job to give it one.
