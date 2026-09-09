# ADR-006 — Facebook in scope

**Status:** Accepted · **Date:** 2026-09-09 · **Supersedes:** ADR-005

## What changed

ADR-005 deferred Facebook, and named what would reopen it: a brief asking for it. The operator has
asked for it explicitly, twice. That is the brief.

## Decision

Facebook is a fourth publishing target, on equal structural footing with LinkedIn, Instagram and X.

## What that means concretely

- `Platform` is now a closed union of **four**. Every site the compiler flagged has been updated
  deliberately — canvas (1200×630), format-fit column, caption length knob (`facebookMaxChars`),
  publisher limits, preview card, series colour, glyph, label, database CHECK constraints.
- **The brand voice does not change per platform.** Facebook copy is the same research-credible,
  anti-hype register as LinkedIn, at a conversational three-layer depth. Constraint 3 holds: no
  invented reach, no fabricated audience.
- **No monthly rollup is seeded.** Facebook has no reported platform analytics in this workspace, so
  the Dashboard computes its figures from published posts and says so — the same path X uses. A
  synthetic "reported" month would be fabricated evidence.
- Publishing runs through the same two-approval gate and the same demo/live adapter split.
  `FACEBOOK_ACCESS_TOKEN` is the env key; the live adapter throws until it is set and wired.

## What is still open

The audience question ADR-005 raised is not answered by this decision — it is only no longer a
reason to withhold the channel. The Analytics Agent will answer it from this account's own readings
once posts exist, and the Learning Agent will write the lesson back. Until then, Facebook slots are
placed by the same format-fit matrix as every other platform, with a deliberately conservative fit.

## What would reopen this

Four weeks of Facebook readings showing engagement materially below the account's other channels
against the same content — at which point the question becomes whether to keep spending slots on it.
