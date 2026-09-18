# Brand reference images

Visual guidance for the Image Agent's background painters. Drop images here and
describe each one in `references.json`.

## How to add a reference

1. **Put the image file in this folder** — `.jpg`, `.png` or `.webp`.
   Example: `public/brand/references/mood-01.jpg`

2. **Add an entry to `references.json`** describing its style:

   ```json
   {
     "references": [
       {
         "file": "mood-01.jpg",
         "label": "House mood — dark editorial",
         "style": "deep near-black ground, restrained violet and magenta accents, soft volumetric light, generous negative space, cinematic and high-contrast",
         "concepts": [],
         "active": true
       }
     ]
   }
   ```

3. That's it. On the next image render the `style` text is appended to the
   background prompt, so every painter (Imagen, Gemini, FLUX.2 Klein, Z-Image)
   is steered toward that look.

## Fields

| Field | Meaning |
|---|---|
| `file` | The image filename in this folder. Required. |
| `style` | **The words that actually steer the text painters.** Describe palette, mood, texture, composition. Never put brand copy (headlines, logos) here — see invariant 21 below. |
| `label` | Optional human name, shown in logs and the UI. |
| `concepts` | Which image concepts this applies to (`gradient-field`, `signal-lines`, `reward-surface`, `agent-graph`, `benchmark-bars`, `data-lattice`). Empty `[]` = all of them. |
| `active` | `false` hides it without deleting it. Defaults to `true`. |

## Why the `style` text matters more than the file

Three of the four background painters — **Imagen**, **FLUX.2 Klein** (via mflux)
and **Z-Image** — accept a **text prompt only**. They never see the pixels, so a
reference image influences them *only* through its `style` description. Write it
well. The **Gemini** painter additionally accepts the image itself as visual
conditioning when image-reference is enabled, but the text clause is the
portable floor that reaches all four.

## Invariant 21 — references steer the background only

References guide the **background artwork**. The brand layer — headline, kicker,
logomark, footer — is always composited locally as vectors and is **never** sent
to any diffusion model. Do not describe text, lettering, or logos in a `style`
field; a painter asked for text produces garbled lettering, which is exactly
what the local vector layer exists to prevent.

## Turning it off

The whole feature is gated by the **"Use brand reference images"** knob on the
Image Agent's *Compose the background* skill in Agent Studio. Off, generation
runs exactly as it did before.
