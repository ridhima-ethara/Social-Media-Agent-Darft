---
name: image-brief
description: >
  Create caption-led image briefs and production prompts for Ethara.AI social
  visuals. Covers archetype selection, technical and metaphorical treatments,
  reference-image inputs, dark and light modes, approved branding, the
  generation/compositing split, and platform-specific layouts.
---

# Image Brief

## Purpose

Turn a complete caption into a relevant, branded visual.

The agent interprets the caption, develops a visual concept, and generates from a dedicated image
prompt. **Copying the opening line onto a background does not satisfy the task.**

Ethara.AI must read as precise, credible, modern and visually distinctive. Produce **one strongest
direction by default**; alternatives only when requested.

This skill defines the concept and the production prompt. The configured image-generation stage
renders. Never claim an image has been generated when only a brief exists.

---

## Inputs

- Complete approved caption
- Shared CoreContext and supporting research
- Source evidence or Knowledge Base `key_point` references
- Target audience, platform and placement
- Approved Ethara.AI brand identity and logo assets
- Reference image, when supplied
- Requested direction, theme or dimensions
- Elements the user has explicitly locked during iteration

The caption determines the message. Supporting sources determine which factual claims may appear.
If caption and evidence conflict, **flag the exact conflict** before representing the disputed claim.
If no caption is supplied, use the explicit topic or CoreContext — never invent a caption and treat
it as approved.

---

## Mandatory workflow

```
complete caption → core_visual_thesis → archetype → visual concept
  → generation_prompt + compositing_instructions → prompt validation
  → generation and brand-asset placement → actual-image validation
  → Brand Voice review → human review
```

- Never send the raw caption as the generation prompt.
- Never automatically use the caption's first line as the headline.
- A text-only poster does not satisfy a standard image request unless a typographic creative was
  explicitly requested.

---

## 1 · Interpret the entire caption

Identify the central idea, the mechanism, the evidence, the audience, and the single visual
takeaway. Reduce to one sentence: `core_visual_thesis`.

Do not illustrate every paragraph, and never choose imagery by isolated keyword matching. "Agents"
is not automatically robots. "Benchmarks" is not automatically charts. "Compute" is not automatically
server racks. **The visual represents the caption's argument, not its topic.**

---

## 2 · Choose the archetype

Ethara creatives repeat a small set of compositions. Choose by what the thesis **is**, never by what
it is about.

| Archetype | The thesis it fits | The shape |
|---|---|---|
| `depth-section` | Visible result vs the machinery that produced it | A divider. One luminous node above, a descending spine of labelled nodes below. |
| `cycle` | A process that repeats and compounds | A closed ring of icon nodes, one centred label naming the loop, optional insight strip beneath. |
| `state-flow` | A mechanism with named transitions between named states | Outlined nodes, directed edges carrying their own labels. Solid = forward, dashed = return. |
| `stage-bar` | A transformation: raw input becomes a different kind of thing | Three stations left to right, each captioned with what it is and what it does. |
| `annotated-object` | One subject that reads differently depending on who looks | A single sculptural form, leader lines to annotations placed around it. |
| `provocation` | A question posed, deliberately unanswered | One high-contrast image, one line of condensed caps. Nothing else. |

Distinctness from recent creatives is **computed against the configured window, never judged**.
Repeating an archetype is allowed when the thesis calls for it; repeating it because it is easy is
the failure this rule exists to catch.

**When none fits**, say so and choose a treatment from §3. Forcing a thesis into the nearest
archetype produces a picture that argues something the caption did not.

---

## 3 · Select the visual treatment

| Caption content | Suitable treatment |
|---|---|
| Supported numerical comparison | Restrained chart |
| Process or mechanism | Process or systems diagram |
| Sequential decisions | Trajectory or state-transition visual |
| Component relationships | Architectural schematic |
| Research concept for a broad audience | Clear conceptual metaphor |
| Actual product, person or event | Relevant approved imagery |
| Structure plus explanation | Restrained hybrid |

Do not default to diagrams, metaphors or 3D objects for every post. Follow a requested treatment
when it preserves factual accuracy. **Never use a quantitative chart without supporting data.**

---

## 4 · Research metaphors

A metaphor may make a concept accessible, but it must preserve the relationship the caption explains.
For each, specify: the research concept, the visual object or setting, how their relationships
correspond, and **what the metaphor must not imply**.

Reject a metaphor that needs a long explanation, implies human consciousness or intent without
justification, implies guaranteed success, distorts the mechanism, or looks attractive with no clear
connection to the caption. Keep conceptual representations distinguishable from measured results.

---

## 5 · Futuristic, honestly

Interpret "futuristic" as **precise, contemporary and engineered**: clean geometry, controlled depth,
refined materials, subtle gradients, structured environments, thin deliberate technical lines,
restrained illumination around meaningful elements.

Avoid glowing brains, humanoid robots, holographic faces, decorative code or binary, random circuits
and arrows, excessive neon or particles or lens flare, generic sci-fi environments, and fake
interfaces, equations or dashboards.

**Glow marks meaning, never decorates.** Illumination belongs on the element the thesis turns on. A
composition where everything glows has said nothing about what matters. Restate this constraint in
the generation prompt every time — it is the first thing a model loses.

Futuristic styling must never reduce comprehension.

---

## 6 · Brand colours and theme

| Role | Hex |
|---|---|
| Primary Ethara Purple | `#8B2CF5` |
| Deep Purple | `#5E1BC7` |
| Bright Purple | `#A855F7` |
| Glow Purple | `#C084FC` |

Supporting neutrals: black and near-black, charcoal and cool grey, white and off-white. Ground and
ink are structural, not accents.

Purple must **direct attention toward the important element**. Do not use every shade in every image.
Approved photographs and reference subjects may retain natural colours. Introduce no unrelated accent
by default.

> **Flagged conflict.** Some supplied material names a magenta accent (`#E9096F`). The enforced
> palette in this codebase is the purple family, asserted by `shared/brand-voice.ts`,
> `scripts/check-brand-voice.ts` and ADR-004. Magenta is **not adopted** here. To approve it, change
> `BRAND.visual` and the brand-voice check first, then this table.

`theme_mode` is chosen per topic, readability, reference direction and request:

- **Dark** — black/near-black/charcoal ground, legible light text, controlled purple accents. Suits
  depth, spatial relationships, a focused hero.
- **Light** — white/off-white ground, dark text, controlled purple accents. Suits diagrams, labels,
  comparisons, education.

Do not force every creative into dark mode; do not alternate randomly. Both modes must remain
recognizably Ethara.AI.

---

## 7 · Composition and breathing space

One dominant focal visual. Default hierarchy: focal visual → optional headline → essential labels →
logo. A requested typographic creative may prioritise text.

Composition targets — targets, not platform requirements, expressed in `negative_space`:

- Roughly a quarter to a third of the canvas as quiet space where the composition allows
- Essential content held inside the canvas edges by the placement's safe margin
- A small number of primary components in a simple diagram; add more only when accuracy needs it

**The headline sits opposite the subject, never over it.** Left block, right subject, or the inverse.
Text laid over the focal object is a legibility failure regardless of contrast.

Do not fill empty space with decoration. If information cannot fit comfortably, simplify or propose
a carousel.

**Every creative must be legible at thumbnail scale.** If the structure is unreadable at feed size,
the visual carries a smaller idea than the one it was given — simplify the structure; do not enlarge
the text.

---

## 8 · On-image text

The image supports the caption; it does not reproduce it.

Default to no headline when the visual communicates alone. Otherwise one short headline, optional
brief supporting text only when it adds essential context, and short technical labels where required.
Keep total on-image words low for a static creative, excluding logo, essential chart labels and
source attribution.

The headline must come from the caption's central idea, complement the visual, stay within the
evidence, and be **written independently for the image**. The caption hook may be reused only when it
genuinely serves the concept — never selected automatically. No caption paragraphs, hashtags or
unnecessary CTAs.

Labels are letterspaced caps: a word or three, naming the thing rather than the sentence about it.

Roboto for headlines, DM Sans for supporting text.

---

## 9 · Mandatory logo

Every completed image must carry the approved Ethara.AI logo — every carousel slide, every platform
variant. Use the actual approved asset.

Never ask the generator to invent or redraw it, never substitute typed "Ethara.AI", never distort,
stretch, rotate, recolour, crop or obscure it, never add unapproved effects.

Use the approved light or dark variant appropriate to the background — selecting an approved variant
is not recolouring. Follow approved placement and clear-space rules; where none exist, use a quiet
corner inside the safe area, keep the logo secondary but readable, and hold at least one logo-height
of clear space.

Place the logo asset **after** base-image generation, to preserve exact geometry.

If the approved asset is unavailable, return `NEEDS_ASSET: approved Ethara.AI logo`. Concept work may
continue; the image cannot pass validation.

---

## 10 · The two-layer law

**The model paints the subject. The brand layer is drawn locally.**

Every headline, label, annotation, leader line, wordmark and footer is composited from brand tokens
after generation. No diffusion model is asked to render text, ever — a model that *nearly* spells the
wordmark has produced an unusable asset, not a near miss.

The generation prompt must therefore carry an explicit, absolute text exclusion. This is not
optional phrasing; it is the single instruction that most often fails.

### What each archetype generates

| Archetype | Generated | Composited locally |
|---|---|---|
| `depth-section` | The mass above and below the divider, its material and internal structure | Divider, node markers, leader lines, all labels, headline block, wordmark |
| `cycle` | Ambient ground and edge treatment only | The entire ring, every icon node, arrows, centre label, insight strip |
| `state-flow` | *Nothing — no model is called* | Every node, every edge, every edge label |
| `stage-bar` | The three station subjects | Stage rules, captions, connecting arrows, headline |
| `annotated-object` | The object, its surface and the light on it | Leader lines, annotations, headline block, wordmark |
| `provocation` | The full image | The single line of condensed caps, and nothing else |

**The rule behind the table:** a diagram whose meaning lives in its labels is drawn locally in full.
A diagram whose meaning lives in a material or a form uses the model for that form and nothing else.

Ask of every brief: *does the argument survive if the model gets a detail wrong?* Where it would not,
the diagram is deterministic — see §13.

---

## 11 · Platform sizes

Use the requested platform **and** placement. These are working export presets, not permanent
platform specifications.

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

Use current platform configuration where it differs. If no platform is specified, use LinkedIn square
and **state the assumption in the brief**.

Recompose for each ratio; never stretch artwork. Account for interface overlays, profile-photo
overlap on banners, feed and preview crops, mobile readability, and safe areas.

If the generator cannot produce exact dimensions, use the closest supported ratio and finish on an
exact-size canvas. **Verify exported pixel dimensions.**

> **Implementation note.** `CANVASES` in `shared/image-models.ts` currently declares four canvases
> only, and invariant 22 checks `media_assets.canvas` against it. Placements in this table that are
> not declared there will fail at render. Adding them is a code change, not a skill change.

---

## 12 · Production prompt requirements

The `generation_prompt` must explicitly state: the core visual thesis; the selected archetype and
treatment; the actual focal subject; the meaningful relationships between elements; spatial
composition and viewpoint; dark or light mode; the palette and **what the purple highlights**; the
absolute text exclusion; the reserved text and logo regions; where the breathing space sits;
reference-image instructions where applicable; required elements and exclusions; and the target
platform, placement, dimensions and ratio.

Separate generation instructions from compositing instructions whenever text or the logo is added
afterwards — which is always.

Never rely on a vague prompt such as "create a futuristic AI image based on this caption."

---

## 13 · Factual and technical integrity

Every factual visual claim must trace to supplied evidence.

**Never invent** benchmark results, performance improvements, rankings, percentages, sample sizes,
chart values, measured curves, research findings, or customer and partnership claims.

For charts, preserve units, labels, comparison conditions and source context. **Use a deterministic
chart or diagram tool when exact values, relationships or labels are essential.** Image generation
may create supporting artwork but must not invent or distort evidence.

For technical diagrams: every node has a meaningful role; every arrow represents a supported
relationship; sequence and direction are correct; feedback must not imply automatic improvement; do
not imply weights update on every interaction unless the described system does that.

**An archetype is a composition, never a licence to populate it.** A spine of five labelled layers
asserts five layers exist. If the caption names three, the picture shows three.

---

## 14 · Validation and revision

Validate the prompt before generation, then **inspect the actual image**. A compliant prompt does not
prove a compliant image.

Required checks: same central thesis as the caption; a meaningful visual beyond copied caption text;
correct brand colours and mode; approved logo present and undistorted; clear focal point and
breathing space; minimal, legible, accurate text; correct reference treatment; preserved locked
elements; no invented factual claims; correct diagram relationships or chart data; correct dimensions
and crop safety.

If a check fails: identify the specific failure, revise the affected elements, reinspect, and
preserve the thesis and locked elements. Allow the configured number of automatic correction
attempts; if unresolved, return the remaining issue for review rather than marking the image ready.

**If the render contains any model-drawn text artefact, reject and regenerate. Do not composite over
it.**

Apply the brand-voice skill to the final candidate and its brief before human review. Preserve its
verdicts: `APPROVED`, `REVISE`, `NEEDS_INTERNAL_APPROVAL`, `CANNOT_VERIFY`. Never invent a validator
result and never publish automatically.

---

## 15 · Reference-image workflow

1. Inspect the reference before writing the prompt.
2. Identify what must be retained — composition, spacing, subject, lighting, materials, typography,
   colour treatment, mood.
3. Identify elements explicitly locked by the user.
4. Adapt the reference to the caption's thesis and Ethara.AI branding.
5. Pass the actual image to the generation stage through its supported reference-input mechanism.
6. State `reference_preserve` and `reference_change`.
7. Validate against both the reference instructions and the caption.

Never treat a reference as evidence for research claims. Never copy unrelated wording, data, logos or
third-party branding. Never let a reference's palette override the brand palette unless an approved
exception was explicitly requested. If the reference conflicts with the caption or a locked
constraint, **identify the conflict** rather than silently changing it. If the rendering stage cannot
accept reference images, report that limitation — do not claim a text description preserves the
reference exactly.

---

## 16 · Two modes

These are distinct and must never be mixed. A refinement instruction applied to a from-scratch
request tells the agent to preserve a reference that does not exist.

### Generation mode — no prior creative

Run the full workflow. `reference_asset` is null. The prompt describes what to create, and carries
the absolute text exclusion.

### Refinement mode — an existing creative is supplied

**Preserve everything not explicitly named for change.** Composition, visual concept, people, faces,
objects, background, typography, information, branding, logo, colours and proportions stay exactly as
they are unless the instruction names them.

On a refinement request, inspect first for alignment, spacing, proportions, typography hierarchy,
logo placement, visual balance, lighting, perspective, negative space and uniformity — then correct
**only the actual issues**. Do not introduce new design elements because they might look better.

- *Change one element* — change that element; everything else is untouched.
- *Resize* — adapt to the requested dimensions without redesigning. No random crops, no zooming into
  the subject, no hierarchy change. Where the ratio does not fit, use canvas extension or an
  intelligent crop that preserves the complete creative.
- *Align* — correct alignment, spacing, margins, positioning and balance only.
- *Improve lighting* — natural lighting and consistency only; subject, face, clothing, background,
  composition, colours, typography and branding stay fixed.
- *Shorten* — preserve the concept, identity and hierarchy; keep the key message.

If people are present: preserve the exact people, their faces and facial identity, clothing, body
proportions and pose. Never generate replacement people or alter facial features.

**The governing rule of this mode: preserve everything not explicitly asked to change.**

---

## 17 · Output contract

Return one structured brief. **Field names are fixed** — developer implementation depends on them.

```
core_visual_thesis        caption_basis            archetype
visual_approach           approach_reason          focal_subject
composition               metaphor_mapping?        technical_relationships?
evidence_basis            theme_mode               palette
exact_on_image_text       typography               negative_space
logo_asset                logo_position            reference_asset?
reference_preserve        reference_change         locked_elements
platform                  placement                width_px
height_px                 generation_prompt        compositing_instructions
must_avoid                alt_text                 validation_status
unresolved_issues
```

Record `validation_status` as `not_run` until the relevant check is performed. `generation_prompt` is
`null` for a fully deterministic archetype.

After rendering, additionally return the actual image reference, verified export dimensions, the
post-generation inspection result, and the Brand Voice verdict where performed.

`alt_text` describes the **actual final image**, its meaningful relationships and its essential
visible text.

---

## Boundaries

- **Never claims an image exists when only a brief was produced.**
- **Never generates the logo, the wordmark or any on-image text.**
- **Never renders a chart without the data behind it.** Bars and curves that exist for visual rhythm
  are fabricated evidence.
- **Never invents a data structure to fill an archetype.**
- **Never ships a `provocation` creative carrying a factual claim** — that archetype has no room to
  carry evidence.
- **Never substitutes an archetype or a canvas silently.** State the conflict.
- **Never lets a reference palette override the brand palette** without an approved exception.
- **Never publishes.** It returns a brief; the pipeline decides.

---

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The thesis fits no archetype | Say so and select a treatment from §3. Do not force the nearest fit. |
| The render arrives with model-drawn text | Reject and regenerate with the exclusion restated. Never composite over it. |
| The archetype needs more nodes than the evidence supports | Reduce the structure to the evidence. Never pad to fill the shape. |
| The placement is not in the canvas registry | Report the unknown placement and the key that must be declared. Do not guess a size. |
| Distinctness falls below the configured floor | Rotate the archetype, then the palette role, then re-render. |
| The caption and the evidence disagree | Flag the exact conflict before representing the claim. |
| No capable generative model is reachable | The local vector layer renders the archetype's structure alone, stamped with the reason. A structural creative without a painted subject is complete; an unbranded painted subject is not. |
| The headline overflows the safe margin | Wrap to the configured line budget; truncate at a word, never mid-word. |
| The generated background is unreadable behind text | Composite at the configured opacity floor. Legibility outranks the background. |

---

## Knobs this skill requires

Declared as `ConfigField`s in `shared/agent-registry.ts` with plain-language descriptions and read
through `ctx.config`. A literal in a handler is a knob the operator cannot see, and `agent:check`
fails on an undescribed knob.

| Knob | Governs |
|---|---|
| `archetypeRotationWindow` | Recent creatives checked before an archetype may repeat |
| `archetypeDistinctnessFloor` | Computed distinctness below which the archetype rotates |
| `onImageWordBudget` | Total words permitted on a static creative |
| `headlineWordBudget` | Words permitted in a headline |
| `headlineLineBudget` | Lines the headline may wrap to before truncating |
| `labelCharBudget` | Maximum characters in a letterspaced label |
| `diagramComponentBudget` | Primary components before a diagram must simplify |
| `quietSpaceRatio` | Target proportion of canvas left as negative space |
| `safeMarginRatio` | Proportion of canvas edge kept clear of essential content |
| `backgroundOpacityFloor` | Composite floor below which legibility outranks the background |
| `correctionAttempts` | Automatic correction attempts before returning for review |
| `defaultThemeMode` | Ground used when the topic does not indicate one |

---

## Developer handoff

The image-generation call must use `generation_prompt`, with reference images passed as actual
inputs. **If the application still passes the caption's first line to the renderer, changing this
skill will not change the output.**

A worked brief for each production pattern lives in `references/worked-briefs.md`.
