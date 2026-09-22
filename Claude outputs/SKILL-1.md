# Ethara Poster Set

## Purpose

Reproduce the six creatives in `public/brand/references/` as **repeatable templates**, not as moods
to be admired.

`visual-system` names six archetypes in the abstract. This skill is the concrete counterpart: for
each of the six reference images, the anatomy of the canvas, the spec of the hero, what the model
paints versus what is drawn locally, the prompt template, and the signature of the version that
comes out wrong. A new creative on one of these templates should be placeable beside its reference
and read as the next issue of the same series.

Use it when a brief has already chosen its archetype and the question left is *how this particular
poster is built*.

## Inputs

- The approved caption, its `core_visual_thesis`, and the `archetype` from `visual-system`
- The Knowledge Base entries retrieved for the idea, each with its citation
- The manifest entry for the governing reference — `file`, `style`, `label`, `concepts`
- `theme_mode`, platform, placement, and the resolved configuration for this run
- Elements the operator has locked during iteration

## Outputs

- `template_id` — one of `iceberg`, `monolith`, `ring`, `schematic`, `stations`, `provocation`
- `zone_plan` — which canvas zone holds the headline block, the hero, the label column, the logo
- `hero_spec` — the subject, its material, its lighting, and the single element the accent marks
- `label_set` — every letterspaced label with the citation that licenses it
- `generation_prompt` — assembled from the template's own prompt skeleton
- `compositing_instructions` — the local layer, itemised
- `template_deviations` — anything the brief required that the template does not hold, named

## The constants

Every one of the six shares these. They are what makes a set out of six different shapes, and they
are the first thing to check when a render looks like someone else's work.

1. **The ground is a true near-black**, edge to edge, no vignette and no mid-tone. The one variant
   that departs from it — the schematic's deep navy — is the admitted exception below, not a licence.
2. **One accent family**, per `BRAND.visual`, doing exactly one job: marking the element the thesis
   turns on. Never a second hue for interest.
3. **The wordmark sits upper-left**, in the quiet corner, composited from the approved asset.
4. **Headline block and hero are opposite**, never stacked on each other. Left type, right subject,
   or type below a centred subject.
5. **Type is light-weight and large**, set in sentence case with a single accent phrase — except the
   provocation, which is the set's only bold condensed all-caps.
6. **Labels are letterspaced small caps**, a word to three, reached by a thin leader, and always
   drawn locally.
7. **A quiet region is composed in, not left over.** Roughly a third of the canvas carries nothing.
8. **Everything is square by default** — the set was built for the feed square, and each template
   states how it recomposes for portrait.

---

## Template — `iceberg`

**The thesis it fits.** A visible result and the machinery that produced it. The argument is that
what you see is the small part.

**Canvas anatomy.** A waterline runs across the canvas somewhat above the midpoint. Above it, a small
illuminated peak with a single callout to the right. Below it, a mass widening then tapering to a
point near the lower edge, carrying a vertical spine of ring-nodes down its centre. The headline
block occupies the left third, vertically centred on the waterline. A supporting line sits below the
headline with clear space between them.

**Hero spec.** Low-poly wireframe geometry — visible triangulated facets, thin pale edges, a scatter
of vertex points through the submerged mass. The peak is lit; the mass is dark and structural. One
faint reflection sits beneath the point.

**The accent's job.** The peak's glow, and the ring-nodes down the spine. Nothing else.

**Local layer.** Waterline, every ring-node marker, every dotted leader, the right-hand label column
with its outline icons, the headline block, the wordmark.

**Label column.** One label per node, read top to bottom as a descent in abstraction. Each is a stage
of the same kind — a list that mixes a stage with a product name has broken the template.

**Prompt skeleton.**

```
A single low-poly wireframe iceberg on a pure black ground, split by a thin
horizontal waterline placed above the centre. The small peak above the line is
lit and luminous; the large submerged mass below is dark, triangulated, studded
with faint vertex points, widening then tapering to a point near the lower edge.
Thin pale edges, no fog, no particles, no text anywhere in the image. The right
half of the canvas is reserved and empty. Controlled violet illumination on the
peak only. Centred subject, generous black space to the left.
```

**Wrong when.** The submerged mass glows all over; the waterline sits at the midpoint and halves the
canvas; the node count was chosen for rhythm rather than taken from the evidence; the peak is as
large as the mass, which argues the opposite of the thesis.

**Portrait.** The waterline rises; the headline moves above it; the label column narrows to labels
under their nodes.

---

## Template — `monolith`

**The thesis it fits.** One subject that reads differently depending on who is looking at it.
Annotations speak for different observers, not different features.

**Canvas anatomy.** A tall rectangular form stands right of centre on a dark reflective floor, lit by
directional beams entering from the upper right and lower left. Annotations sit outside the form on
both sides, each reached by a thin leader that terminates in a small dot on the surface it names.
The headline block holds the left third in large airy light type, with a short rule beneath it and a
supporting line below that.

**Hero spec.** Matte black, faceted or crackled surface. Each lit region reveals a different internal
texture — a fine neural web, a dense grid, a voxel cluster — and each texture must correspond to the
observer its annotation names. The beams are volumetric but disciplined: visible shafts, no haze
filling the frame.

**The accent's job.** One lit face, typically the one the caption emphasises. Other revealed regions
take a subordinate neutral or a warm neutral — this is the one template where a second hue is
admitted, because the point is that the views differ.

**Local layer.** Every leader, dot and annotation, the headline block, the rule, the wordmark.

**Prompt skeleton.**

```
A single tall matte-black monolith standing on a dark reflective floor, pure
black background. Directional light beams from the upper right and lower left
strike two faces, each revealing a different internal texture beneath the
surface: a fine glowing web on one, a dense geometric grid on another, a recessed
voxel cluster low on the front. Cinematic, controlled, no haze. No text, no
symbols, no logos. The left half of the canvas is empty black.
```

**Wrong when.** Every face is lit, which argues that everyone sees the same thing; the beams become
atmosphere; the annotations name features of the object rather than the observers.

**Portrait.** The floor drops away, the form lengthens, the headline moves to the top third.

---

## Template — `ring`

**The thesis it fits.** A process that repeats and compounds. The ring itself is the claim.

**Canvas anatomy.** Headline at the top, centred, with an accent word inside it and a short rule
beneath. A supporting line below. A centred ring of circled outline icons, each captioned outside
the ring in letterspaced caps, joined by white arrows that all travel the same way. A symbol and a
stacked centre label name the loop. A bordered insight strip runs across the lower quarter, divided
into equal cells by hairline rules, each cell an outline icon over a short sentence.

**Hero spec.** There is no painted hero. The generated layer contributes ground and, at most, faint
contour linework in two corners. Everything that carries meaning is vector.

**The accent's job.** The icon strokes and the headline's accent word. The arrows stay white.

**Local layer.** All of it — ring, nodes, icons, arrows, captions, centre label, insight strip,
headline, wordmark.

**Prompt skeleton.**

```
Pure black background with very faint violet contour linework confined to the
right edge and lower-left corner, like thin topographic curves. Nothing else in
the frame. No objects, no text, no icons. Large empty centre.
```

**Wrong when.** Arrows alternate direction, which denies the loop; the stage count was padded to
balance the circle; the insight strip carries claims no entry supports; the corner linework creeps
toward the centre and competes with the ring.

**Portrait.** The ring shrinks; the insight strip stacks into two rows.

---

## Template — `schematic`

**The thesis it fits.** A named mechanism with named states and labelled transitions between them.
The most technical of the six and the only one that survives a dense diagram.

**Canvas anatomy.** Title and a letterspaced subtitle at the top, centred. Below, four rounded-
rectangle nodes placed around a wide loop — a node left, one upper centre, one right, one lower
centre — joined by orthogonal connectors that turn at right angles and carry their own labels above
the turn. Solid connectors are the forward path; dashed are returns.

**Hero spec.** No painted hero. Each node holds a circular icon, a bold name, an italic symbol where
the mechanism has notation, and a one-line description in muted type. Node outlines glow faintly
from behind.

**The accent's job.** Nominally the lead node. This template is the set's admitted exception: each
node may take its own hue so the connector labels can be colour-matched to their paths, and the
ground may go deep navy rather than true black. It is admitted **only** for teaching diagrams of an
established mechanism, and the deviation is recorded in `template_deviations` every time.

**Local layer.** Everything. A diagram whose meaning lives in its labels is never generated.

**Prompt skeleton.**

```
A deep navy-to-black gradient background, subtly darker at the corners. Nothing
in the frame — no objects, no text, no shapes. A flat, even field for a diagram
to be drawn over.
```

**Wrong when.** A connector asserts a relationship no entry supports; the return path is drawn solid
and reads as forward flow; hues multiply until nothing leads; the description lines grow into
sentences and the nodes stop being scannable.

**Portrait.** The loop becomes a column: states down the left, returns up the right.

---

## Template — `stations`

**The thesis it fits.** A transformation — raw material becomes a different kind of thing through a
process that has a name.

**Canvas anatomy.** The upper half is a dominant hero photograph-grade render, bled to the right and
top edges, with the headline block set against black on the left in heavy condensed caps, an accent
word on its own line, a rule, and a supporting line. The lower half holds three stations across,
each with a letterspaced caps kicker above it, a hairline rule under the kicker, the object, a bold
name, and a short description. Thin white arrows sit between the stations.

**Hero spec.** One built object rendered with real material — a dark metal hall, a machine, a
structure — lit along one edge in the accent. The three station objects are smaller, simpler, and
rendered in the same light so they read as one family: typically a field of points, a containing
volume, and a resolved network.

**The accent's job.** The hero's edge line, the middle station, and the headline's accent word. The
outer stations stay neutral so the middle reads as where the work happens.

**Local layer.** Kickers, rules, arrows, station names and descriptions, the headline block, the
wordmark.

**Prompt skeleton.**

```
Top half: a dark metal data-centre hall in three-quarter isometric view, bled to
the right and top edges, lit by a thin violet line running along its base, deep
black above. Bottom half, separated by empty black: three small objects on
circular plinths, left to right — a tall lattice of white points falling into a
disc, a transparent glass cube containing glowing blue and violet cubes, a white
node-and-edge network sphere. Even, controlled studio lighting, no text anywhere.
```

**Wrong when.** The three stations are rendered in different light and stop reading as a sequence;
the hero dominates until the transformation is a caption rather than a picture; the arrows imply a
loop.

**Portrait.** The hero takes the top third; the stations stack vertically with the arrows turning
downward.

---

## Template — `provocation`

**The thesis it fits.** A question posed and deliberately unanswered. Carries no claim, so it needs
no evidence beyond the question being honest.

**Canvas anatomy.** One hero fills nearly the whole canvas with an even black margin. Beneath it, two
lines of bold condensed all-caps, centred, tight leading. Nothing else — no logo, no accent, no
supporting line.

**Hero spec.** Monochrome and high contrast. Grey structure on black, one white element that marks
where the subject has got to: a traced partial path, a single marker dot. The white element is the
whole argument, so it is never ornamental.

**The accent's job.** None. This is the only creative in the set with no purple at all, which is
exactly why it stops a feed of creatives that have it.

**Local layer.** The two lines of type. Nothing else.

**Prompt skeleton.**

```
A large rectangular maze drawn in flat mid-grey walls on a pure black ground,
filling the frame with an even black margin. One white line traces a partial
route from the lower-left opening, turning several times and ending part-way in,
tipped with a solid white dot. Flat, graphic, no perspective, no shading, no
text.
```

**Wrong when.** The path reaches the exit, which answers the question; colour appears; a logo is
added out of habit and breaks the starkness; the question is rhetorical rather than open.

**Portrait.** The hero squares up and the type takes the freed lower band.

---

## Rules

1. **A template is chosen by what the thesis is**, never by which poster looked best last time. The
   archetype from `visual-system` selects it; this skill only builds it.
2. **The zone plan is set before the prompt is written.** Reserved regions go into the prompt as
   empty space, so the model leaves room instead of the compositor covering its work.
3. **No text, numerals, symbols or marks are ever requested from the model.** Every prompt skeleton
   here ends by excluding them, and that exclusion is not edited out for any render.
4. **Structure counts come from evidence.** Nodes on the iceberg spine, stages in the ring, stations
   in the row: each is licensed by a cited entry or it does not exist. The template is a
   composition, never a licence to populate it.
5. **Labels in one structure are siblings** — same level of abstraction, same grammatical form.
6. **One element is illuminated.** Where a template names the accent's job, that is the whole of the
   accent's job.
7. **Deviations are recorded, not absorbed.** The schematic's navy ground and multi-hue nodes, and
   the provocation's missing wordmark, are written into `template_deviations` on every use, so the
   set's exceptions stay countable.
8. **Recompose for portrait; never stretch.** Each template states its portrait behaviour, and that
   behaviour is followed rather than improvised.
9. **The reference's words never travel.** Headlines and labels are written for this creative from
   this caption. Copying a reference's phrasing is how a set becomes a repeat.
10. **Inspect the render, not the prompt.** Check ground, accent discipline, the empty zone, the
    structure count, and the absence of model-drawn glyphs in the actual pixels.

## Boundaries

- **Never fabricates a structure** to fill a template's shape.
- **Never renders a chart, axis or figure** without the data and its units behind it.
- **Never asks a generative model for the wordmark, a headline, a label or a face.**
- **Never puts the accent on a provocation**, and never removes the wordmark from the other five.
- **Never lets a reference image's palette or copy override the brand.**
- **Never changes a locked element**, and never substitutes a template silently during iteration.
- **Never claims a text-only painter preserved a reference image** it was never shown.
- **Never edits the built skills tree.** This file belongs beside the other skill sources; the build
  step copies it.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The thesis fits none of the six | Say so and return to `image-brief`. A forced template argues something the caption did not. |
| The evidence supports fewer nodes than the template shows | Reduce the structure. Never pad to balance a shape. |
| The caption needs a figure no entry carries | Take a conceptual template and report the chart as declined for want of data. |
| A render arrives with model-drawn glyphs | Reject and regenerate with the exclusion restated. Never composite over them. |
| The reserved zone comes back filled | Re-prompt with the empty region stated first, before the subject. |
| A `schematic` is wanted for something that is not an established mechanism | Use `ring` or `stations`; the navy exception is not a style option. |
| The wordmark cannot hold its clear space | Report it. Never shrink, crop or move the mark into the composition. |
| No generative painter is reachable | Draw the template's local layer alone and stamp the reason — for `ring` and `schematic` that is the entire creative, and a complete result. |
