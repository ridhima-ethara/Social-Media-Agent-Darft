# Visual System

## Purpose

Make every Ethara.AI creative recognisable as one family before anyone reads a word of it.

`image-brief` decides **what** a visual argues. `visual-rendering` decides **how** it is produced in
two layers. This skill decides **which shape the argument takes** — the small set of composition
archetypes the brand repeats, and the drawing grammar shared across all of them.

Consistency here is not decoration. A feed reader sees the creative for a fraction of a second
before deciding whether to read; a house style that survives that fraction is the only thing that
makes a post identifiable as ours.

## Single source of truth

This skill **does not restate** what is already specified elsewhere. Where it needs one of these,
it reads it:

| What | Where it is defined | Never duplicate it here |
|---|---|---|
| The purple family and its roles | `image-brief` rule 6 · `BRAND.visual` in `shared/brand-voice.ts` | A hex code in this file is a defect |
| Typefaces | `image-brief` rule 8 · `BRAND.visual` | — |
| Placement sizes and ratios | `image-brief` rule 11 · `CANVASES` in `shared/image-models.ts` | — |
| Logo asset, placement, clear space | `image-brief` rule 9 | — |
| What must never be generated | `visual-rendering` rules 1–2 | — |
| Every threshold, budget and cap | `ConfigField`s in `shared/agent-registry.ts`, read through `ctx.config` | A literal number here is a defect |

If this skill and one of those disagree, the other one wins and this file is the bug.

## Inputs

- The `ImageBrief` and its `core_visual_thesis`
- `theme_mode`, the platform and the placement
- The resolved configuration for this run
- Previously published creatives, for archetype rotation

## Outputs

An `archetype` id on the brief, plus the per-archetype `generation_prompt` and
`compositing_instructions` that separate what the model paints from what is drawn locally.

## The six archetypes

Choose by what the thesis **is**, never by what it is about. A post about agents is not
automatically a Cycle; a post about scale is not automatically a Stage Bar.

| Archetype | The thesis it fits | The shape |
|---|---|---|
| `depth-section` | Visible result vs the machinery that produced it | A divider line. One luminous node above it, a descending spine of labelled nodes below. |
| `cycle` | A process that repeats and compounds | A closed ring of icon nodes, one centred label naming the loop, optional insight strip beneath. |
| `state-flow` | A mechanism with named transitions between named states | Outlined nodes, directed edges carrying their own labels. Solid = forward, dashed = feedback. |
| `stage-bar` | A transformation: raw input becomes a different kind of thing | Three stations left to right, each captioned with what it is and what it does. |
| `annotated-object` | One subject that reads differently depending on who looks | A single sculptural form, leader lines to annotations placed around it. |
| `provocation` | A question posed, deliberately unanswered | One high-contrast image, one line of condensed caps. Nothing else. |

**Rotation.** Distinctness from recent creatives is computed against the configured window, never
judged. Repeating an archetype is allowed when the thesis genuinely calls for it; repeating it
because it is easy is the failure this rule exists to catch.

**When none fits**, say so and return to `image-brief` for a treatment. Forcing a thesis into the
nearest archetype produces a picture that argues something the caption did not.

## The shared grammar

Everything below applies to every archetype, which is what makes six different shapes read as one
system.

### Rules

1. **One ground, one accent family.** A near-black or near-white ground per `theme_mode`, and the
   purple family as the only accent. Colour outside that family appears only where a reference
   subject retains its natural colour.

2. **Glow marks meaning, never decorates.** Illumination belongs on the element the thesis turns
   on — the node being explained, the beam that reveals the annotation. A composition where
   everything glows has said nothing about what matters. This is the rule most easily lost when a
   generative model is left to its own instincts, so it is restated in the generation prompt every
   time.

3. **Lines are technical, not organic.** Thin, deliberate, geometric. A leader line runs to its
   label and stops. Dotted for a reference, solid for a relationship, dashed for a return path —
   and the same meaning holds across every creative.

4. **Labels are letterspaced caps, set locally.** Short: a word or three. They name the thing, not
   the sentence about the thing. Never generated — see rule 6.

5. **Depth is controlled, not atmospheric.** Structured geometry, refined materials, a defined
   light source. Not fog, not particle fields, not lens flare.

6. **The model paints the subject; the brand layer is drawn locally.** Every headline, label,
   annotation, leader line, wordmark and footer is composited from brand tokens after generation.
   No diffusion model is asked to render text, ever — a model that nearly spells the wordmark has
   produced an unusable asset, not a near miss.

7. **Negative space is part of the composition.** The quiet region is where the eye enters. Filling
   it with ornament is the most common way a creative stops looking like ours.

8. **The headline sits opposite the subject, not on it.** Left block, right subject — or the
   inverse. Text laid over the focal object is a legibility failure regardless of contrast.

9. **Every archetype is legible at thumbnail scale.** If the structure is unreadable at feed size,
   the visual carries a smaller idea than the one it was given. Simplify the structure; do not
   enlarge the text.

### Boundaries

- **Never invents a data structure.** A spine of five labelled layers asserts that five layers
  exist. If the caption names three, the picture shows three. An archetype is a composition, never
  a licence to populate it.
- **Never renders a chart without the data behind it.** Bars, curves and axes that exist for visual
  rhythm are fabricated evidence.
- **Never generates the logo, the wordmark or any on-image text.**
- **Never lets a reference image's palette override the brand palette** unless an approved exception
  was explicitly requested.
- **Never ships a `provocation` creative carrying a factual claim.** That archetype poses a
  question; a claim inside it has no room to carry its evidence.
- **Never substitutes an archetype for a requested one silently.** State the conflict.

### Failure modes

| Situation | Correct behaviour |
|---|---|
| The thesis fits no archetype | Say so and return to `image-brief`. Do not force the nearest fit. |
| The generated subject arrives with model-drawn text in it | Reject and regenerate with the negative constraint restated. Do not composite over it. |
| The archetype's structure needs more nodes than the evidence supports | Reduce the structure to the evidence. Never pad to fill the shape. |
| The placement is one the canvas registry does not know | Report the unknown placement and the key that would have to be declared. Do not guess a size. |
| Distinctness falls below the configured floor | Rotate the archetype, then the palette role, then re-render. |
| No capable generative model is reachable | The local vector layer renders the archetype's structure alone, stamped with the reason. A structural creative without a painted subject is a complete result; an unbranded painted subject is not. |

## Per-archetype production notes

What the model paints, and what is always drawn locally.

| Archetype | Generated | Composited locally |
|---|---|---|
| `depth-section` | The mass above and below the divider, its material and internal structure | Divider, node markers, leader lines, all labels, headline block, wordmark |
| `cycle` | Ambient ground and edge treatment only | The entire ring, every icon node, arrows, centre label, insight strip |
| `state-flow` | Ground and depth only | Every node outline, every edge, every edge label — the diagram is fully local |
| `stage-bar` | The three station subjects | Stage rules, captions, connecting arrows, headline |
| `annotated-object` | The object, its surface and the light on it | Leader lines, annotations, headline block, wordmark |
| `provocation` | The full image | The single line of condensed caps, and nothing else |

A diagram whose meaning lives in its labels — `cycle`, `state-flow` — is drawn locally in full. A
diagram whose meaning lives in a material or a form — `depth-section`, `annotated-object` — uses the
model for that form and nothing else. This split is what keeps a creative reproducible: the same
brief renders the same structure twice, whatever the model does.

## Knobs this skill requires

These are settings an operator will want, so they are declared as `ConfigField`s in
`shared/agent-registry.ts` with a plain-language description and read through `ctx.config`. A
literal in a handler is a knob the operator cannot see.

| Knob | Governs |
|---|---|
| `archetypeRotationWindow` | How many recent creatives are checked before an archetype repeats |
| `archetypeDistinctnessFloor` | The computed distinctness below which the archetype rotates |
| `onImageWordBudget` | Total words permitted on a static creative, excluding logo and essential labels |
| `headlineLineBudget` | Lines the headline may wrap to before it truncates at a word |
| `labelCharBudget` | Maximum characters in a single letterspaced label |
| `backgroundOpacityFloor` | The composite floor below which legibility outranks the painted subject |
| `safeMarginRatio` | Proportion of the canvas edge kept clear of essential content |
| `quietSpaceRatio` | Target proportion of canvas left as negative space |
| `defaultThemeMode` | The ground used when the topic does not indicate one |

## Boundaries of this skill

- It does not choose the message. `image-brief` does.
- It does not render. `visual-rendering` does.
- It does not define the palette, the typefaces, the logo rules or the placement sizes.
- It defines the shape of the argument and the drawing grammar, and nothing else.
