# ADR-009 — One trend scorer, with a format-aware weight set; views are captured before they are weighted

**Status:** Accepted · **Date:** 2026-09-22 · **Extends:** ADR-002

## The question (Phase 0 · D3)

Dexter scores keywords on volume / engagement / velocity / growth. The Phaze AI specification scores
posts on views (40%) / engagement rate (35%) / comment volume (25%). Which wins?

## Decision

**One scorer. `validation.keyword.trend` stays the only implementation.** The specification's model
is expressed as a *second declared weight set* on that same skill, selected by a `weightProfile`
knob, and the profile that ran is recorded in `skill_runs.config_used` like every other knob.

Two scoring implementations would disagree within a quarter, and the disagreement would surface as
two different numbers for the same keyword on two different screens.

## The part that mattered more than the weights

The specification weights **views**, and this codebase captured no views at all. `RawPost` carried
`reactions`, `comments` and `reposts`; `normalisePost()` read no view or play key from any actor.

Declaring a `viewsWeight` knob over data that does not exist would be a knob that changes nothing —
and worse, an operator-visible claim that the platform weighs views when it does not. So views are
**captured first**:

- `RawPost.views` and `RawPost.viewsAvailable`, read from the actor keys that actually state them
  (`videoPlayCount`, `videoViewCount`, `viewCount`, `play_count`, `views`, `view_count`).
- `scraped_items.views` and `scraped_items.views_available`.
- **`views_available = false` means not stated, and `views = 0` under it means nothing.** A
  LinkedIn text post has no view count and never had one; an open-web citation has no view count and
  never had one. Neither is a video that nobody watched.

Every view-derived figure — the weight, the `highSignalViewFloor` flag, the `minViewsToConsider`
filter — runs over `views_available` rows only, excludes the rest from its divisor, and states the
exclusion on the result.

## The weight profiles

| Profile | volume | engagement | velocity | growth | views | ER | comments |
|---|---|---|---|---|---|---|---|
| `long-form` (default) | 25 | 35 | 20 | 20 | — | — | — |
| `short-form` | — | — | — | — | 40 | 35 | 25 |

`long-form` is exactly what ADR-002 already decided and what every stored `keyword_signals` row was
produced under. It stays the default, so nothing about existing history changes meaning.

`short-form` is the specification's model, available to select, and honest about its own gaps: a run
where no lane stated a view count scores on engagement rate and comment volume alone, drops
`viewsWeight` from the divisor for **every** keyword uniformly, and says so in the trend reason.
That is the same uniform-versus-selective absence rule `validation.keyword.trend` already applies to
engagement, applied to a third axis.

## Filtering is a separate skill, because filtering is a separate act

The specification's FILTERING block — under 10,000 views, under 2% engagement, older than 30 days —
is **not** scoring. It is a verdict. It lands in a new skill, `validation.item.filter`, and it obeys
the law the specification breaks hardest:

> "Remove any post with under 10,000 views."

A post captured through the open-web lane carries `metrics_available = false` and
`views_available = false`. A naive floor would delete every open-web capture as underperforming.
So the filter applies **only to rows that state the figure it tests**, and a row that does not state
it survives carrying the caveat in its reason. Nothing is deleted either way: `validation.item.filter`
writes a verdict and a reason, per the standing law.

## What would reopen this

A third distribution — long-form video, or a platform whose engagement is dominated by saves — that
neither weight set describes. The answer then is a third declared profile, not a third scorer.
