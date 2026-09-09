# ADR-002 — Validator ranking

**Status:** Accepted · **Date:** 2026-09-09

> Written against the implementation as it stands, not against v2 §11, which I did not have.

## Question

Is a keyword's trend a single score, or a set of independent signals the operator reads separately?
And if it is a single score, what may collapse into it?

## Options considered

1. **Model judgement.** Ask a model whether a keyword is trending.
2. **Single metric.** Rank on engagement alone.
3. **Weighted composite of four declared components**, each normalised, each visible.

## Decision

**Option 3 — a weighted composite of volume, engagement, velocity and growth**, with the four weights
declared in config, summing to one hundred, and each component surfaced independently in the UI
alongside the composite.

## Why

Option 1 is unreproducible and unexplainable. "The model thought so" cannot be audited, cannot be
tuned, and cannot be defended to someone asking why their keyword was dropped.

Option 2 is reproducible but wrong: engagement alone rewards a single viral post over a genuine
sustained shift, which is the opposite of what "trending" should mean here.

Option 3 is reproducible, tunable and explainable. Critically, the four components are shown
separately — the composite is a convenience for sorting, not a replacement for the evidence.

## Consequences

- The weights are config keys, never literals. A weight set that does not sum to one hundred is a
  **reported configuration error**, not something silently rescaled — silent rescaling would mean the
  operator's stated intent and the system's behaviour diverge without anyone being told.
- Growth compares against **this account's own trailing runs**. With fewer runs than the configured
  minimum, growth contributes zero and the reason says so rather than implying stability.
- Every ranked keyword carries a `trendReason` naming its numbers.
- Ranking is never asked of a model. Scoring is arithmetic.

## What would reopen this

Evidence that the four components are collinear enough that the composite is doing no work, or a
fifth signal (e.g. author authority) that materially improves ranking on held-out data.
