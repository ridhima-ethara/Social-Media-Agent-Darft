# Image Brief

## Purpose

Decide what the creative should say and show — the concept, the headline, the kicker and the canvas
— so the renderer has an unambiguous instruction rather than a paraphrase of the caption.

## Inputs

- The `CalendarEntry` and its finished caption
- The brand visual identity: accent family, display and body faces, layout tokens
- The target platform, which fixes the canvas
- The resolved configuration for this run

## Outputs

`ImageBriefs` conforming to `image-briefs.schema.json`: `concept`, `headline`, `kicker`, `canvas`,
`altText`, `paletteRole`, and `backgroundPrompt` when a generative background is wanted.

## Rules

1. **The headline is drawn from the caption's claim, not its hook**, and is short enough to set at
   display size on the narrowest supported canvas without wrapping past the configured line budget.
2. **The canvas is fixed by the platform.** It is not a creative choice and is not overridable per
   post.
3. **Alt text describes the image, not the post.** Someone who cannot see it should learn what is on
   the card, not read the caption again.
4. **The background prompt describes an abstract technical field** — structure, depth, gradient,
   geometry. It never describes text, logos, charts with values, people, or brand marks.
5. **Palette role is chosen from the declared accent family** by the concept's tone, not sampled
   freely.
6. **Caption-to-visual coherence is checked**: the headline must restate the caption's claim. A card
   that argues something the caption does not is a defect the brand checker will catch, so it is
   caught here first.

## Boundaries

- **Never asks a diffusion model to draw brand text.** No headline, kicker, wordmark, logo or
  footer is ever generated — those are drawn locally by the renderer, always.
- **Never invents a statistic to put on the card.**
- **Never specifies a canvas the platform does not support.**
- **Never renders.** It briefs; the Visual Rendering skill executes.
- **Never omits alt text.** A card with no alt text does not ship.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The caption has no single clear claim | Use the strongest sentence and flag that the caption is diffuse |
| The headline cannot fit the canvas | Shorten to the claim's subject and verb; never shrink below the legibility floor |
| No generative model is available | Omit `backgroundPrompt`; the renderer draws the vector field alone |
