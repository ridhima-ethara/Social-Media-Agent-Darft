# ADR-012 — The platform discovers keywords from what it captured, and they enter as candidates

**Status:** Accepted · **Date:** 2026-09-22 · **Extends:** ADR-002, ADR-009

## The defect

Every run reported the same trending keywords, and the reason was structural rather than a bug in the
ranking.

`scraping.keyword.resolve` reads the `keywords` table. `validation.keyword.trend` then scores **those
same rows**. So "top 5 trending keywords" has never meant *what is trending* — it has meant *which of
the terms someone already typed in scored highest this week*. A topic nobody had thought to seed could
dominate the entire captured corpus and never appear anywhere in the output, because there was no row
for it to be ranked as.

The weekly rota made it tighter still: with `useWeekSchedule` on, the pool is that week's scheduled
rows, so even a term an operator added by hand would not be captured until its rota week came round.

## Decision

**Two new skills, and a change to how the keyword pool is assembled.**

1. `scraping.keyword.discover` — extracts candidate terms from the bodies this run actually captured,
   excluding everything already known.
2. `validation.keyword.emerge` — scores those candidates against the same evidence the trend scorer
   uses, and writes the ones that clear the bar into `keywords` with `origin = 'discovered'`.
3. `scraping.keyword.resolve` now **unions active discovered keywords into the pool regardless of the
   rota**. Without this the whole feature is inert: a promoted term would sit in the table waiting for
   a rota slot that no one will ever create for it.

## A discovered keyword is a candidate, not a scrape

This is the load-bearing part.

`active` defaults to **false** for a discovered keyword, and `autoActivate` defaults to **off**.

A keyword is not a label — it is an instruction to spend money. Each one is a separate Apify call on
every enabled lane, billed per result. A discovery loop that promoted its own findings straight into
the capture set would compound: run one discovers six terms, run two captures those six and discovers
twelve more, and the bill grows without anyone deciding that it should.

So discovery **proposes** and a human **disposes** — the same shape as the review queue, and the same
reason. With `autoActivate` on, promotion is capped by `maxPromotionsPerRun` and every promoted row
still carries the sentence naming the evidence that promoted it.

## What counts as a discovery

A candidate has to clear four independent bars, and each one exists because of a specific way this
goes wrong:

| Bar | Knob | Why |
|---|---|---|
| Appears in several distinct posts | `minPostsCarrying` | A phrase in one post is that post's subject, not a trend. |
| From several distinct authors | `minDistinctAuthors` | One person posting six times about their own launch is not a movement. |
| Touches the brand's subject matter | `minBrandRelevance` | Otherwise the top discovery is whatever recruiters were posting about. |
| Is not already known | — | Excludes existing terms, their synonyms, the brand topic vocabulary and the generic-hashtag list. |

Scoring reuses the existing axes exactly: volume over every post, engagement over
`metricsAvailable` rows only, plays over `viewsAvailable` rows only. A candidate surfaced entirely by
open-web captures is scored on volume and says so, rather than being dropped for having no engagement
figure — constraint 2 applies to a new term exactly as it applies to a seeded one.

## `origin` is recorded, permanently

`keywords.origin` is `'seeded' | 'discovered'`, with `discovered_at`, `discovery_reason` and
`discovery_run_id` beside it.

Not cosmetic: once discovered terms flow into the trend ranking, "is this trending because we chose to
watch it, or because the corpus surfaced it" becomes a question an operator will ask about every row on
the screen, and a column is the only honest way to answer it. It is also what makes the feature
auditable — `discovery_reason` names the posts and the figures that produced the candidate.

Nothing is deleted. A discovered keyword that turns out to be noise is deactivated like any other.

## What this does not do

It does not rewrite history. Stored `keyword_signals` rows were produced under a pool that contained
only seeded terms, and the growth comparison in `validation.keyword.trend` reads them as they are — a
newly discovered keyword simply has no prior runs and is scored neutral on growth, which
`describeTrend` already states in plain language.

## What would reopen this

Discovery consistently proposing terms an operator always rejects, which would mean the four bars are
in the wrong place rather than that the feature is wrong. The counts are knobs precisely so that is a
tuning exercise and not a migration.
