# Image Brief

## Purpose

Author on-brand image briefs for Ethara.AI — clean, technical, research-forward
visuals for an RL/AGI infrastructure company.

Produces **two distinct briefs** — image options A and B — for the human gate.

The visual direction must read as a serious, technical AI/RL infrastructure
company. Never stocky, never consumer-cute.

This skill determines the concept and the detailed creative direction. Whether
this same step renders final pixels directly, or hands the brief to a separate
rendering adapter, is a question for engineering. Treat concept/direction and
rendering as distinct operations.

## Inputs

- The shared CoreContext used by the caption.
- Subject/message and supporting evidence.
- Target platform and placement.
- Platform dimension requirements.
- User-specified visual constraints, including elements that must remain
  unchanged during iteration.
- Brand visual identity and logo assets from the Knowledge Base.

## Outputs

Two distinct image briefs, corresponding to image options A and B. Each brief
carries everything required to produce the visual:

```text
[
  {
    subject:       visual subject/message derived from CoreContext,
    visual_type:   chart | diagram | conceptual/schematic,
    composition:   focal composition and layout direction,
    focal_subject: primary visual system,
    palette:       Ethara Purple family,
    typography:    Roboto | DM Sans,
    viewpoint:     visual viewpoint/direction,
    alt_text:      accessible description,
    platform:      target platform/placement,
    dimensions:    configured width × height,
    aspect_ratio:  selected aspect ratio
  },
  ...
]
```

## Rules

1. **Subject derivation.** Derive the visual subject and message from the shared
   CoreContext — the same context used by the caption. The visual and the
   caption must communicate the same core story.

2. **Visual type selection.** Choose the visual treatment from the available
   evidence:

   - Quantitative contrast → restrained chart.
   - Process or mechanism → systems diagram.
   - Broad idea without an attached dataset → conceptual or schematic visual.

   Never use a chart when the supporting data does not exist.

3. **Focal system.** Reduce the idea to one focal visual system. Do not attempt
   to illustrate every paragraph or every concept in the source.

4. **Visual direction.** Use a clean, minimal, technical and research-forward
   visual style. The visual should have high signal-to-noise, generous negative
   space, strong typographic treatment, restrained engineered composition, and a
   precise, modern, confident presentation.

   Appropriate abstract technical imagery includes reward curves, RL loops,
   agent–verifier diagrams, benchmark charts, state transitions and
   trajectories. These should be schematic rather than literal.

5. **Forbidden visual direction.** Avoid cliché AI stock imagery: glowing
   brains, humanoid robots, neon circuit swirls, holographic AI faces, generic
   futuristic-server imagery, busy compositions, cheesy metaphors.

6. **Claim safety.** Never fabricate chart data or visually imply a result that
   is absent from the supporting source.

7. **Option differentiation.** Produce two distinct briefs. The two briefs must
   differ on at least the configured number of visual dimensions, selected from
   composition, focal subject, colour/palette, and viewpoint. Wording changes
   alone do not constitute a second visual direction.

8. **Distinctness threshold.** The two visual options must score at or below the
   configured visual similarity cap (`image_agent.similarity_cap`). Options
   above it are not sufficiently distinct.

9. **Colour.** Use the confirmed Ethara Purple family as the accent, and no
   other accent colour:

   | Role | Hex |
   |---|---|
   | Ethara Purple | `#8B2CF5` |
   | Deep Purple | `#5E1BC7` |
   | Bright Purple | `#A855F7` |
   | Glow Purple | `#C084FC` |

   Ground and ink are structural, not accents: a card needs a surface to sit on
   and text that can be read against it. They are declared alongside the family
   and reported separately, never sampled freely.

10. **Typography.** Roboto for headers/display. DM Sans for supporting/body text.

11. **Accessibility.** Include accessible `alt` text for the visual.

12. **Brand compliance.** Apply [`brand-voice`](../brand-voice/SKILL.md) and the
    approved visual identity. Flag off-brand output rather than silently
    correcting it (Constitution **Principle VII**).

13. **Iteration integrity.** During iteration, never change an element that the
    user explicitly requested to keep unchanged.

14. **Logo usage.** Respect logo clear-space requirements. Never distort or
    recolour the Ethara logo. Use the Knowledge Base brand assets for applicable
    logo rules.

15. **Platform dimensions.** Select the appropriate configured size for the
    requested platform and placement:

    | Placement | Size | Aspect ratio |
    |---|---:|---:|
    | Instagram feed — primary | 1080 × 1350 px | 4:5 |
    | Instagram feed — square | 1080 × 1080 px | 1:1 |
    | Instagram Stories/Reels | 1080 × 1920 px | 9:16 |
    | LinkedIn feed — square | 1080 × 1080 px | 1:1 |
    | LinkedIn feed — landscape | 1200 × 627 px | 1.91:1 |
    | LinkedIn feed — portrait | 1080 × 1350 px | 4:5 |
    | LinkedIn carousel slide | 1080 × 1080 or 1080 × 1350 px | 1:1 or 4:5 |
    | LinkedIn personal banner | 1584 × 396 px | 4:1 |
    | YouTube thumbnail | 1280 × 720 px | 16:9 |
    | YouTube video | 1920 × 1080 px | 16:9 |

    These sizes are configurable references, not hard-coded constants.

## Boundaries

The Image Brief skill MUST NOT:

- Derive a visual that conflicts with the shared CoreContext.
- Fabricate chart data.
- Imply a result absent from the source.
- Use a chart when the evidence does not contain supporting quantitative data.
- Attempt to illustrate every paragraph instead of selecting one focal visual
  system.
- Return two options that are only wording changes or trivial visual variants.
- Return options above the configured visual similarity cap.
- Use cliché AI stock imagery as defined in rule 5.
- Distort or recolour the Ethara AI logo.
- Change an element the user explicitly requested to keep unchanged.
- Silently correct off-brand output instead of flagging it.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| Evidence carries no figures but the subject sounds quantitative | Choose a diagram or conceptual treatment, and say the chart was declined for want of data |
| The two options come back too similar | Report the measured score and which dimensions failed to differ. Never relabel one to look distinct |
| A requested placement has no configured size | Fall back to the platform's default placement and name the substitution |
| The operator locked an element that the new evidence contradicts | Hold the locked element and report the contradiction |
| The logo cannot hold its clear space on the chosen canvas | Report the violation. Never shrink or crop the mark to make it fit |
| No generative model is available | Omit the background prompt; the renderer draws the vector field alone |
