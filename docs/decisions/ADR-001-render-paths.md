# ADR-001 — Render paths

**Status:** Accepted · **Date:** 2026-09-09

> Written against the implementation as it stands. The v2 §11 framing of this question was not
> available to me; if v2 states a different intent, v2 wins and this ADR should be superseded rather
> than edited.

## Question

How many ways may a creative be produced, and which layer is authoritative when they disagree?

## Options considered

1. **Single generative path.** One model paints the whole card, text included.
2. **Single deterministic path.** A vector renderer draws everything; no generative step.
3. **Two-layer composite.** An optional generated background under a locally drawn brand layer.

## Decision

**Option 3 — two-layer composite, with the vector brand layer always local and always authoritative.**

The generated background is optional and may be absent. The brand layer — headline, kicker, accent
bar, logomark, footer — is drawn from brand tokens by `packages/runtime` equivalent code every time.

## Why

Option 1 fails on text. Diffusion models render glyphs unreliably, and a misspelt headline on a
research lab's card is a credibility cost that no amount of retry budget justifies. It also makes the
output non-deterministic, which breaks run replay.

Option 2 is safe but flat, and gives up the one thing generative models are genuinely good at here —
an abstract technical field with depth.

Option 3 keeps determinism where it matters (every word on the card) and non-determinism where it is
cheap (the background). It also degrades cleanly: with no model reachable, the vector layer alone is
a complete, shippable result rather than a placeholder.

## Consequences

- **No diffusion model is ever asked to draw brand text.** This is a boundary in
  `packages/skills/visual-rendering/SKILL.md`, not a preference.
- The renderer must be byte-deterministic given a brief, so a past run can be reproduced.
- Every asset records which model actually ran, and a `fallbackReason` whenever it was not the one
  requested. `model` never names a renderer that did not run.
- Image similarity is computed against prior creatives, never estimated by a model.

## What would reopen this

A generative model that renders arbitrary text reliably enough to pass a spellcheck on the rendered
raster. Until then, the boundary holds.
