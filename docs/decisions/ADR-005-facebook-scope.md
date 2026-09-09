# ADR-005 — Facebook scope

**Status:** Superseded by ADR-006 · **Date:** 2026-09-09

> Written against the implementation as it stands, not against v2 §11, which I did not have.
> This ADR records a **deferral**, which is itself a decision and should be visible as one.

## Question

Is Facebook in scope as a publishing target, and if not, what does the architecture owe it?

## Options considered

1. **In scope now.** Full adapter, canvas, format rules, preview and analytics.
2. **Out of scope permanently.** Remove the possibility from the platform type.
3. **Out of scope now, structurally accommodated.** Three platforms ship; the seams that would need
   to open stay open.

## Decision

**Option 3 — deferred, not excluded.** LinkedIn, Instagram and X ship. Facebook is not implemented,
and nothing in the architecture forecloses it.

## Why

The audience this platform is built for — AI researchers, ML engineers, heads of AI and CTOs — is on
LinkedIn and X, and to a lesser extent Instagram. Facebook reaches a different audience with
different norms, and shipping a channel the brand has no voice for would produce content nobody
reviewed properly.

Option 1 spends real effort (canvas, preview, adapter, analytics mapping, format rules) on the
lowest-value channel of the four.

Option 2 was rejected because it is a stronger claim than the evidence supports. The audience
argument is about *today's* audience, and that can change.

## Consequences

- `Platform` remains a closed union of three. Adding a fourth is a deliberate, typed change that the
  compiler will surface at every site that needs updating — which is the point.
- Anything that switches on platform must handle all members exhaustively. No default branch that
  would silently swallow a new platform.
- The `PlatformAdapter` interface stays platform-agnostic, so a Facebook adapter is an addition
  rather than a refactor.
- Analytics must not assume three platforms in its aggregation shape.

## What would reopen this

A brief that names a Facebook audience, plus a brand voice defined for it. Capability alone is not a
reason — we can already reach a channel we have nothing to say on.
