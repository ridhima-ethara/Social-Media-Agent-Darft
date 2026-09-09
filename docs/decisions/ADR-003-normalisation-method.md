# ADR-003 — Normalisation method

**Status:** Accepted · **Date:** 2026-09-09

> Written against the implementation as it stands, not against v2 §11, which I did not have.

## Question

How are raw counts — post volume, engagement, velocity — reduced to a comparable 0–100 scale?

## Options considered

1. **Batch-max normalisation.** Divide by the largest value in this run.
2. **Fixed ceilings.** Divide by a constant chosen per metric.
3. **Percentile rank within the batch.**
4. **Z-score against a trailing baseline.**

## Decision

**Option 1 — batch-max normalisation for the component scores, with Option 4 (trailing z-score)
reserved for anomaly detection only.**

## Why

The two uses are different questions and deserve different methods.

*Ranking within a run* asks "which of these is strongest relative to the others I just saw?" —
batch-max answers exactly that, needs no history, and is stable on the first ever run. Its known
weakness is that a single outlier compresses everything below it; that is acceptable because the
components are shown separately, so a compressed component is visible rather than hidden.

*Anomaly detection* asks "is this outside what this account normally does?" — that is inherently a
comparison against history, and a z-score against the trailing band at the configured sigma is the
honest form of it. A percentage threshold would be arbitrary.

Option 2 was rejected because a fixed ceiling is a literal number that goes stale silently as the
account grows. Option 3 was rejected for ranking because percentile rank discards magnitude: the
difference between first and second matters, and percentile throws it away.

## Consequences

- Component scores are **not comparable across runs**. A trend score of 82 this week and 82 last week
  do not mean the same thing. Anything comparing across runs must use the growth component or the
  trailing baseline, never the raw composite.
- **A batch of one normalises to 100.** Callers must check batch size before drawing conclusions.
- **Missing is never zero.** An unreported metric is excluded from the normalisation base entirely,
  not treated as the minimum — including it as zero would deflate every other item in the batch.

## What would reopen this

Cross-run comparison becoming a first-class product requirement, which batch-max cannot support and
would force a move to a fixed or rolling baseline.
