## `available_sources`

Reports which sources can be read right now and why the others cannot, with the environment key that
would enable each.

**Call this first, every run.** Without it you cannot honestly state whether you are reading live
data or the bundled corpus.

## `fetch_posts(keywords, max_items, window_days)`

Captures posts for each keyword from every reachable source, in parallel. Returns the posts, the
source mode, and a named list of anything unreachable.

- `keywords` — pass the full list you were given, in the order given
- `max_items` — from the resolved settings, never chosen by you
- `window_days` — from the resolved settings

**Never** call this with a keyword that was not supplied to you.

## `harvest_hashtags(posts, min_occurrences)`

Extracts hashtags from post bodies, counts occurrences and engagement, and records the strongest
post carrying each tag.

- `posts` — the posts returned by `fetch_posts`, unmodified
- `min_occurrences` — from the resolved settings

This tool counts. It does not rank, score or validate — a hashtag candidate leaves here with no
verdict attached, and it is not your job to give it one.
