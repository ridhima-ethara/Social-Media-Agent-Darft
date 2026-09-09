# Visual Rendering

## Purpose

Produce the shipping creative: an optional model-painted background composited under a vector brand
layer that is always drawn locally. A post is never left without a picture.

## Inputs

- `ImageBriefs` from the Image Brief skill
- The brand visual identity: accent family, faces, geometry, safe margins
- The available renderers and whether each is reachable
- The resolved configuration for this run

## Outputs

A `MediaAsset`: `dataUri`, `model`, `renderMode`, `concept`, `canvas`, `width`, `height`, `altText`,
and `fallbackReason` whenever the requested renderer was not the one used.

## Rules

1. **The render is two layers, always.** An optional generated background, and a locally drawn
   vector brand layer over it. The brand layer is never generated.
2. **No diffusion model is ever asked to draw brand text.** Headline, kicker, accent bar, logomark
   and footer are drawn from the brand tokens, locally, every time.
3. **The local renderer is deterministic.** The same brief produces byte-identical output, which is
   what keeps a past run replayable.
4. **When no model is reachable, the vector layer renders alone** and the asset card carries the
   reason. This is a complete, shippable result, not a placeholder.
5. **The canvas comes from the brief.** The renderer does not reinterpret it.
6. **Image similarity against previously published creatives is computed, never judged.** Above the
   image cap, the palette role rotates and the render repeats.
7. **Alt text travels with the asset.** It is not regenerated here and not dropped.

## Boundaries

- **Never ships without the brand layer.** A bare generated image is not a valid output.
- **Never renders text through a generative model.**
- **Never blocks the pipeline on a model failure.** It falls back and stamps.
- **Never silently substitutes a different canvas.**
- **Never claims a model produced the image when the fallback ran.** `model` names what actually ran.
- **Never writes the asset to a post.** It returns it; publishing attaches it.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The image model times out | Vector layer alone, `fallbackReason` naming the timeout and the env key |
| The headline overflows the safe margin | Wrap to the configured line budget; truncate at a word, never mid-word |
| The generated background is unreadable behind text | Composite at the configured opacity floor; legibility outranks the background |
