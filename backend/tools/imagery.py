"""
IMAGERY TOOLS — the two-layer render, produced twice

Every asset is drawn in two layers, and the split is the whole discipline:

    background   optional, painted by a diffusion model when one is reachable
    brand layer  always local vectors — headline, kicker, accent bar, logomark

**No diffusion model is ever asked to render brand text.** A model that paints
letters paints them wrong, and a wrong headline on a lab's post is worse than no
picture. So the headline is drawn here, deterministically, from the caption's
own hook — the same caption always yields the same bytes.

Everything here is produced **twice**. `packages/skills/image-brief/SKILL.md`
asks for two distinct briefs, A and B, so the human gate has something to choose
between. The two are not one picture relabelled: they differ on visual
dimensions that are actually drawn differently, and how many they differ on is
*counted*, never claimed.

The canvases are the skill's rule 15 table. They are configured references,
selected per platform **and placement**, which is why `PLACEMENTS` is a table
that the `placement` knob indexes into rather than one size welded to each
platform.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

# ── Brand reference images ────────────────────────────────────────────────────
# The operator's visual guidance lives in `public/brand/references/`, described
# in `references.json`. Skill rule 10: those descriptions steer the background
# prompt so a generated creative follows the house look. imagery.py is at
# <repo>/backend/tools/, so the manifest is two parents up then into public/.
_REFERENCES_MANIFEST = (
    Path(__file__).resolve().parent.parent.parent
    / "public" / "brand" / "references" / "references.json"
)


def _reference_style_clause(concept: str) -> str:
    """
    The art direction for one concept, from ONE reference, text clauses stripped.

    Two faults are corrected here, the same two the Node tier had.

    It used to JOIN every applicable reference. With most entries applying to all
    concepts that asked the painter for two different hero subjects at once — a
    server hall and a monolith — which is a contradiction rather than a style, and
    the painter resolved it by ignoring both.

    And the descriptions are written from finished creatives, so they name
    headlines and callout labels. Those belong to the brand layer, which is
    composited locally as vectors; asking a diffusion model for lettering is
    forbidden outright. Passing them through produced a prompt that argued with
    its own "no text" instruction.

    So: one reference, preferring an entry tagged for this concept, chosen
    deterministically so a run stays replayable; and only the clauses describing
    light, material, palette and composition survive.
    """
    try:
        raw = _REFERENCES_MANIFEST.read_text(encoding="utf-8")
        parsed = json.loads(raw)
        entries = parsed.get("references", []) if isinstance(parsed, dict) else []
    except (OSError, ValueError):
        return ""

    applicable = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("active") is False:
            continue
        concepts = entry.get("concepts") or []
        if concepts and concept not in concepts:
            continue
        if str(entry.get("style", "")).strip():
            applicable.append(entry)

    if not applicable:
        return ""

    tagged = [e for e in applicable if concept in (e.get("concepts") or [])]
    pool = tagged or applicable

    seed = 0
    for ch in concept:
        seed = (seed * 31 + ord(ch)) & 0xFFFFFFFF
    chosen = pool[seed % len(pool)]

    # Clauses naming text are dropped; the brand layer supplies those.
    text_clause = re.compile(
        r"\b(headline|heading|label(s|led)?|caption|callout|dot leaders?|"
        r"lettering|typography|wordmark|logo(mark)?|text)\b",
        re.I,
    )
    kept = [
        part.strip()
        for part in str(chosen.get("style", "")).split(",")
        if part.strip() and not text_clause.search(part)
    ]
    if not kept:
        return ""

    return (
        " Match this art direction: " + ", ".join(kept) + "."
        " Render the background only \u2014 no lettering, no labels, no logo of any kind."
    )

# The brand palette, mirroring `BRAND.visual.family` in shared/brand-voice.ts
# and skill rule 9. These four are the only accents that may appear.
ACCENT, ACCENT_MID, ACCENT_LIGHT, ACCENT_DEEP = "#8B2CF5", "#A855F7", "#C084FC", "#5E1BC7"
GROUND, INK, INK_MUTED = "#0B0E14", "#FFFFFF", "#8A8FA5"

#: Rule 9's table under the skill's own names, so `check_palette` can test
#: against it and an accent outside it is a finding rather than a preference.
PURPLE_FAMILY: dict[str, str] = {
    "Ethara Purple": ACCENT,
    "Deep Purple": ACCENT_DEEP,
    "Bright Purple": ACCENT_MID,
    "Glow Purple": ACCENT_LIGHT,
}

#: Ground and ink are structural, not accents: a card needs a surface to sit on
#: and text that can be read against it. Rule 9 governs the *accent*, and
#: reading it as "no non-purple pixel anywhere" would forbid legible text.
#: They are declared here so they are reported rather than quietly exempt.
STRUCTURAL: dict[str, str] = {"Ground": GROUND, "Ink": INK, "Ink muted": INK_MUTED}

#: Rule 10, in one place. Nothing else names a typeface.
TYPOGRAPHY: dict[str, str] = {"display": "Roboto", "body": "DM Sans"}

_DISPLAY_STACK = f"{TYPOGRAPHY['display']}, Inter, system-ui, sans-serif"
_BODY_STACK = f"{TYPOGRAPHY['body']}, Inter, system-ui, sans-serif"

#: Rule 15's table. Configured references, not constants welded to a platform:
#: the `placement` knob names one of these keys and `auto` takes the platform
#: default. `label` is the placement's name, `size_label` its dimensions —
#: different facts, and code reads both.
PLACEMENTS: dict[str, dict[str, Any]] = {
    "instagram:primary":  {"platform": "instagram", "label": "Instagram feed — primary",
                           "width": 1080, "height": 1350, "aspect": "4:5"},
    "instagram:square":   {"platform": "instagram", "label": "Instagram feed — square",
                           "width": 1080, "height": 1080, "aspect": "1:1"},
    "instagram:story":    {"platform": "instagram", "label": "Instagram Stories/Reels",
                           "width": 1080, "height": 1920, "aspect": "9:16"},
    "linkedin:square":    {"platform": "linkedin", "label": "LinkedIn feed — square",
                           "width": 1080, "height": 1080, "aspect": "1:1"},
    "linkedin:landscape": {"platform": "linkedin", "label": "LinkedIn feed — landscape",
                           "width": 1200, "height": 627, "aspect": "1.91:1"},
    "linkedin:portrait":  {"platform": "linkedin", "label": "LinkedIn feed — portrait",
                           "width": 1080, "height": 1350, "aspect": "4:5"},
    "linkedin:carousel":  {"platform": "linkedin", "label": "LinkedIn carousel slide",
                           "width": 1080, "height": 1080, "aspect": "1:1"},
    "linkedin:banner":    {"platform": "linkedin", "label": "LinkedIn personal banner",
                           "width": 1584, "height": 396, "aspect": "4:1"},
    "youtube:thumbnail":  {"platform": "youtube", "label": "YouTube thumbnail",
                           "width": 1280, "height": 720, "aspect": "16:9"},
    "youtube:video":      {"platform": "youtube", "label": "YouTube video",
                           "width": 1920, "height": 1080, "aspect": "16:9"},
    # X and Facebook are not in the skill's table, but they are in `Platform`,
    # so they need a canvas. These are this product's own and are labelled that
    # way rather than presented as though the skill specified them.
    "x:feed":             {"platform": "x", "label": "X feed (product default)",
                           "width": 1600, "height": 900, "aspect": "16:9"},
    "facebook:feed":      {"platform": "facebook", "label": "Facebook feed (product default)",
                           "width": 1200, "height": 630, "aspect": "1.91:1"},
}

for _key, _spec in PLACEMENTS.items():
    _spec["id"] = _key
    _spec["size_label"] = f"{_spec['width']}×{_spec['height']}"

#: Which placement a platform gets when nobody names one.
PLATFORM_DEFAULT_PLACEMENT: dict[str, str] = {
    "linkedin": "linkedin:landscape",
    "instagram": "instagram:primary",
    "x": "x:feed",
    "facebook": "facebook:feed",
}

#: Derived, not declared. Callers that only know a platform still get a canvas,
#: and the default lives in exactly one place.
CANVASES: dict[str, dict[str, Any]] = {
    platform: PLACEMENTS[key] for platform, key in PLATFORM_DEFAULT_PLACEMENT.items()
}

# The background treatments the renderer knows how to draw, with the cues that
# pull a subject toward each, and the visual type each one *is*. Selection is
# deterministic, so a run replays.
#
# `visual_type` is rule 2. A chart may only be chosen when the evidence actually
# carries figures, so the type has to travel with the concept rather than being
# inferred from its name later.
CONCEPTS: list[dict[str, Any]] = [
    {"id": "gradient-field", "label": "Gradient field", "visual_type": "conceptual",
     "suited_to": "Positioning and thought-leadership posts with no single hard metric",
     "cues": ["positioning", "thesis", "philosophy", "approach", "why"]},
    {"id": "signal-lines", "label": "Signal lines", "visual_type": "conceptual",
     "suited_to": "Trend and movement posts where something is rising or falling",
     "cues": ["trend", "growth", "velocity", "rising", "shift", "movement"]},
    {"id": "reward-surface", "label": "Reward surface", "visual_type": "diagram",
     "suited_to": "Reinforcement learning, reward modelling and post-training subjects",
     "cues": ["reward", "rlhf", "reinforcement", "policy", "preference", "post-training"]},
    {"id": "agent-graph", "label": "Agent graph", "visual_type": "diagram",
     "suited_to": "Agentic systems, orchestration and multi-agent architecture",
     "cues": ["agent", "agentic", "orchestration", "multi-agent", "tool", "workflow"]},
    {"id": "benchmark-bars", "label": "Benchmark bars", "visual_type": "chart",
     "suited_to": "Evaluation, benchmarks and anything carrying comparative figures",
     "cues": ["benchmark", "evaluation", "eval", "score", "leaderboard", "measure"]},
    {"id": "data-lattice", "label": "Data lattice", "visual_type": "conceptual",
     "suited_to": "Synthetic data, datasets and training-corpus subjects",
     "cues": ["synthetic", "dataset", "data", "corpus", "generation", "sampling"]},
]

CONCEPT_BY_ID = {c["id"]: c for c in CONCEPTS}

#: Rule 7's dimensions. The two options must differ on at least the configured
#: number of these, and each one below is genuinely drawn differently — a
#: dimension that only changed a label would make the count a lie.
OPTION_DIMENSIONS = ("composition", "focal_subject", "palette", "viewpoint")

#: Layout direction. `left-weighted` keeps the headline hard left with the
#: geometry in the right band; `centred` centres the headline and moves the
#: geometry to the left band. Different negative space, not a different caption.
COMPOSITIONS: dict[str, dict[str, Any]] = {
    "left-weighted": {"label": "Left-weighted", "anchor": "start", "band": (0.62, 1.0)},
    "centred": {"label": "Centred", "anchor": "middle", "band": (0.0, 0.38)},
}

#: Rule 9's family, weighted two ways. Both stay inside the four approved
#: accents — a palette variant changes which of them leads, never which family.
PALETTE_VARIANTS: dict[str, dict[str, Any]] = {
    "deep": {"label": "Deep purple lead", "lead": ACCENT_DEEP, "mid": ACCENT,
             "light": ACCENT_MID, "wash": 0.34},
    "bright": {"label": "Glow purple lead", "lead": ACCENT_MID, "mid": ACCENT_LIGHT,
               "light": ACCENT_LIGHT, "wash": 0.20},
}

#: Viewpoint. `oblique` skews the geometry group, so the two options are drawn
#: from genuinely different angles rather than described as though they were.
VIEWPOINTS: dict[str, dict[str, Any]] = {
    "head-on": {"label": "Head-on", "skew": 0.0},
    "oblique": {"label": "Oblique", "skew": -8.0},
}

_WORD = re.compile(r"[a-z0-9]+")

#: Rule 2/6. What counts as an attached dataset: a percentage, a multiplier, a
#: decimal, or a figure of two digits or more. A lone "3" in prose is not a
#: dataset, and treating it as one is how a chart with no data gets drawn.
_QUANTITY = re.compile(r"\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*[x×]\b|\b\d+\.\d+\b|\b\d{2,}\b")


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace('"', "&quot;")
    )


def _bigrams(text: str) -> set[str]:
    words = _WORD.findall(text.lower())
    grams = set(words)
    grams.update(f"{a} {b}" for a, b in zip(words, words[1:]))
    return grams


def visual_similarity(a: str, b: str) -> float:
    """
    Dice over the concept description's bigrams.

    Constraint 4: similarity is **computed, never judged**. A model asked to
    estimate how similar two pictures are will answer confidently and wrongly.
    """
    left, right = _bigrams(a), _bigrams(b)
    if not left or not right:
        return 0.0
    return 2 * len(left & right) / (len(left) + len(right))


# ── Placement ─────────────────────────────────────────────────────────────────

def resolve_placement(platform: str, placement: str = "auto") -> tuple[dict[str, Any], str]:
    """
    Turns a platform and an operator's placement into one configured canvas.

    An unknown placement falls back to the platform's default and *says so*.
    Silently drawing on some other size hands back a creative that looks
    finished and is the wrong shape for where it is going.
    """
    default_key = PLATFORM_DEFAULT_PLACEMENT.get(platform, "linkedin:landscape")

    if not placement or placement == "auto":
        spec = PLACEMENTS[default_key]
        return spec, f"{spec['label']} — the default placement for {platform}."

    spec = PLACEMENTS.get(placement)
    if spec is None:
        spec = PLACEMENTS[default_key]
        return spec, (f"`{placement}` is not a configured placement, so {spec['label']} was used "
                      "instead. Nothing was drawn on a guessed size.")

    if spec["platform"] != platform:
        return spec, (f"{spec['label']} — named explicitly, though it is a {spec['platform']} "
                      f"size and this post is going to {platform}.")

    return spec, f"{spec['label']} — named explicitly."


# ── Concept ───────────────────────────────────────────────────────────────────

def has_quantitative_evidence(*texts: str) -> bool:
    """
    Rule 2: never use a chart when the supporting data does not exist.

    This asks whether a figure is actually present in what the caption and its
    evidence say — not whether the subject *sounds* quantitative. "Our
    benchmark work" contains the word benchmark and no data at all, and drawing
    bars for it would imply a result nobody measured (rule 6).
    """
    return any(_QUANTITY.search(t or "") for t in texts)


def _eligible_concepts(quantitative: bool) -> list[dict[str, Any]]:
    """Chart concepts drop out entirely when there is nothing to chart."""
    return [c for c in CONCEPTS if quantitative or c["visual_type"] != "chart"]


def _rank_concepts(haystack: str, quantitative: bool) -> list[tuple[dict[str, Any], int]]:
    """
    Concepts by cue strength, strongest first. Deterministic, so a run replays.

    Ties keep declaration order, which is why the ordering of `CONCEPTS` is
    itself part of the behaviour rather than an accident of editing.
    """
    scored = [
        (concept, sum(len(cue) for cue in concept["cues"] if cue in haystack))
        for concept in _eligible_concepts(quantitative)
    ]
    return sorted(scored, key=lambda pair: -pair[1])


def derive_concept(
    caption: str,
    title: str = "",
    topic: str = "",
    platform: str = "linkedin",
    grounding: list[dict[str, Any]] | None = None,
    headline_max_words: int = 12,
    placement: str = "auto",
    evidence: str = "",
) -> dict[str, Any]:
    """
    Chooses the treatment and the headline from the caption itself.

    Rule 1: the headline restates the caption's hook. A visual that says
    something the caption does not is a defect, so the headline is *taken* from
    the caption rather than written afresh.

    Rule 2 is enforced here rather than downstream: a chart concept is not even
    a candidate unless a figure appears in the caption or its evidence.
    """
    grounding = grounding or []
    haystack = f"{title} {topic} {caption}".lower()
    quantitative = has_quantitative_evidence(caption, evidence, title)
    canvas, placement_reason = resolve_placement(platform, placement)

    ranked = _rank_concepts(haystack, quantitative)
    best, best_score = ranked[0]

    chart_declined = (
        not quantitative
        and any(cue in haystack for cue in CONCEPT_BY_ID["benchmark-bars"]["cues"])
    )

    return {
        "concept": best["id"],
        "concept_label": best["label"],
        "visual_type": best["visual_type"],
        "headline": " ".join(
            next((line.strip() for line in caption.splitlines() if line.strip()), title).split()
        [:headline_max_words]) or title,
        "kicker": (topic or "AI research").upper(),
        "concept_reason": (
            f"{best['label']} — {best['suited_to'].lower()}."
            if best_score
            else "Gradient field — no concept cue appeared in the caption, so the neutral "
                 "treatment is used."
        ),
        "visual_type_reason": (
            "The evidence carries figures, so a chart treatment is available."
            if quantitative else
            "No figure appears in the caption or its evidence, so chart treatments were not "
            "candidates. A chart drawn over absent data would imply a result nobody measured."
        ),
        "chart_declined": chart_declined,
        "cue_score": best_score,
        "placement": canvas["id"],
        "placement_reason": placement_reason,
        "canvas": canvas["size_label"],
        "aspect_ratio": canvas["aspect"],
        "grounded_in": [g.get("id", "") for g in grounding],
    }


# ── The two briefs ────────────────────────────────────────────────────────────

#: Option A and option B, as fixed pairings of the three non-subject dimensions.
#: Rule 7 asks for at least a configured number of differences; pairing all
#: three here means the focal subject is free to repeat when the evidence only
#: supports one honest treatment, and the pair still clears the floor.
_OPTION_STYLES = (
    {"option": "A", "composition": "left-weighted", "palette": "deep", "viewpoint": "head-on"},
    {"option": "B", "composition": "centred", "palette": "bright", "viewpoint": "oblique"},
)


def _brief(
    style: dict[str, str],
    concept: dict[str, Any],
    base: dict[str, Any],
    canvas: dict[str, Any],
    platform: str,
    topic: str,
) -> dict[str, Any]:
    """One brief, in the shape the skill's Output section specifies."""
    palette = PALETTE_VARIANTS[style["palette"]]
    composition = COMPOSITIONS[style["composition"]]
    viewpoint = VIEWPOINTS[style["viewpoint"]]

    alt = write_alt_text(base["headline"], concept["id"], platform, topic)

    return {
        "option": style["option"],
        "subject": base["headline"],
        "visual_type": concept["visual_type"],
        "composition": style["composition"],
        "composition_label": composition["label"],
        "focal_subject": concept["id"],
        "focal_subject_label": concept["label"],
        "palette": style["palette"],
        "palette_label": palette["label"],
        "palette_hexes": [palette["lead"], palette["mid"], palette["light"]],
        "typography": f"{TYPOGRAPHY['display']} / {TYPOGRAPHY['body']}",
        "viewpoint": style["viewpoint"],
        "viewpoint_label": viewpoint["label"],
        "alt_text": alt["alt_text"],
        "platform": platform,
        "placement": canvas["id"],
        "placement_label": canvas["label"],
        "dimensions": canvas["size_label"],
        "aspect_ratio": canvas["aspect"],
        "headline": base["headline"],
        "kicker": base["kicker"],
        "concept_reason": (
            f"{concept['label']} — {concept['suited_to'].lower()}."
        ),
        "grounded_in": base["grounded_in"],
    }


def derive_options(
    caption: str,
    title: str = "",
    topic: str = "",
    platform: str = "linkedin",
    grounding: list[dict[str, Any]] | None = None,
    headline_max_words: int = 12,
    placement: str = "auto",
    evidence: str = "",
    locked: list[str] | None = None,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    The two distinct briefs the skill asks for — options A and B.

    They share the subject, because rule 1 says the visual and the caption tell
    the same story and there is only one caption. They differ on how that
    subject is drawn, which is what rule 7 is actually asking for.

    Option B takes the next eligible focal subject where one exists. Where the
    evidence only supports a single honest treatment it keeps the same one, and
    the pair still differs on composition, palette and viewpoint — three
    dimensions, drawn differently. Inventing a second subject to look varied
    would be picking a treatment the evidence does not support.

    `locked` is rule 13. Any dimension named there is carried across from
    `previous` untouched, and what was held is reported rather than assumed.
    """
    locked = locked or []
    base = derive_concept(
        caption, title, topic, platform, grounding, headline_max_words, placement, evidence
    )
    canvas, _ = resolve_placement(platform, placement)
    quantitative = has_quantitative_evidence(caption, evidence, title)

    ranked = _rank_concepts(f"{title} {topic} {caption}".lower(), quantitative)
    primary = CONCEPT_BY_ID[base["concept"]]
    alternate = next((c for c, _ in ranked if c["id"] != primary["id"]), primary)

    briefs = [
        _brief(_OPTION_STYLES[0], primary, base, canvas, platform, topic),
        _brief(_OPTION_STYLES[1], alternate, base, canvas, platform, topic),
    ]

    held = _apply_locks(briefs, locked, previous)

    return {
        "options": briefs,
        "selected": briefs[0]["option"],
        "visual_type": base["visual_type"],
        "visual_type_reason": base["visual_type_reason"],
        "chart_declined": base["chart_declined"],
        "placement": canvas["id"],
        "placement_reason": base["placement_reason"],
        "canvas": canvas["size_label"],
        "aspect_ratio": canvas["aspect"],
        "grounded_in": base["grounded_in"],
        "locked_held": held,
        "same_focal_subject": primary["id"] == alternate["id"],
        "reason": (
            f"Two briefs on \"{base['headline']}\": "
            f"{briefs[0]['focal_subject_label']} {briefs[0]['composition_label'].lower()} "
            f"{briefs[0]['viewpoint_label'].lower()}, against "
            f"{briefs[1]['focal_subject_label']} {briefs[1]['composition_label'].lower()} "
            f"{briefs[1]['viewpoint_label'].lower()}. {base['visual_type_reason']}"
        ),
    }


def _apply_locks(
    briefs: list[dict[str, Any]], locked: list[str], previous: dict[str, Any] | None
) -> list[dict[str, str]]:
    """
    Rule 13: an element the operator asked to keep is not re-derived.

    A lock with nothing to hold it from is reported as unheld rather than
    silently ignored — an operator who locked the headline and got a new one
    needs to know the lock did not apply, not to discover it in the render.
    """
    held: list[dict[str, str]] = []
    if not locked:
        return held

    for element in locked:
        source = (previous or {}).get(element)
        if source is None:
            held.append({"element": element, "status": "unheld",
                         "detail": "Nothing was carried in to hold this from, so it was derived afresh."})
            continue
        for brief in briefs:
            brief[element] = source
        held.append({"element": element, "status": "held",
                     "detail": f"Carried across unchanged: {source!r}."})
    return held


def check_option_distinctness(
    options: list[dict[str, Any]], cap: float = 85, min_dimensions: int = 2
) -> dict[str, Any]:
    """
    Rules 7 and 8, both measured.

    Rule 7 counts how many of the four dimensions actually hold different
    values. Rule 8 scores the two briefs' descriptive text against the cap.
    Neither is estimated — a model asked whether two pictures look different
    enough will say yes.
    """
    if len(options) < 2:
        return {"verdict": "UNCHECKED", "findings": [], "differs_on": [], "similarity": None,
                "reason": "Fewer than two options were produced, so distinctness is not defined."}

    a, b = options[0], options[1]
    differs = [d for d in OPTION_DIMENSIONS if a.get(d) != b.get(d)]
    threshold = cap / 100 if cap > 1 else cap
    score = visual_similarity(_describe(a), _describe(b))

    findings: list[dict[str, str]] = []
    if len(differs) < min_dimensions:
        findings.append({
            "rule": "7", "area": "Option differentiation",
            "detail": f"The options differ on {len(differs)} dimension(s) "
                      f"({', '.join(differs) or 'none'}); the floor is {min_dimensions}.",
        })
    if score > threshold:
        findings.append({
            "rule": "8", "area": "Distinctness",
            "detail": f"The two briefs score {score:.2f} against a cap of {threshold:.2f}. "
                      "They are variants of one direction, not two.",
        })

    return {
        "verdict": "PASS" if not findings else "FINDINGS",
        "findings": findings,
        "differs_on": differs,
        "dimensions_checked": list(OPTION_DIMENSIONS),
        "similarity": round(score, 3),
        "cap": round(threshold, 3),
        "reason": (
            f"Options A and B differ on {len(differs)} of {len(OPTION_DIMENSIONS)} dimensions "
            f"({', '.join(differs)}) and score {score:.2f} against a cap of {threshold:.2f}."
            if not findings else
            f"{len(findings)} distinctness finding(s): "
            + "; ".join(f["area"] for f in findings) + "."
        ),
    }


def _describe(brief: dict[str, Any]) -> str:
    """The brief as the text rule 8 is scored over."""
    return " ".join(str(brief.get(k, "")) for k in (
        "subject", "visual_type", "composition_label", "focal_subject_label",
        "palette_label", "viewpoint_label",
    ))


def compose_prompt(
    concept: str, topic: str = "", platform: str = "linkedin", placement: str = "auto"
) -> dict[str, Any]:
    """
    The background prompt, for whichever painter is bound.

    It describes an abstract field and nothing else. It never asks for text, a
    logo, a chart with real numbers, or a human face — a model that invents a
    figure has fabricated evidence just as surely as a caption that does.

    The negative prompt carries rule 5's register in full. A painter that has
    never read the skill still needs telling that a glowing brain is not what a
    research lab looks like.
    """
    spec = CONCEPT_BY_ID.get(concept, CONCEPTS[0])
    canvas, _ = resolve_placement(platform, placement)
    forbidden = ", ".join(label.lower() for label, _ in FORBIDDEN_IMAGERY)
    reference_style = _reference_style_clause(spec["id"])

    return {
        "prompt": (
            f"Abstract technical background, {spec['label'].lower()}, deep near-black ground "
            f"with violet accent light, subtle schematic geometry suggesting "
            f"{topic or 'machine learning research'}. Clean, minimal, high signal-to-noise, "
            "generous negative space, restrained engineered composition. "
            "No text, no letters, no numerals, no logos, no charts with readable values, no people. "
            f"Composition leaves the left two-thirds calm for an overlaid headline. {canvas['aspect']}."
            f"{reference_style}"
        ),
        "negative_prompt": (
            "text, letters, words, numbers, logo, watermark, chart labels, faces, hands, "
            f"{forbidden}, stock photography, consumer-cute illustration"
        ),
        "aspect": canvas["aspect"],
        "placement": canvas["id"],
        "concept": spec["id"],
        "visual_type": spec["visual_type"],
        "note": "The brand layer is composited locally over whatever this returns. "
                "The model never draws text.",
    }


# ── Render ────────────────────────────────────────────────────────────────────

def _wrap(headline: str, chars_per_line: int, max_lines: int) -> list[str]:
    """
    Wraps to a character budget.

    There is no text-metrics engine here, so the budget is derived from canvas
    width and font size — approximate but deterministic, which is what matters:
    the same headline must always break the same way.
    """
    lines: list[str] = []
    current = ""
    for word in headline.split():
        candidate = word if not current else f"{current} {word}"
        if len(candidate) > chars_per_line and current:
            lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    return lines


def render_image(
    headline: str,
    kicker: str = "AI RESEARCH",
    concept: str = "gradient-field",
    platform: str = "linkedin",
    background_data_uri: str | None = None,
    fallback_reason: str | None = None,
    placement: str = "auto",
    composition: str = "left-weighted",
    palette_variant: str = "deep",
    viewpoint: str = "head-on",
    clear_space_ratio: float = 1.0,
) -> dict[str, Any]:
    """
    Draws the brand layer as vectors and returns the finished asset.

    This needs no service and cannot fail, which is what makes it the floor: a
    post is never left without a picture because a model was unreachable. When a
    background *was* painted it is composited underneath at reduced opacity, so
    the headline stays legible over anything.

    The composition, palette and viewpoint arguments are what make options A and
    B two pictures rather than two captions for one picture. Every one of them
    changes the geometry that is emitted.
    """
    canvas, placement_reason = resolve_placement(platform, placement)
    comp = COMPOSITIONS.get(composition, COMPOSITIONS["left-weighted"])
    pal = PALETTE_VARIANTS.get(palette_variant, PALETTE_VARIANTS["deep"])
    view = VIEWPOINTS.get(viewpoint, VIEWPOINTS["head-on"])

    width, height = canvas["width"], canvas["height"]
    scale = width / 1200

    pad = round(72 * scale)
    # The type has to fit the canvas it was given. A banner is 396px tall and a
    # story is 1920; sizing from width alone would push four lines of a banner
    # headline clean off the canvas, so the block is fitted to the short axis
    # too and the line budget follows from the space that is actually there.
    headline_size = max(18, round(min((68 if width > height else 76) * scale, height * 0.13)))
    line_height = round(headline_size * 1.18)
    kicker_size = max(11, round(22 * scale))
    footer_size = max(10, round(20 * scale))

    available = height - pad * 2 - round(headline_size * 1.6)
    max_lines = max(1, min(4, int(available / max(1, line_height))))
    chars_per_line = max(8, int((width - pad * 2) / (headline_size * 0.52)))
    lines = _wrap(headline, chars_per_line, max_lines)
    truncated = len(_wrap(headline, chars_per_line, 99)) > len(lines)

    text_x = round(width / 2) if comp["anchor"] == "middle" else pad
    text_width = max((len(line) for line in lines), default=0) * headline_size * 0.52
    text_left = text_x - text_width / 2 if comp["anchor"] == "middle" else text_x
    text_right = text_left + text_width

    mark_r = round(26 * scale)
    mark_cx = width - pad - round(56 * scale)
    mark_cy = pad + round(8 * scale) + mark_r

    block_top = round((height - len(lines) * line_height) / 2 - height * 0.04)

    # The mark's clear space is not ours to spend; where the headline sits is.
    # A long headline centres itself straight through the logomark, so when the
    # two share a column the block drops below the mark instead of riding over
    # it. Only when there is genuinely no room left does the block stay put and
    # the rule 14 finding fire — a check that fires on every ordinary headline
    # is one an operator learns to ignore.
    mark_floor = mark_cy + mark_r + mark_r * clear_space_ratio
    if text_right > mark_cx - mark_r and block_top < mark_floor:
        if mark_floor + len(lines) * line_height <= height - pad:
            block_top = round(mark_floor)

    block_bottom = block_top + len(lines) * line_height

    headline_markup = "".join(
        f'<text x="{text_x}" y="{block_top + i * line_height + headline_size * 0.78:.0f}" '
        f'text-anchor="{comp["anchor"]}" '
        f'font-family="{_DISPLAY_STACK}" font-size="{headline_size}" '
        f'font-weight="600" fill="{INK}" letter-spacing="{-0.012 * headline_size:.2f}">'
        f"{_escape(line)}</text>"
        for i, line in enumerate(lines)
    )

    background = (
        f'<image href="{background_data_uri}" x="0" y="0" width="{width}" height="{height}" '
        'preserveAspectRatio="xMidYMid slice" opacity="0.62"/>'
        if background_data_uri else ""
    )

    # Clear space is measured against what is actually beside the mark. A side
    # with nothing in it is `None` — "nothing is there" and "something is
    # touching it" are different answers, and zero would say the second.
    shares_column = text_right > mark_cx - mark_r
    shares_row = block_top < mark_cy + mark_r and block_bottom > mark_cy - mark_r
    logo = {
        "cx": mark_cx, "cy": mark_cy, "r": mark_r,
        "clear_top": float(mark_cy - mark_r),
        "clear_right": float(width - (mark_cx + mark_r)),
        "clear_bottom": float(block_top - (mark_cy + mark_r)) if shares_column else None,
        "clear_left": float((mark_cx - mark_r) - text_right) if shares_row else None,
        # Drawn as a <circle>, so it cannot be non-uniformly scaled, and filled
        # from the family, so it cannot be recoloured. Rule 14 holds by
        # construction rather than by inspection.
        "distorted": False,
        "recoloured": False,
    }

    geometry = _concept_geometry(concept, width, height, scale, comp["band"], pal, view)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{_escape(headline)}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{pal['lead']}" stop-opacity="{pal['wash']}"/>
      <stop offset="52%" stop-color="{GROUND}" stop-opacity="1"/>
      <stop offset="100%" stop-color="{pal['mid']}" stop-opacity="0.22"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{pal['lead']}"/>
      <stop offset="60%" stop-color="{pal['mid']}"/>
      <stop offset="100%" stop-color="{pal['light']}"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" fill="{GROUND}"/>
  {background}
  <rect width="{width}" height="{height}" fill="url(#ground)"/>
  {geometry}
  <text x="{text_x}" y="{pad + kicker_size}" text-anchor="{comp['anchor']}" font-family="{_BODY_STACK}" font-size="{kicker_size}" font-weight="500" fill="{pal['light']}" letter-spacing="{2.2 * scale:.2f}">{_escape(kicker[:42])}</text>
  {headline_markup}
  <rect x="{round(text_left)}" y="{block_bottom + round(24 * scale)}" width="{round(180 * scale)}" height="{max(3, round(6 * scale))}" rx="{max(2, round(3 * scale))}" fill="url(#bar)"/>
  <circle cx="{mark_cx}" cy="{mark_cy}" r="{mark_r}" fill="{ACCENT}" fill-opacity="0.18" stroke="{ACCENT_LIGHT}" stroke-width="{max(1, round(2 * scale))}"/>
  <text x="{mark_cx}" y="{mark_cy + round(7 * scale)}" text-anchor="middle" font-family="{_DISPLAY_STACK}" font-size="{round(22 * scale)}" font-weight="700" fill="{INK}">E</text>
  <text x="{pad}" y="{height - pad + footer_size / 2:.0f}" font-family="{_BODY_STACK}" font-size="{footer_size}" fill="{INK_MUTED}">ethara.ai</text>
</svg>"""

    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return {
        "asset": {
            "data_uri": f"data:image/svg+xml;base64,{encoded}",
            "canvas": f"{width}x{height}",
            "platform": platform,
            "placement": canvas["id"],
            "placement_label": canvas["label"],
            "aspect_ratio": canvas["aspect"],
            "concept": concept,
            "composition": composition,
            "palette": palette_variant,
            "viewpoint": viewpoint,
            "headline": headline,
            "kicker": kicker,
            "lines": len(lines),
            "headline_truncated": truncated,
            "layers": ["background"] if background_data_uri else [],
            "brand_layer": "local-vector",
            "typography": TYPOGRAPHY,
            # Every colour the brand layer actually emitted, so rule 9 is
            # checked against what was drawn rather than what was intended.
            "palette_used": [pal["lead"], pal["mid"], pal["light"], ACCENT, ACCENT_LIGHT,
                             GROUND, INK, INK_MUTED],
            "logo": logo,
            "bytes": len(svg),
        },
        "background_painted": bool(background_data_uri),
        "fallback_reason": fallback_reason,
        "placement_reason": placement_reason,
    }


def _concept_geometry(
    concept: str,
    width: int,
    height: int,
    scale: float,
    band: tuple[float, float] = (0.62, 1.0),
    palette: dict[str, Any] | None = None,
    viewpoint: dict[str, Any] | None = None,
) -> str:
    """
    The concept's own geometry, drawn as vectors.

    Deliberately abstract: no axis carries a value and no bar is labelled,
    because a chart with invented numbers is fabricated evidence (rule 6). The
    bars in `benchmark-bars` are a *shape*, not a reading — which is why rule 2
    keeps that concept off the table entirely when there is no data behind it.

    `band` is the horizontal strip the geometry lives in, so a change of
    composition moves it rather than merely renaming it. `viewpoint` skews the
    whole group, so oblique is genuinely a different angle.
    """
    pal = palette or PALETTE_VARIANTS["deep"]
    view = viewpoint or VIEWPOINTS["head-on"]
    lead, mid, light = pal["lead"], pal["mid"], pal["light"]

    right = width * band[0]
    span = width * (band[1] - band[0])

    if concept == "signal-lines":
        body = "".join(
            f'<path d="M {right} {height * (0.72 - i * 0.11):.0f} '
            f'q {span * 0.3:.0f} {-height * 0.14:.0f} {span * 0.55:.0f} {-height * 0.06:.0f} '
            f'T {right + span:.0f} {height * (0.5 - i * 0.1):.0f}" fill="none" stroke="{light}" '
            f'stroke-width="{max(1, 2 * scale):.0f}" stroke-opacity="{0.5 - i * 0.12:.2f}"/>'
            for i in range(3)
        )
    elif concept == "reward-surface":
        body = "".join(
            f'<ellipse cx="{right + span * 0.5:.0f}" cy="{height * 0.55:.0f}" '
            f'rx="{span * (0.42 - i * 0.09):.0f}" ry="{height * (0.3 - i * 0.06):.0f}" fill="none" '
            f'stroke="{mid}" stroke-width="{max(1, 1.6 * scale):.0f}" stroke-opacity="{0.45 - i * 0.1:.2f}"/>'
            for i in range(4)
        )
    elif concept == "agent-graph":
        nodes = [(right + span * x, height * y)
                 for x, y in ((0.25, 0.3), (0.7, 0.42), (0.35, 0.68), (0.8, 0.75))]
        body = "".join(
            f'<line x1="{nodes[a][0]:.0f}" y1="{nodes[a][1]:.0f}" x2="{nodes[b][0]:.0f}" '
            f'y2="{nodes[b][1]:.0f}" stroke="{mid}" stroke-width="{max(1, 1.4 * scale):.0f}" stroke-opacity="0.4"/>'
            for a, b in ((0, 1), (0, 2), (1, 3), (2, 3))
        ) + "".join(
            f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{max(3, 9 * scale):.0f}" fill="{light}" fill-opacity="0.65"/>'
            for x, y in nodes
        )
    elif concept == "benchmark-bars":
        body = "".join(
            f'<rect x="{right + span * (0.14 + i * 0.19):.0f}" y="{height * (0.72 - h):.0f}" '
            f'width="{span * 0.11:.0f}" height="{height * h:.0f}" rx="{max(2, 4 * scale):.0f}" '
            f'fill="{mid}" fill-opacity="{0.3 + i * 0.09:.2f}"/>'
            for i, h in enumerate((0.16, 0.24, 0.2, 0.31))
        )
    elif concept == "data-lattice":
        cell = span / 6
        body = "".join(
            f'<circle cx="{right + cell * (c + 0.5):.0f}" cy="{height * 0.28 + cell * r:.0f}" '
            f'r="{max(2, 3.2 * scale):.0f}" fill="{light}" fill-opacity="{0.2 + (r + c) * 0.04:.2f}"/>'
            for r in range(5) for c in range(6)
        )
    else:
        # gradient-field: the ground gradient is the treatment. One soft bloom.
        body = (
            f'<circle cx="{right + span * 0.55:.0f}" cy="{height * 0.45:.0f}" '
            f'r="{min(span, height) * 0.42:.0f}" fill="{lead}" fill-opacity="0.16"/>'
        )

    if not view["skew"]:
        return body

    # Skewed about the band's own centre, so an oblique option stays on canvas
    # instead of sliding off the edge it was skewed toward.
    cx, cy = right + span / 2, height / 2
    return (
        f'<g transform="translate({cx:.0f} {cy:.0f}) skewY({view["skew"]:g}) '
        f'translate({-cx:.0f} {-cy:.0f})">{body}</g>'
    )


# ── Checks ────────────────────────────────────────────────────────────────────

#: Rule 5. The cliché register as patterns rather than prose, so it can be
#: *checked*. Rule 12 says flag off-brand output rather than silently correcting
#: it, so these produce findings and nothing here rewrites a prompt.
FORBIDDEN_IMAGERY: list[tuple[str, tuple[str, ...]]] = [
    ("Glowing brain", ("glowing brain", "brain glow", "neural brain", "luminous brain")),
    ("Humanoid robot", ("humanoid", "android", "robot face", "robotic hand", "cyborg")),
    ("Neon circuit swirl", ("neon circuit", "circuit swirl", "glowing circuit", "circuit board")),
    ("Holographic AI face", ("holographic face", "hologram face", "ai face", "digital face")),
    ("Generic futuristic server", ("server room", "data centre glow", "data center glow",
                                   "futuristic server", "server rack")),
    ("Busy composition", ("busy composition", "cluttered", "densely packed", "maximalist")),
    ("Cheesy metaphor", ("lightbulb moment", "handshake", "jigsaw", "rocket launch",
                         "crystal ball", "chess piece")),
]


def check_forbidden_imagery(*texts: str) -> dict[str, Any]:
    """
    Rule 5, checked rather than hoped for.

    The negative prompt asks a painter to avoid these. This asks whether anyone
    — the concept, the topic, an operator's own instruction — put one back in.
    It reports and never edits, because rule 12 says off-brand output is
    flagged, not silently corrected.
    """
    haystack = " ".join(t.lower() for t in texts if t)
    hits = [
        {"rule": "5", "area": "Forbidden imagery",
         "detail": f"{label} is cliché AI stock imagery and is named in the brief."}
        for label, patterns in FORBIDDEN_IMAGERY
        if any(p in haystack for p in patterns)
    ]
    return {
        "verdict": "PASS" if not hits else "FINDINGS",
        "findings": hits,
        "categories_checked": len(FORBIDDEN_IMAGERY),
        "reason": (
            f"None of the {len(FORBIDDEN_IMAGERY)} cliché categories appear in the brief."
            if not hits else
            f"{len(hits)} cliché categor{'y' if len(hits) == 1 else 'ies'} present."
        ),
    }


def check_palette(asset: dict[str, Any]) -> dict[str, Any]:
    """
    Rule 9: the accents are the Ethara Purple family and nothing else.

    Checked against what the renderer actually emitted rather than what it
    meant to, which is the only version that can catch a regression.
    """
    used = [str(c).upper() for c in asset.get("palette_used", [])]
    family = {c.upper() for c in PURPLE_FAMILY.values()}
    structural = {c.upper() for c in STRUCTURAL.values()}
    stray = sorted({c for c in used if c not in family and c not in structural})

    findings = [
        {"rule": "9", "area": "Palette",
         "detail": f"{c} is neither an Ethara Purple accent nor a declared structural colour."}
        for c in stray
    ]
    return {
        "verdict": "PASS" if not findings else "FINDINGS",
        "findings": findings,
        "accents_used": sorted({c for c in used if c in family}),
        "structural_used": sorted({c for c in used if c in structural}),
        "reason": (
            f"{len(set(used) & family)} accent(s) drawn from the Ethara Purple family; "
            "ground and ink are structural and declared."
            if not findings else
            f"{len(findings)} colour(s) outside the family: " + ", ".join(stray) + "."
        ),
    }


def check_logo_clear_space(asset: dict[str, Any], ratio: float = 1.0) -> dict[str, Any]:
    """
    Rule 14: the mark holds its clear space, or the violation is reported.

    Never shrunk, never cropped, never nudged. A mark that cannot hold its clear
    space is telling you the canvas is wrong for it, and quietly shrinking it
    would hide exactly that.

    A side the mark shares nothing with is `None`, not zero (constraint 2).
    """
    logo = asset.get("logo") or {}
    radius = float(logo.get("r") or 0)
    if not radius:
        return {"verdict": "UNCHECKED", "findings": [], "required": None, "measured": {},
                "not_applicable": [], "reason": "No logomark geometry was recorded, so clear "
                                                "space could not be measured."}

    required = radius * ratio
    sides = {k: logo.get(k) for k in ("clear_top", "clear_right", "clear_bottom", "clear_left")}
    measured = {k: float(v) for k, v in sides.items() if v is not None}

    findings = [
        {"rule": "14", "area": "Logo clear space",
         "detail": f"{k.replace('clear_', '').capitalize()} clear space is {v:.0f}px; the mark "
                   f"needs {required:.0f}px at a ratio of {ratio:g}."}
        for k, v in sorted(measured.items()) if v < required
    ]
    if logo.get("distorted"):
        findings.append({"rule": "14", "area": "Logo", "detail": "The mark was scaled non-uniformly."})
    if logo.get("recoloured"):
        findings.append({"rule": "14", "area": "Logo", "detail": "The mark was recoloured."})

    return {
        "verdict": "PASS" if not findings else "FINDINGS",
        "findings": findings,
        "required": round(required, 1),
        "measured": {k: round(v, 1) for k, v in measured.items()},
        "not_applicable": sorted(k for k, v in sides.items() if v is None),
        "reason": (
            f"The mark holds at least {required:.0f}px on every side it shares an edge with."
            if not findings else
            f"{len(findings)} clear-space finding(s)."
        ),
    }


def write_alt_text(headline: str, concept: str, platform: str = "linkedin", topic: str = "") -> dict[str, Any]:
    """
    Rule 11: every asset ships with alt text, and it describes the **content**,
    not the styling. "Purple gradient card" tells a screen-reader user nothing.
    An asset without alt text cannot be published.
    """
    spec = CONCEPT_BY_ID.get(concept, CONCEPTS[0])
    # The headline already ends in whatever punctuation the caption used; a
    # second full stop reads as a typo to anyone hearing it read aloud.
    stem = headline.rstrip(" .!?,:;")
    text = (
        f"{stem}. An Ethara {platform} card"
        + (f" on {topic}" if topic else "")
        + f", with an abstract {spec['label'].lower()} background."
    )
    return {
        "alt_text": text,
        "describes": "content",
        "length": len(text),
        "reason": f"Alt text states the headline and the subject; the {spec['label'].lower()} treatment is named last, not first.",
    }


def check_visual_compliance(
    asset: dict[str, Any],
    alt_text: str,
    caption_hook: str,
    platform: str = "linkedin",
    placement: str = "auto",
    clear_space_ratio: float = 1.0,
    brief_text: str = "",
) -> dict[str, Any]:
    """
    Every visual rule at once — one round trip should surface all of them.

    Reports; never rewrites (rule 12). An operator who cannot tell what changed
    behind their back cannot trust anything the system produces.
    """
    findings: list[dict[str, str]] = []
    canvas, _ = resolve_placement(platform, placement)
    expected = f"{canvas['width']}x{canvas['height']}"

    if asset.get("canvas") != expected:
        findings.append({"rule": "15", "area": "Canvas",
                         "detail": f"{canvas['label']} is {expected}; this asset is "
                                   f"{asset.get('canvas', 'unset')}."})
    if not alt_text.strip():
        findings.append({"rule": "11", "area": "Alt text",
                         "detail": "No alt text. An asset without alt text cannot be published."})
    if asset.get("brand_layer") != "local-vector":
        findings.append({"rule": "14", "area": "Brand layer",
                         "detail": "The brand layer was not drawn locally. No model may render brand text."})

    # Rule 3: one focal visual system, and it has to be one this renderer knows.
    focal = asset.get("concept")
    if focal and focal not in CONCEPT_BY_ID:
        findings.append({"rule": "3", "area": "Focal system",
                         "detail": f"`{focal}` is not a known focal visual system."})

    # Rule 10: the typefaces are not a choice made per post.
    typography = asset.get("typography") or {}
    if typography and typography != TYPOGRAPHY:
        findings.append({"rule": "10", "area": "Typography",
                         "detail": f"Expected {TYPOGRAPHY['display']} for display and "
                                   f"{TYPOGRAPHY['body']} for body; found {typography}."})

    # Rule 1: the headline must restate the caption's hook, not replace it.
    agreement = visual_similarity(asset.get("headline", ""), caption_hook)
    if caption_hook and agreement < 0.3:
        findings.append({"rule": "1", "area": "Agreement",
                         "detail": f"The headline overlaps the caption hook at {agreement:.2f}. "
                                   "A visual that says something the caption does not is a defect."})

    palette = check_palette(asset)
    logo = check_logo_clear_space(asset, clear_space_ratio)
    forbidden = check_forbidden_imagery(brief_text, asset.get("headline", ""), asset.get("kicker", ""))
    findings.extend(palette["findings"] + logo["findings"] + forbidden["findings"])

    return {
        "verdict": "PASS" if not findings else "FINDINGS",
        "findings": findings,
        "headline_agreement": round(agreement, 2),
        "checked_against": canvas["id"],
        "palette": palette,
        "logo": logo,
        "forbidden_imagery": forbidden,
        "reason": (
            f"All visual rules pass on the {canvas['label']} canvas; the headline overlaps the "
            f"caption hook at {agreement:.2f}."
            if not findings else
            f"{len(findings)} visual finding(s): " + "; ".join(f["area"] for f in findings) + "."
        ),
    }


def check_visual_similarity(concept_text: str, priors: list[str], cap: float = 85) -> dict[str, Any]:
    """
    Similarity against previously shipped concepts. Computed, never estimated.

    The cap is higher than the caption cap for a reason: two posts on the same
    subject *should* look related. What must not repeat is the same picture.
    """
    threshold = cap / 100 if cap > 1 else cap
    scores = [(prior, visual_similarity(concept_text, prior)) for prior in priors]
    highest = max((s for _, s in scores), default=0.0)
    return {
        "highest": round(highest, 3),
        "cap": round(threshold, 3),
        "exceeds": highest >= threshold,
        "compared_against": len(priors),
        "reason": (
            f"Closest prior concept scores {highest:.2f} against a cap of {threshold:.2f} — "
            + ("too close; regenerate on a different treatment."
               if highest >= threshold else "clear.")
            if priors else
            "No prior concepts to compare against. This is the first asset on record."
        ),
    }
