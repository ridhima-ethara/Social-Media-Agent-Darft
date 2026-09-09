## `score_keywords(posts, keywords, ...)`

Ranks keywords on a weighted composite of volume, engagement, velocity and growth. Returns each
component separately alongside the composite, plus a `weight_warning` when the four weights do not
sum to 100.

**Call this first.** Everything else depends on knowing which keywords trend.

All four weights come from the resolved settings. Never pass a weight you chose yourself.

## `rank_hashtags(candidates, trending_terms, top_per_keyword)`

Ranks each trending keyword's hashtags on engagement per post and volume, returning the top N per
keyword. Pass only the terms `score_keywords` marked as trending.

## `similarity_check(text, priors, threshold)`

Dice similarity over content-word bigrams. Deterministic: the same pair always scores identically,
which is what lets a past verdict be re-derived years later.

**Always call this before declaring a duplicate.** Never estimate similarity yourself — a model's
guess is unreproducible and unauditable.

## `route_verdict(item, relevance, ...)`

Applies the four-verdict gate in strict priority order and returns the verdict with a reason naming
the threshold it fell against.

This is the **only** way a verdict is produced. Never write a verdict string yourself.

## `consolidate_hashtags(ranked, top_hashtags)`

Merges the per-keyword hashtag sets, de-duplicates across keywords including semantic aliases
(`#RL` ≡ `#ReinforcementLearning`), and re-ranks globally into the consolidated top set the
Knowledge Base researches.

Call this last, once, after every keyword's hashtags are ranked.
