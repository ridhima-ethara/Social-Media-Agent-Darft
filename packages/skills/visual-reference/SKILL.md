# Visual Reference

## Purpose

Make a new creative belong to the body of work that already exists, and make every word on it
traceable to something the Knowledge Base can cite.

This is the hop between the other three visual skills, and it is the one that currently has no
specification:

| Skill | Decides |
|---|---|
| `image-brief` | **What** the visual argues |
| `visual-system` | **Which shape** the argument takes |
| **`visual-reference`** | **Which house reference governs it, and what licenses each label** |
| `visual-rendering` | **How** it is produced, in two layers |

It is the specification behind the registry skill `generation.image.reference`, and it governs the
reference manifest at `public/brand/references/references.json`.

Two failures it exists to prevent. A creative that is on-brand in palette but reads as a different
studio's work, because nothing carried the house grammar into the prompt. And a creative carrying
confident annotations — a five-layer spine, three named failure modes — that no entry in the
Knowledge Base supports, which is fabricated evidence wearing a layout.

## Single source of truth

This skill **does not restate** what is specified elsewhere. Where it needs one of these, it reads it:

| What | Where it is defined | Never duplicate it here |
|---|---|---|
| The purple family and its roles | `image-brief` rule 6 · `BRAND.visual` | A hex code in this file is a defect |
| Typefaces, on-image text policy | `image-brief` rule 8 | — |
| Logo asset, placement, clear space | `image-brief` rule 9 | — |
| The reference-image workflow in outline | `image-brief` rule 10 | This file is its detail, not its replacement |
| Placement sizes and ratios | `image-brief` rule 11 · `CANVASES` | — |
| The archetypes and the drawing grammar | `visual-system` | — |
| The two-layer split, what is never generated | `visual-rendering` rules 1–2 | — |
| Which painters accept an image at all | `shared/reference-images.ts` · `shared/image-models.ts` | — |
| Every threshold, budget and ceiling | `ConfigField`s in `shared/agent-registry.ts`, read through `ctx.config` | A literal number here is a defect |

If this skill and one of those disagree, the other one wins and this file is the bug.

## Inputs

- The approved caption and the brief's `core_visual_thesis`
- The `archetype` chosen by `visual-system`
- The active entries of the reference manifest — `file`, `style`, `label`, `concepts`
- The Knowledge Base entries retrieved for this idea, each with its citation
- The caption's own evidence basis, for claims the Knowledge Base does not hold
- Recently published creatives, for rotation and computed distinctness
- Elements the operator has locked during iteration
- The resolved configuration for this run
- The target platform, placement and `theme_mode`

## Outputs

Fields written onto the brief. The names are the contract — a renderer reads them:

- `reference_asset` — the governing manifest `file`, or `none` with the reason
- `reference_mode` — `style-clause`, `style-clause-and-image`, or `image-only`
- `reference_style_clause` — the words appended to the generation prompt
- `reference_preserve` — what the new creative keeps from it
- `reference_change` — what it deliberately does not keep
- `label_citations` — one entry per on-image label, each naming the Knowledge Base entry or the
  caption evidence that licenses it
- `unsupported_labels` — labels dropped for want of a source, with the label text kept so the
  operator can see what was removed
- `distinctness` — the computed figure against the rotation window, never a judgement
- `generation_prompt` — the assembled prompt, in the order this skill specifies
- `compositing_instructions` — what is drawn locally over it
- `reference_unhonoured` — what the finished image did not carry, after inspection

## Rules

### 1 — The clause is the floor; the pixels are the exception

Three of the four background painters take text only and never see the reference image. The `style`
sentence in the manifest is therefore what actually reaches most renders, and it is written to carry
the look on its own. A literal image may additionally go to the image-capable painter.

Never describe a text-only render as having preserved a reference image. Say which mechanism ran:
`style-clause` when the words alone travelled, `style-clause-and-image` when both did.

### 2 — Select by thesis and archetype, never by preference

The manifest's `concepts` tags are the primary selector; the archetype is the check. A reference
whose composition is a lit monolith does not govern a `cycle` creative because its lighting is
admired. When tags and archetype disagree, the archetype wins and the disagreement is reported as a
manifest defect to be fixed in `references.json`, not worked around in the prompt.

An untagged reference applies to every concept by design — a single house style needs no tagging. An
entry with an empty `style` is recorded as `image-only`: it contributes nothing to the text painters,
and that is stated in the brief rather than quietly assumed.

### 3 — Three things always transfer

Whatever governs a given creative, these carry across every one of them, because they are what makes
the family legible at feed scale:

- The ground: near-black or near-white per `theme_mode`, never a mid-tone
- One accent family, led by a single purple, illuminating only the element the thesis turns on
- A quiet region large enough to enter the composition through

### 4 — Four things never transfer

- **Its words.** No headline, label, annotation or wordmark is carried from a reference. Every one
  is written for this creative and composited locally.
- **Its data.** A reference is not evidence. A spine of nodes in the source image licenses nothing
  about the number of stages in this one.
- **Its subject**, when the thesis differs. An iceberg belongs to a visible-result-versus-machinery
  argument. Reused for a different argument it is decoration, and decoration that recognisable reads
  as self-plagiarism.
- **Its palette**, where it departs from the brand. An approved exception is requested explicitly and
  named in `reference_change`, never inherited by being present in the pixels.

### 5 — Every label is licensed

An on-image label — a callout, a node name, an annotation, an axis term — is written only when a
Knowledge Base entry or the caption's stated evidence supports it. Each one is recorded in
`label_citations` against the entry that licenses it.

A label with no source is **dropped and reported** in `unsupported_labels`. It is never softened into
a vaguer word that survives the check, and never replaced by a plausible neighbour. A structure that
loses labels this way loses nodes with them: an empty ring position is a lie about the mechanism.

### 6 — Labels are siblings

Every label in one structure names things at the same level of abstraction and in the same
grammatical form. A spine reading *intermediate reasoning · verification · process rewards · policy
optimization · model alignment* holds because each is a stage of the same kind. One noun phrase
dropped into a list of gerunds, or one product name among five mechanisms, breaks the structure more
visibly than a missing node would.

### 7 — Grounding runs before prompting, not after

Retrieve, cite, then write. A prompt assembled first and evidenced afterwards is how an invented
figure reaches a render — the layout has already reserved a slot for a number by the time anyone
looks for one. If the retrieval returns nothing that licenses the structure, return to
`image-brief` for a treatment the evidence supports.

### 8 — Prompt assembly is ordered

The generation prompt is assembled in this order, every time, so two runs of the same brief differ
only where the brief differs:

```
core_visual_thesis
→ archetype structure (from visual-system)
→ focal subject and its material
→ spatial composition, viewpoint, where the quiet region sits
→ theme_mode and the accent's single job
→ reference_style_clause (verbatim from the manifest)
→ reserved regions: headline block, label column, logo
→ explicit exclusions, including: no text, no wordmark, no numerals, no faces
```

The clause goes in verbatim. Paraphrasing it is how a house style drifts one render at a time.

### 9 — Rotation is computed, not judged

Distinctness against the rotation window is a figure, and the window and the floor are knobs. Below
the floor: rotate the governing reference first, then the archetype, then the palette role, then
re-render. Repeating a reference is legitimate when the thesis calls for it; repeating it because it
was last render's is the drift this rule catches.

### 10 — Conflicts are named, never resolved silently

Reference against thesis, reference against a locked element, manifest tag against archetype,
Knowledge Base entry against caption claim — each is reported with both sides named. A human
instruction outranks a manifest entry; the finding is still raised alongside the edit rather than
resolved away.

### 11 — Inspect the image, not the prompt

A compliant prompt does not prove a compliant render. After generation, check the actual pixels
against the clause and against `label_citations`: ground, accent discipline, the quiet region, the
structure's node count, the absence of model-drawn text. What the model would not honour goes in
`reference_unhonoured` — a render carrying a hallucinated glyph is rejected and regenerated, never
composited over.

### 12 — Manifest entries are written to this standard

A `style` sentence names ground, hero subject and its material, lighting, accent discipline,
composition and spacing, and the mood — in that order, in plain description. It never contains brand
copy, a headline, a hex code, a logo instruction or a platform size. It is one sentence long because
it is appended to a prompt, and it is the reason a text-only painter can still produce house work.

### 13 — A fallback is only honest if the painter was actually called

The local vector layer is a legitimate result and rule 12 of `visual-rendering` says so. It stops
being honest the moment it is reported as a painter failure that never happened.

Two conditions are frequently confused, and they carry different reasons:

| Condition | What it means | What must be said |
|---|---|---|
| No credential | The deployment has no access to this service | Name the missing variable |
| Credential, no model | The service answers, but this project does not serve the model named | Name the model AND the project or region that refused it |

The second is the one that hides. A painter that answers `isConfigured()` from a credential alone
reports itself ready for every model that credential could theoretically reach, wins the default
preference, and then fails per-call. The run still produces a creative, so nothing looks broken — and
every creative is the vector floor while the art direction in this manifest never reaches a painter
at all.

Therefore: the model actually requested is named in the fallback reason, always. A fallback reason
that is empty, or that renders as `undefined`, is a defect in this pipeline and not a description of
anything — it must fail loudly rather than be written to an asset. `auto` resolves to the painter
that consumes the model the deployment has configured, because naming a model is the deployment
stating which one it actually has.

### 14 — The structure is the argument; texture is not

These references are read at feed scale and each one is legible because its geometry carries the
claim: a mass below a waterline, a closed loop, a four-box schematic, a maze with one traced path.
None of them are a texture with a headline placed over it.

So the composition the painter is asked for is structural and specific to the subject — an object or
an arrangement that a reader could describe back. "A violet gradient field" is not a composition; it
is a wash, and a wash is what a creative looks like when nothing decided what it was about.

This does not license model-drawn lettering, which rule 4 forbids without exception. Structure is
geometry — the spine, the nodes, the arrangement, the direction of travel. The words that name the
parts are drawn locally, as vectors, over the top.

## The governing references

The house set, and what each is for. `concepts` tags live in `references.json`; this table is the
reading of them, and a disagreement means the manifest needs the edit.

| Reference | Archetype it governs | What transfers | What must change per creative |
|---|---|---|---|
| Reasoning iceberg | `depth-section` | Wireframe mass split by a thin divider, a violet ring-node spine, dotted leaders to a right-hand label column | Node count, every label, the headline's accent phrase |
| Lit monolith | `annotated-object` | One sculptural form, directional beams, a different surface texture per face, leader lines to small-caps callouts | The form, the textures, who the annotations speak for |
| Loop engineering ring | `cycle` | Centred ring of thin-outline icon nodes, white arrows, a centre label naming the loop, a bordered insight strip beneath | Stage names, icon set, whether the strip exists at all |
| RL schematic | `state-flow` | Outlined rounded nodes, labelled edges, solid forward and dashed return, subordinate hue per node | Node names, edge labels, the direction of the return path |
| AI factories | `stage-bar` | Dominant hero above, three captioned stations left to right, thin connector arrows | The three stations, their captions, the hero |
| Long-horizon maze | `provocation` | Pure black, one monochrome hero, one line of condensed caps, no accent at all | The hero image, the question |

The maze is the deliberate exception to the accent rule: a `provocation` carries no purple, which is
what makes it land in a feed of creatives that do.

## Knowledge grounding contract

| On-image element | Licensed by | When nothing licenses it |
|---|---|---|
| Callout or annotation label | A Knowledge Base entry with a citation | Drop the label and its node; report in `unsupported_labels` |
| A named stage in a cycle or flow | An entry, or a mechanism the caption states | Reduce the structure to what is supported |
| A figure, percentage or benchmark value | An entry carrying that figure with its units and comparison condition | Never render it — take a conceptual treatment and say the chart was declined for want of data |
| A headline accent phrase | The caption's central idea | Rewrite from the caption; never lift the reference's own phrase |
| A relationship an arrow asserts | An entry or caption statement of that relationship | Remove the arrow; an unsupported edge is a claim |

## Boundaries

- **Never treats a reference as evidence** for anything factual.
- **Never carries brand copy, wording, data or third-party marks** out of a reference image.
- **Never lets a reference palette override the brand palette** without an explicitly requested,
  recorded exception.
- **Never claims a text-only render preserved an image** it was never shown.
- **Never writes an on-image label without a recorded citation**, and never substitutes a vaguer
  word to get one past the check.
- **Never pads a structure** to fill an archetype the evidence does not support.
- **Never sends the headline, labels, wordmark or logo to a generative model** — they are composited
  locally, every render, per `visual-rendering`.
- **Never silently swaps the governing reference** during iteration, or changes an element the
  operator locked.
- **Never edits `packages/runtime/.claude/skills/`** — that tree is a build artifact. This file is
  the source; `npm run build-skills` copies it.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The manifest holds no reference tagged for this concept | Fall back to the untagged house entries; name the fallback in `reference_asset` |
| The manifest is missing or malformed | Render without a clause and stamp the reason. A missing manifest is not an error — it is the pre-reference behaviour |
| The chosen entry has an empty `style` | Record `image-only`; the text painters receive nothing and the brief says so |
| The renderer cannot accept an image | Report the limitation; proceed on the clause alone and label the mode honestly |
| The reference conflicts with the thesis | Name both sides and choose the thesis; a reference never outranks the argument |
| A locked element conflicts with the reference | Hold the lock, report the conflict, change nothing else |
| Retrieval returns nothing that licenses the structure | Return to `image-brief` for a treatment the evidence supports |
| An entry and the caption disagree on a figure | Flag the exact conflict before either reaches the canvas |
| Distinctness falls below the configured floor | Rotate reference, then archetype, then palette role — in that order |
| The finished image carries model-drawn text | Reject and regenerate with the exclusion restated; never composite over it |
| No generative painter is reachable | The local vector layer draws the archetype alone, stamped with the reason — a complete result, not a placeholder |
| A painter is configured but the project does not serve the model | Name the model and the project or region that refused it. Never report this as the service being unconfigured |
| The fallback reason is empty or `undefined` | A defect in the render path, not a result. Surface it as an error rather than stamping it onto an asset |
| The background is a wash rather than a composition | Reject it. Rule 14 requires structure a reader could describe back |

## Knobs this skill requires

Declared as `ConfigField`s in `shared/agent-registry.ts` with plain-language descriptions and read
through `ctx.config`. A literal in a handler is a knob the operator cannot see.

| Knob | Governs |
|---|---|
| `useReferenceImages` | Whether the manifest steers generation at all |
| `referenceRotationWindow` | Recent creatives checked before a governing reference may repeat |
| `referenceDistinctnessFloor` | The computed distinctness below which rotation is forced |
| `labelCitationRequired` | Whether an uncited label is dropped or merely flagged |
| `knowledgeEntriesPerCreative` | Entries retrieved to ground one creative's labels |
| `clauseVerbatim` | Whether the manifest clause may be summarised when the prompt runs long |
| `lookbackAssets` | Recent assets considered as prior art |
| `maxSimilarity` | The visual half of rule 17, the ceiling a new creative may not reach |

## Boundaries of this skill

- It does not choose the message. `image-brief` does.
- It does not choose the shape. `visual-system` does.
- It does not render, composite or publish. `visual-rendering` and the publishing agent do.
- It chooses what governs the look, and it proves every word on the canvas. Nothing else.
