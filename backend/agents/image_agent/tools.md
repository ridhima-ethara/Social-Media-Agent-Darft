## `recall_visual_knowledge(topic, limit)`

The Knowledge Base read path, filtered to entries that can legitimately change
how a picture looks: Visual Preference, Brand Guideline, High Performer,
Platform Preference, Human Directive.

**Call first, every run.** A research finding is deliberately *not* in that list
— it grounds the caption's claim, not the canvas, and treating it as a visual
instruction would put a statistic on a picture the caption never made.

## `derive_options(caption, platform)`

Authors **both** briefs — options A and B — in the shape the skill's Output
section specifies.

They share a subject, because rule 1 says the visual and the caption tell the
same story and there is only one caption. They differ on composition, focal
subject, palette and viewpoint, and each of those is genuinely drawn
differently: a dimension that only changed a label would make rule 7's count
a lie.

Option B takes the next eligible focal subject where one exists. Where the
evidence supports only one honest treatment it keeps the same subject, and the
pair still differs on the other three dimensions. Inventing a second subject to
look varied would mean picking a treatment the evidence does not support.

Selection is deterministic: the same caption always yields the same two briefs,
which is what makes a run replayable.

**The chart gate lives here.** Concepts whose `visual_type` is `chart` are not
candidates at all unless a figure — a percentage, a multiplier, a decimal, or a
number of two digits or more — actually appears in the caption or its evidence.
`chart_declined` says when a quantitative-sounding subject was refused a chart,
so the reason survives into the summary.

## `check_option_distinctness()`

Rules 7 and 8, both measured.

Counts how many of the four dimensions hold different values, and scores the two
briefs' descriptive text with Dice similarity against the configured cap.
Neither is estimated — a model asked whether two pictures look different enough
will say yes.

Reports; never re-rolls. Two options that failed to separate are a fact about the
evidence, and hiding it would hand the human gate a false choice.

## `compose_background_prompt(concept, platform)`

Builds the prompt for whichever painter is bound, describing an abstract field
and nothing else.

It explicitly asks for no text, no numerals, no logos, no readable chart values
and no faces. If you find yourself wanting to add any of those, the request
belongs in the caption, not the picture.

The negative prompt carries rule 5's cliché register in full — glowing brains,
humanoid robots, neon circuit swirls, holographic faces, generic futuristic
servers, busy compositions, cheesy metaphors. A painter that has never read the
skill still needs telling that a glowing brain is not what a research lab looks
like.

## `render_image(option)`

Draws the brand layer as vectors on the configured placement's canvas and
returns the finished asset.

This needs no service and cannot fail. That makes it the floor: a post is never
left without a picture because a model was unreachable. When a background was
painted it is composited underneath at reduced opacity, so the headline stays
legible over anything.

Composition, palette and viewpoint all reach the SVG. `centred` moves the
headline and the geometry band; `bright` changes which of the four purples
leads; `oblique` skews the geometry group about its own centre. This is what
makes A and B two pictures rather than two captions for one picture.

The type size is fitted to the **short** axis as well as the width. A 4:1 banner
is 396px tall, and sizing from width alone would push four lines of headline
clean off the canvas.

Where a long headline would otherwise run under the logomark, the **headline
block drops below the mark's clear space** — the mark is never moved, shrunk or
cropped, because rule 14 says the canvas is what is wrong, not the mark. Only
when the canvas has no room left for that (a 4:1 banner is the real case) does
the block stay put and `check_logo_clear_space` report the collision. A check
that fired on every ordinary headline is one an operator learns to ignore.

## `write_alt_text(headline, concept)`

Alt text describing the content — headline subject first, treatment named last.

**Required.** An asset without alt text cannot be published, so returning one
without calling this only moves the failure to the Publishing Agent.

## `check_forbidden_imagery(text)`

Rule 5, checked rather than hoped for.

The negative prompt asks a painter to avoid the cliché register. This asks
whether anyone — the concept, the topic, an operator's own instruction — put one
back in. It reports and never edits, because rule 12 says off-brand output is
flagged, not silently corrected.

## `check_visual_compliance(asset, alt_text)`

Every visual rule in one round trip, so you are never fixing them one at a time
against a moving target:

- canvas matches the configured placement (rule 15)
- alt text exists (rule 11)
- the brand layer was drawn locally (rule 14)
- the focal system is one this renderer knows (rule 3)
- the typefaces are Roboto and DM Sans (rule 10)
- the headline overlaps the caption's hook (rule 1)
- **palette** — every accent is one of the four Ethara Purples, checked against
  what the renderer actually emitted rather than what it meant to (rule 9)
- **logo clear space** — measured in pixels against the configured ratio. A side
  the mark shares nothing with is `None`, not zero: "nothing is beside it" and
  "something is touching it" are different answers (rule 14)
- **forbidden imagery** (rule 5)

Reports; never rewrites.

## `check_visual_similarity(concept_text)`

Dice similarity against concepts already shipped, compared to the cap in resolved
settings.

The visual cap is deliberately looser than the caption cap: two posts on the same
subject *should* look related. What must not repeat is the same picture.
Computed, never estimated.

## `paint_background(prompt, width, height, ...)`

Asks the bound painter for background pixels. Runs before the tool loop, for the
same reason the briefs do — a background acquired inside the loop would be
missing on every run with no model bound, and the creative would silently ship
the brand layer alone.

**Two transports, one model.** Ollama holds the FLUX.2 Klein weights but its HTTP
API still refuses image models, so the painter tries Ollama first and falls
through to mflux, the MLX port of the same model, run as a subprocess. That is
transport selection, not model substitution: an operator who asked for FLUX.2
Klein gets FLUX.2 Klein either way, and the transport that served is recorded.

**It never raises.** Every failure returns a reason and the brand renderer draws
the creative alone. Choosing `brand-svg` and having `flux2-klein` decline are
reported differently — the first is a decision, the second an unmet dependency,
and an operator who chose the local renderer should not be told something went
wrong.

Background pixels only. The prompt asks for a clean surface empty of text, the
brand layer is composited over the result locally, and rule 14 holds even if the
model ignores the instruction entirely.
