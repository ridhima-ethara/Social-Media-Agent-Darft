# Worked briefs

Two complete outputs against the `image-brief` output contract (rule 16), one per production
pattern. They exist to show the shape of a compliant brief, not to be reused verbatim — reusing a
focal subject across posts is the failure rule 17 warns about.

Field names are the contract's. Do not rename them.

---

## Brief A — `depth-section` · model-painted subject, composited brand layer

```yaml
core_visual_thesis: >
  What an audience sees is one surfaced result; its reliability is produced by
  layers of reasoning, verification and alignment that never surface.

caption_basis: >
  Caption argues that judging a system by its final answer ignores the process
  that determined whether the answer could be trusted.

visual_approach: conceptual_metaphor
approach_reason: >
  The caption explains a proportion — a little visible, much not — and a
  vertical ordering of what sits beneath. A mass whose bulk is submerged carries
  both relationships without needing a legend. A schematic would show the layers
  but lose the proportion, which is the half the caption turns on.

focal_subject: >
  A single crystalline mass, faceted and wireframe-structured, crossing a still
  horizontal plane. A small crown above the plane; the great majority below,
  tapering to a point. Cool pale facets above the line, deep violet-blue mass
  below it.

composition: >
  Vertical split. Left third: quiet ground reserved for the headline block.
  Right two-thirds: the mass, its waterline at roughly the upper third of the
  canvas. A vertical axis runs down the submerged body carrying the marker
  positions. Right margin reserved for the label column.

metaphor_mapping:
  research_concept: Output reliability is a product of unseen process.
  visual_object: A mass crossing a waterline.
  correspondence: >
    Visible portion = the delivered output. Submerged portion = the process.
    Vertical order = order of dependence, not chronology.
  must_not_imply: >
    Not danger, collision or hidden threat — the submerged mass is the value,
    not the hazard. Not scale comparison between named systems. Not that the
    layers are equal in size, since no evidence sizes them.

technical_relationships: >
  Five markers on one axis, ordered by dependence. No arrows: the caption
  describes composition, not flow, and an arrow would assert a sequence the
  evidence does not support.

evidence_basis: >
  Conceptual. No measured quantity appears. The marker count matches the
  layers the caption names and is not padded to fill the axis.

theme_mode: dark
palette: >
  Near-black ground. Pale cool neutrals for the mass above the line. Deep
  Purple for the submerged body. Primary Ethara Purple on the markers, which
  are the only illuminated elements. Glow Purple confined to the single crown
  marker. White for all type.

exact_on_image_text:
  headline: "The output is only the visible outcome."
  subhead: "Reliable intelligence is shaped by the reasoning beneath."
  labels:
    - FINAL OUTPUT
    - INTERMEDIATE REASONING
    - VERIFICATION
    - PROCESS REWARDS
    - POLICY OPTIMIZATION
    - MODEL ALIGNMENT

typography: >
  Roboto for headline and subhead; the phrase carrying the turn is set in
  Primary Ethara Purple within an otherwise white headline. DM Sans, uppercase
  and letterspaced, for every label.

negative_space: >
  The left column stays empty below the subhead. Clear ground above the
  waterline and beneath the taper. Target the composition's quiet-space range;
  do not fill it.

logo_asset: approved_ethara_wordmark_light
logo_position: >
  Top-left, inside the safe area, at least one logo-height of clear space.
  Composited after generation.

reference_asset: null
reference_preserve: null
reference_change: null
locked_elements: []

platform: linkedin
placement: linkedin_feed_square
width_px: 1080
height_px: 1080

generation_prompt: >
  A single crystalline mass crossing a still horizontal plane, photographed
  against a matte near-black void. Above the plane, a small faceted crown in
  pale cool neutrals, its internal wireframe structure visible through
  translucent facets. Below the plane, the same mass continues far larger,
  in deep violet-blue, its faceted geometry resolving into a fine triangulated
  lattice with faint points of light at the vertices, tapering to a single
  point toward the lower edge. The plane itself reads as a thin, calm
  separation, not as water with waves. One soft specular reflection beneath the
  taper. Studio lighting, controlled and directional. Refined material, precise
  geometry, generous empty space on the left side of the frame and above the
  plane. Photoreal render quality, high detail in the lattice.

  Absolutely no text, letters, numerals, labels, captions, watermarks, logos or
  typographic elements anywhere in the image. No arrows, no callout lines, no
  markers, no user interface. No neon glow washes, no particle fields, no lens
  flare, no fog. No boats, icebergs in a natural seascape, sky, clouds,
  horizon detail or any landscape context. Nothing photographic beyond the
  object and its ground.

compositing_instructions: >
  Draw locally, over the generated background, from brand tokens:
  1. The waterline rule across the full width at the subject's plane.
  2. Six circular markers on the vertical axis — one above the line, five
     below — each a ring with an illuminated core in Primary Ethara Purple;
     the crown marker carries the Glow Purple halo.
  3. A dotted leader from each marker to the right margin, each terminating at
     its uppercase label. Leaders run horizontally and stop at the label.
  4. Small line icons to the left of the five submerged labels.
  5. Headline and subhead in the left column, vertically centred against the
     submerged mass.
  6. The approved wordmark, top-left.
  Nothing in this list may be generated. If the rendered background contains
  any text-like artefact, reject and regenerate; do not composite over it.

must_avoid: >
  Any model-rendered text or logo. Arrows implying flow between the layers. A
  sixth layer added for symmetry. Purple applied to the mass above the line.
  Headline text set over the subject. A natural seascape reading.

alt_text: >
  A crystalline mass crosses a horizontal line against a black background: a
  small pale crown above, and a far larger deep-purple faceted body below
  tapering to a point. A marker on the crown is labelled Final Output. Five
  markers down the submerged body are labelled Intermediate Reasoning,
  Verification, Process Rewards, Policy Optimization and Model Alignment. Text
  at left reads "The output is only the visible outcome" with "visible outcome"
  in purple, above the line "Reliable intelligence is shaped by the reasoning
  beneath." The Ethara.AI wordmark sits top-left.

validation_status: not_run
unresolved_issues: []
```

---

## Brief B — `state-flow` · fully deterministic, no generative step

```yaml
core_visual_thesis: >
  An agent improves by acting on an environment and being scored on what the
  environment returns — the loop, not the model, is what learns.

visual_approach: systems_diagram
approach_reason: >
  Every element carries a named relationship, and the direction of each edge is
  the content. Rule 14 requires a deterministic tool where relationships and
  labels are essential, so nothing here is generated.

focal_subject: >
  Four outlined nodes — State, Agent, Action, Environment — on a rectangular
  circuit, with the reward path returning as a distinct edge.

technical_relationships: >
  State → Agent (observation). Agent → Action (policy output). Action →
  Environment (interaction). Environment → next State (transition, dashed).
  Environment → Agent (reward, dashed, distinct colour). Direction and dash
  state are load-bearing: solid is the forward path, dashed is what returns.

evidence_basis: >
  Textbook formalism, not a measurement. No performance figure appears, and the
  reward edge must not be drawn in a way that implies guaranteed improvement.

theme_mode: dark
palette: >
  Deep charcoal-navy ground. Each node keeps one hue for its outline and its
  edge, so an edge is traceable to its source without a legend. Primary Ethara
  Purple on the Agent, which is the subject.

exact_on_image_text:
  title: "Reinforcement Learning"
  subtitle: "AGENT LEARNS THROUGH INTERACTION WITH AN ENVIRONMENT"
  node_labels: [State, Agent, Action, Environment]
  edge_labels: [State, Action, Reward, Next state, Interacts with environment]
  node_captions:
    Agent: Learns a policy to maximize cumulative reward
    State: Representation of the environment at time t
    Action: Action taken by the agent at time t
    Environment: Evolves based on the agent's action

typography: Roboto for the title; DM Sans for every label and caption.

negative_space: >
  The circuit sits inside a generous margin; the lower-centre region stays open
  so the Environment node has room beneath the title block.

logo_asset: approved_ethara_wordmark_light
logo_position: Bottom-right, inside the safe area.

platform: x
placement: x_feed_landscape
width_px: 1600
height_px: 900

generation_prompt: null   # deterministic render — no model is called

compositing_instructions: >
  Render the entire creative with the local vector renderer. Rounded-rectangle
  nodes with a coloured outline and a soft inner fill; a circular glyph at the
  top of each node. Edges leave and enter node edges orthogonally, never
  crossing a node. Every edge carries its label at its midpoint in the edge's
  own colour. Dashed strokes for the reward and transition paths only. Title
  block centred above the circuit. Wordmark bottom-right.

must_avoid: >
  Any generated background. A reward edge drawn as always-positive. An extra
  node not named in the caption. Edge labels detached from their edges.

alt_text: >
  A four-node loop diagram titled Reinforcement Learning. State feeds the
  Agent, which learns a policy to maximize cumulative reward; the Agent emits
  an Action; the Action interacts with the Environment; the Environment returns
  a dashed Reward edge to the Agent and a dashed Next state edge to State.

validation_status: not_run
unresolved_issues: []
```

---

## What separates these two

Brief A uses a model because its meaning lives in a **material** — the translucency and the lattice
carry the argument. Brief B calls no model because its meaning lives in **labelled directed edges**,
which a diffusion model cannot be trusted to place and which rule 14 requires a deterministic tool
to draw.

The question to ask of any brief is not "would a model render this nicely" but "does the argument
survive if the model gets a detail wrong". Where it would not, the diagram is drawn locally.
