<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Image Creator Agent

**Id:** `image` · **Stage:** `create`

## Role

The shipping creative

## What it does

Renders the picture in two layers: an optional model-painted background, and a vector brand layer drawn locally over it. No diffusion model is ever asked to draw brand text. If the model is unreachable the local renderer ships alone, labelled — a post is never left without a picture.

## Contract

| | |
|---|---|
| Consumes | The caption payload · Brand visual tokens · The chosen image model |
| Produces | The rendered asset · Alt text · Export variants |
| Hands off to | `review` |
| Skills | 9 |
| Knobs | 22 |

## Skills

### 1. Choose the approach

`generation.image.approach` · **critical** — cannot be switched off

Selects the visual concept from the caption’s subject matter — reward surface, agent graph, benchmark bars and so on — deterministically, so the same caption always yields the same treatment.

- **In:** Caption payload
- **Out:** Visual concept

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Concept | `concept` | enum — Auto / gradient-field / signal-lines / reward-surface / agent-graph / benchmark-bars / data-lattice | `Auto` | Auto picks from the caption. The named concepts force one treatment, which is useful for a themed series. |
| Vary across a series | `varyBySeries` | boolean | `true` | On, consecutive posts on the same topic get different concepts, so the feed does not look repetitive. |

### 2. Gather references

`generation.image.reference`

Collects the recent assets for this topic so the new creative is recognisably part of the same body of work without repeating it.

- **In:** Media asset history
- **Out:** Reference set

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Assets to consider | `lookbackAssets` | number (0–60) | `12` | How many recent creatives inform the new one. |
| Similarity ceiling | `maxSimilarity` | percent (0–100) | `85` % | How close a new creative may be to an existing one before it is regenerated. This is the visual half of rule 18. |

### 3. Lay out the template

`generation.image.template`

Positions the headline, kicker, accent bar, logomark and footer on the platform’s canvas.

- **In:** Visual concept, Platform
- **Out:** Layout

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Layout | `layout` | enum — Editorial / Centred / Split / Minimal | `Editorial` | Editorial puts the headline lower-left with a kicker above. Centred is for single statements. Split carries a figure alongside. |
| Headline word limit | `headlineMaxWords` | number (3–20) | `12` | The ceiling on the drawn headline. Beyond this the type shrinks below legibility on a phone. |
| Safe margin | `safeMargin` | number (16–160) | `64` px | The keep-clear border in canvas pixels, so nothing important is cropped by a platform preview. |

### 4. Apply brand tokens

`generation.image.tokens` · **critical** — cannot be switched off

Applies the declared accent family and type to the brand layer. Status colours are never used as decoration.

- **In:** Layout, Brand visual tokens
- **Out:** Tokenised layout

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Palette emphasis | `paletteRole` | enum — Primary / Deep / Light / Full range | `Primary` | Which part of the purple family leads. Full range uses all four, which suits carousels. |
| Accent intensity | `accentIntensity` | percent (0–100) | `70` % | How strongly the accent reads against the background. Higher is louder and less editorial. |
| Draw the logomark | `showLogomark` | boolean | `true` | Off, the creative ships unbranded. Rarely correct. |

### 5. Render the asset

`generation.image.render` · **critical** — cannot be switched off

Renders in two layers: an optional model-painted background, and the vector brand layer drawn locally over it. Falls back to the local renderer alone when the model is unreachable, labelled.

- **In:** Tokenised layout, Image model
- **Out:** Rendered asset, Render mode, Fallback reason

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Image model | `model` | enum — brand-svg / gcp-imagen / z-image-turbo | `brand-svg` | Which model paints the background. The brand renderer needs no service and never fails, which is why it is the default. |
| Render timeout | `timeoutMs` | number (5000–180000) | `60000` ms | How long to wait for the model before falling back to the local renderer. |
| Render retries | `retries` | number (0–4) | `1` | How many times to retry a failed model render before falling back. |
| Composite the brand layer locally | `compositeBrandLayer` | boolean | `true` | This is rule 12 and should never be off: no diffusion model is asked to draw brand text. Off produces unusable creative. |

### 6. Export variants

`generation.image.export`

Produces the additional sizes a post needs beyond its primary canvas.

- **In:** Rendered asset
- **Out:** Export variants

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Export variants | `enabled` | boolean | `true` | Off, only the primary canvas is produced. |
| Variants per asset | `maxVariants` | number (0–5) | `2` | How many additional sizes to render. |

### 7. Write alt text

`generation.image.altText` · **critical** — cannot be switched off

Describes what the creative shows, not how it is styled. An asset without alt text cannot be published.

- **In:** Rendered asset, Caption
- **Out:** Alt text

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Alt text limit | `maxChars` | number (60–500) | `200` chars | The ceiling on the description. Long enough to convey the content, short enough for a screen reader to be useful. |
| Describe content, not styling | `describeContentNotStyle` | boolean | `true` | On, alt text names what the image communicates rather than its colours and shapes. |

### 8. Gate on visual compliance

`generation.image.reviewGate` · **critical** — cannot be switched off

Checks the canvas, the alt text and the agreement between the drawn headline and the caption hook before the asset is allowed forward.

- **In:** Rendered asset, Caption
- **Out:** Visual compliance findings

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Minimum headline agreement | `minHeadlineAgreement` | percent (0–100) | `18` % | How much the drawn headline must share with the caption hook. A creative that says something the caption does not is a defect. |
| Block on a failed check | `blockOnFailure` | boolean | `false` | On, a failing asset stops the hand-off. Off, it proceeds with the finding attached for the human to see in the review panel. |

### 9. Compose a video brief

`generation.image.video.compose` · off by default

Writes the shot list and script for a video, without producing one. Off by default — the pipeline briefs video, it does not render it.

- **In:** Caption payload
- **Out:** Video brief

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Target duration | `durationSeconds` | number (10–180) | `45` s | How long the briefed video should run. |
| Shots in the brief | `shots` | number (2–12) | `5` | How many distinct shots the brief calls for. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `image.render` | mutating | Renders or re-renders the picture for a post on the right canvas for its platform. |
