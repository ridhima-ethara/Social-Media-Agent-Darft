# ADR-004 — Palette tokens

**Status:** Accepted · **Date:** 2026-09-09

> Written against the implementation as it stands, not against v2 §11, which I did not have.

## Question

Where do colours live, and what is allowed to vary between the light and dark themes?

## Options considered

1. **Per-component colours**, chosen at the point of use.
2. **A single token set** that both themes share, with opacity doing the theme work.
3. **Two complete token sets**, one per theme, with a fixed set of deliberate invariants.

## Decision

**Option 3 — every colour is a token, both themes define the complete set, and three categories are
theme-invariant by rule:** chart series colours, platform brand colours, and status semantics.

## Why

Option 1 is how palettes rot. A hex in a component is invisible to the theme system and to review.

Option 2 fails accessibility: a colour that reads at 4.5:1 on a near-black ground rarely does on a
near-white one, and opacity cannot fix a hue that is simply wrong for the surface.

Option 3 costs more to maintain and is the only one that produces a legible product in both themes.

The invariants matter as much as the tokens:

- **Chart series do not change with the theme.** If LinkedIn is one blue in dark mode and a different
  blue in light mode, a reader comparing two screenshots cannot tell whether the series changed. Only
  grid, axis ink and hover wash follow the theme.
- **Platform brand colours are the platforms' identity, not ours.** They are exempt from tokenisation
  and are named as such in the verify script's exemption list rather than being quietly ignored.
- **Status colours are reserved.** Good, warn, serious and critical are never reused as a chart
  series, because a red line meaning "Instagram" next to a red badge meaning "failed" is a real
  misread waiting to happen.

## Consequences

- `npm run verify` fails on any hard-coded six-digit hex in a component outside the declared
  exemptions. The exemption list is short, explicit, and reviewed when it changes.
- Adding a colour means adding it to **both** theme blocks. There is no single-theme token.
- Chart series must be contrast-validated against both surfaces, not just the dark one.

## What would reopen this

A third theme (high contrast), which would make the two-block structure insufficient and force a
generated palette.
