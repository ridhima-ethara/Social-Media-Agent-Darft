# Image Brief

> **Ethara AI Image Generation Skill.** This document defines how Ethara.AI's
> social-media agent turns a complete caption into a relevant, branded visual.
> The agent must interpret the caption, develop a visual concept, and generate
> from a dedicated image prompt. Copying the opening line onto a background does
> not satisfy the task.
>
> This replaces the earlier Image Brief section rather than appending a
> conflicting one. It keeps the research and brand safeguards and adds
> reference-image handling, light and dark modes, mandatory logo placement, and
> platform layouts.

## Skill metadata

- **Name:** image-brief
- **Description:** Create caption-led image briefs and production prompts for
  Ethara.AI social visuals. Support technical and metaphorical treatments,
  reference-image inputs, dark and light modes, approved branding, and
  platform-specific layouts.

## Purpose

Loaded by the Image Creator. Create visuals that communicate the central idea of
the caption through a meaningful image, supported by minimal text where useful.

Ethara.AI must appear as a frontier AI research lab: precise, credible, modern,
research-forward, and visually distinctive.

Produce **one strongest visual direction by default.** Produce alternatives only
when requested — the pipeline can still author a second option (`B`) and measure
its distinctness when the operator asks for a choice, but a single, best
direction is the default output.

This skill defines the visual concept and the production prompt. The configured
image-generation stage renders the creative. Do not claim an image has been
generated when only a brief has been produced.

## Inputs

Use the following where available:

- Complete approved caption.
- Shared CoreContext and supporting research material.
- Source evidence or Knowledge Base `key_point` references.
- Target audience.
- Target platform and placement.
- Approved Ethara.AI brand identity and logo assets.
- Reference image, when supplied (`public/brand/references/`).
- Requested visual direction, theme, or dimensions.
- Elements the user has explicitly locked during iteration.

The caption determines the message. Supporting sources determine which factual
claims may appear visually. If the caption and supporting evidence conflict,
flag the exact conflict before representing the disputed claim. If no caption is
supplied, use the explicit topic or CoreContext — do not invent a caption and
treat it as approved.

## Outputs

One structured brief (the strongest direction), in the shape the Output contract
section specifies. When alternatives are requested, return the additional
option(s) alongside it with their measured distinctness. Each brief carries
everything required to produce the visual, plus the `generation_prompt` and the
`compositing_instructions` that separate model generation from brand-asset
placement.

## Rules

These are the skill's numbered rules. The rule numbers are cited from the backend
`instructions.md` and `tools.md`, so a disagreement is a bug in those files, not
a second opinion.

### 1 — Interpret the entire caption

Before choosing imagery, identify the central idea, the mechanism, the evidence,
the audience, and the single visual takeaway. Reduce this to one sentence:
`core_visual_thesis`.

Do not illustrate every paragraph, and do not choose imagery by isolated keyword
matching — "agents" is not automatically robots, "benchmarks" is not
automatically charts, "compute" is not automatically server racks. The visual
represents the caption's argument, not merely its topic.

### 2 — Mandatory workflow

`complete caption → core_visual_thesis → visual concept → detailed
generation_prompt → prompt validation → generation and brand-asset placement →
actual-image validation → Brand Voice review → human review.`

- Never send the raw caption as the entire generation prompt.
- Never automatically use the caption's first line as the image headline.
- A text-only poster does not satisfy a standard image request unless a
  typographic creative is explicitly requested.

### 3 — Select the visual treatment

Choose the approach that best communicates the thesis:

| Caption content | Suitable treatment |
|---|---|
| Supported numerical comparison | Restrained chart |
| Process or mechanism | Process or systems diagram |
| Sequential decisions | Trajectory or state-transition visual |
| Component relationships | Architectural schematic |
| Research concept for a broad audience | Clear conceptual metaphor |
| Actual product, person, or event | Relevant approved imagery |
| Structure plus explanation | Restrained hybrid |

Do not default to diagrams, metaphors, or 3D objects for every post. Follow a
requested treatment when it preserves factual accuracy. Never use a quantitative
chart without supporting data.

### 4 — Research metaphors

A metaphor may make a research concept accessible, but it must preserve the
relationship the caption explains. For each metaphor specify: the research
concept, the visual object/setting, how their relationships correspond, and what
the metaphor must not imply.

Reject a metaphor that needs a long explanation, implies human consciousness or
intent without justification, implies guaranteed success, distorts the
mechanism, or looks attractive with no clear connection to the caption. Keep
conceptual representations distinguishable from measured results.

### 5 — Futuristic direction, honestly

Interpret "futuristic" as precise, contemporary, and engineered: clean geometry,
controlled depth, refined materials, subtle gradients, structured environments,
thin deliberate technical lines, restrained illumination around meaningful
elements.

Avoid glowing brains, humanoid robots, holographic faces, decorative code or
binary, random circuits/nodes/arrows, excessive neon/particles/lens flares,
generic sci-fi environments, and fake interfaces/equations/dashboards. Futuristic
styling must never reduce comprehension.

### 6 — Brand colours and theme selection

Use the approved Ethara Purple family and no unrelated accent by default:

| Role | Hex |
|---|---|
| Primary Ethara Purple | `#8B2CF5` |
| Deep Purple | `#5E1BC7` |
| Bright Purple | `#A855F7` |
| Glow Purple | `#C084FC` |

Supporting neutrals: black and near-black, charcoal and cool grey, white and
off-white. Ground and ink are structural, not accents. Purple must direct
attention toward the important element — do not use every shade in every image.
Approved photographs and reference subjects may retain natural colours.

> **Palette note / flagged exception.** The supplied spec's example prompt also
> mentions a magenta accent (`#E9096F`). The enforced brand palette in this
> codebase is the purple family with primary `#8B2CF5`, asserted by
> `scripts/check-brand-voice.ts`, `shared/brand-voice.ts` and ADR-004. Magenta is
> **not adopted** here to avoid breaking that tested invariant; if it is to
> become an approved accent, change `BRAND.visual` and the brand-voice check
> first, then this table.

`theme_mode` is chosen per topic, readability, reference direction, and request:

- **Dark mode.** Black / near-black / charcoal ground, legible light text,
  controlled purple accents. Suits depth, spatial relationships, a focused hero.
- **Light mode.** White / off-white / very light neutral ground, dark text,
  controlled purple accents. Suits diagrams, labels, comparisons, education.

Do not force every creative into dark mode, and do not alternate randomly. Both
modes must remain recognizably Ethara.AI.

### 7 — Composition and breathing space

Use one dominant focal visual. Default hierarchy: focal visual, then optional
headline, then essential labels, then the Ethara.AI logo. Maintain generous
negative space around visual, text, and logo. A requested typographic creative
may prioritize text.

Composition targets (targets, not platform requirements — expressed as ranges in
`negative_space` rather than as literal knobs): keep roughly a quarter to a third
of the canvas as quiet space where the composition allows; keep essential content
inside the canvas edges by the placement's safe margin; prefer a small number of
primary components in a simple diagram and add more only when accuracy needs it.
Do not fill empty space with decoration. If information cannot fit comfortably,
simplify or propose a carousel.

### 8 — On-image text

The image supports the caption; it does not reproduce it. Default to no headline
when the visual communicates alone; otherwise one short headline (a few words),
optional brief supporting text only when it adds essential context, and short
technical labels where required. Keep total on-image words low for a static
creative, excluding the logo, essential chart labels, and source attribution.

The headline must come from the caption's central idea, complement the visual,
stay within the evidence, and be written independently for the image. The caption
hook may be reused only when it genuinely serves the concept — never selected
automatically. No caption paragraphs, hashtags, or unnecessary CTAs. Use Roboto
for headlines and DM Sans for supporting text. If generation cannot reproduce
exact typography reliably, apply text through the layout/compositing stage.

### 9 — Mandatory logo

Every completed image must contain the approved Ethara.AI logo — every carousel
slide, every platform variant. Use the actual approved asset. Never ask the
generator to invent or redraw it, never substitute typed "Ethara.AI", never
distort/stretch/rotate/recolour/crop/obscure it, never add unapproved effects.

Use the approved light or dark logo variant appropriate to the background
(selecting an approved variant is not recolouring). Follow approved placement and
clear-space rules; where none exist, use a quiet corner inside the safe area,
keep the logo secondary but readable, and hold at least one logo-height of clear
space as a provisional convention. Prefer placing the logo asset after base-image
generation to preserve exact geometry. If the approved asset is unavailable,
return `NEEDS_ASSET: approved Ethara.AI logo` — concept work may continue, but the
final image cannot pass validation without the logo.

### 10 — Reference-image workflow

When a reference image is supplied (from `public/brand/references/`):

1. Inspect it before writing the prompt.
2. Identify what the user wants retained — composition, spacing, subject,
   lighting, materials, typography, colour treatment, or overall mood.
3. Identify elements explicitly locked by the user.
4. Adapt the reference to the caption's thesis and Ethara.AI branding.
5. Pass the actual image to the generation/editing stage through its supported
   reference-input mechanism.
6. State what must be preserved (`reference_preserve`) and what must change
   (`reference_change`).
7. Validate the result against both the reference instructions and the caption.

Do not treat the reference as evidence for research claims. Do not copy unrelated
wording, data, logos, or third-party branding. Do not let a reference's palette
override Ethara.AI's palette unless an approved exception is explicitly
requested. If the reference conflicts with the caption or a locked constraint,
identify the conflict rather than silently changing it. If the rendering stage
cannot accept reference images, report that limitation — do not claim a text
description preserves the reference exactly.

### 11 — Platform sizes

Use the requested platform **and** placement. These are working export presets,
not permanent platform specifications:

| Placement | Working size | Ratio |
|---|---|---|
| LinkedIn feed square | `1080 × 1080` | 1:1 |
| LinkedIn feed portrait | `1080 × 1350` | 4:5 |
| LinkedIn feed landscape | `1200 × 627` | ~1.91:1 |
| LinkedIn carousel | `1080 × 1080` or `1080 × 1350` | 1:1 or 4:5 |
| LinkedIn personal banner | `1584 × 396` | 4:1 |
| Instagram feed portrait | `1080 × 1350` | 4:5 |
| Instagram feed square | `1080 × 1080` | 1:1 |
| Instagram Story / Reel cover | `1080 × 1920` | 9:16 |
| Facebook feed square | `1080 × 1080` | 1:1 |
| Facebook feed portrait | `1080 × 1350` | 4:5 |
| Facebook Story | `1080 × 1920` | 9:16 |
| X feed landscape | `1600 × 900` | 16:9 |
| YouTube thumbnail | `1280 × 720` | 16:9 |

Use current platform configuration when it differs. If no platform is specified,
use LinkedIn square and state the assumption in the brief. Recompose per aspect
ratio; never stretch. Account for interface overlays, profile-photo overlap on
banners, feed/preview crops, mobile readability, and safe areas. If the generator
cannot produce exact dimensions, use the closest supported ratio and finish on an
exact-size canvas. Verify exported pixel dimensions.

### 12 — Production prompt requirements

The final `generation_prompt` must explicitly describe: the core visual thesis,
the selected treatment, the actual focal subject, meaningful relationships,
spatial composition and viewpoint, dark or light mode, the brand palette and what
purple highlights, exact permitted text (or "no on-image text"), text placement or
reserved region, reserved logo region and asset-placement instruction, location
of breathing space, reference-image instructions (when applicable), required
elements and exclusions, and target platform/placement/dimensions/aspect ratio.

Separate generation instructions from `compositing_instructions` when text or the
logo is added after generation. Never rely on vague prompts like "create a
futuristic AI image based on this caption."

### 13 — Factual and technical integrity

Every factual visual claim must trace to supplied evidence. Never invent
benchmark results, performance improvements, rankings, percentages, sample sizes,
chart values, measured curves, research findings, or customer/partnership claims.

For charts, preserve units, labels, comparison conditions, and source context;
use a deterministic chart/diagram tool when exact values or relationships are
essential. For diagrams, every node must have a meaningful role, every arrow a
supported relationship, and sequence/direction must be correct; feedback must not
imply automatic improvement. A metaphor must not imply a proven outcome absent
from the evidence.

### 14 — Iteration integrity and locked elements

An element the operator locked is held from the previous brief, never re-derived.
A lock with nothing to hold it from is reported as unheld. During iteration, never
change an element the user asked to keep unchanged. When refining an existing
creative, preserve everything not explicitly requested to change — change only the
specifically requested element.

### 15 — Validation and revision

Validate the prompt before generation, then inspect the actual image. Required
checks: same central thesis as the caption; a meaningful visual beyond copied
caption text; correct brand colours and selected mode; approved logo present and
undistorted; clear focal point and breathing space; minimal, legible, accurate
text; correct reference treatment; preserved locked elements; no invented factual
claims; correct diagram relationships or chart data; correct output dimensions and
crop safety.

A compliant prompt does not prove the resulting image complies. On a failed
check: identify the specific failure, revise the affected elements, reinspect,
and preserve the thesis and locked elements. Allow up to the configured number of
automatic correction attempts per candidate
(`image_agent.max_correction_attempts`); if unresolved, return the remaining
issue for review rather than marking the image ready. Apply the `brand-voice`
skill to the final candidate before human review and preserve its verdicts:
`APPROVED`, `REVISE`, `NEEDS_INTERNAL_APPROVAL`, `CANNOT_VERIFY`. Never invent a
validator result or publish automatically.

## Output contract

Return one structured brief with these fields. **Keep these field names unchanged
for developer implementation:**

- `core_visual_thesis`
- `caption_basis`
- `visual_approach`
- `approach_reason`
- `focal_subject`
- `composition`
- `metaphor_mapping` — if applicable
- `technical_relationships` — if applicable
- `evidence_basis`
- `theme_mode`
- `palette`
- `exact_on_image_text`
- `typography`
- `negative_space`
- `logo_asset`
- `logo_position`
- `reference_asset` — if supplied
- `reference_preserve`
- `reference_change`
- `locked_elements`
- `platform`
- `placement`
- `width_px`
- `height_px`
- `generation_prompt`
- `compositing_instructions`
- `must_avoid`
- `alt_text`
- `validation_status`
- `unresolved_issues`

Record `validation_status` as `not_run` until the relevant check is performed.
After rendering, additionally return: the actual image output reference, verified
export dimensions, the post-generation inspection result, and the Brand Voice
verdict when performed. `alt_text` must describe the actual final image, its
meaningful relationships, and essential visible text.

## Boundaries

The Image Brief skill MUST NOT:

- Send the raw caption, or its first line, as the generation prompt or headline.
- Produce a text-only poster for a standard image request unless a typographic
  creative was explicitly requested.
- Fabricate chart data, benchmark values, rankings, percentages, or any factual
  claim absent from the supplied evidence.
- Use a chart when the evidence carries no supporting data.
- Illustrate every paragraph instead of one focal system.
- Ask a diffusion model for on-image brand text, numerals, logos, or faces — the
  brand layer and logo are composited from approved assets after generation.
- Distort, recolour, stretch, rotate, crop, or obscure the Ethara.AI logo, or
  substitute typed text for the approved mark.
- Let a reference image's palette or wording override Ethara.AI branding, or
  treat the reference as research evidence.
- Change an element the user locked, or change anything not explicitly requested
  during a refinement.
- Introduce an unapproved accent colour (including magenta `#E9096F`) unless the
  approved brand configuration is changed first.
- Claim an image was generated when only a brief was produced, or invent a
  validator verdict, or publish/schedule/approve anything.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| Subject sounds quantitative, evidence carries no figures | Take a diagram or conceptual treatment; report the chart as declined for want of data |
| Caption and evidence conflict | Flag the exact conflict before representing the disputed claim |
| A requested placement is not configured | Fall back to the platform default and name the substitution |
| The logo cannot hold its clear space | Report the violation; never shrink or crop the mark |
| The approved logo asset is unavailable | Return `NEEDS_ASSET: approved Ethara.AI logo`; continue concept work, fail final validation |
| A reference image conflicts with the caption or a locked element | Identify the conflict; do not silently change it |
| The rendering stage cannot accept reference images | Report the limitation; never claim text preserved the reference exactly |
| A locked element has nothing to hold it from | Derive it and report the lock as unheld |
| No generative model is available | Omit the background prompt; the renderer draws the brand vector layer alone and stamps the reason |
| The caption arrives as an object, not a string | Read its body; never render an object's text form |
