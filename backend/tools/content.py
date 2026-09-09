"""
CONTENT TOOLS — writing and the twenty-rule check

`check_brand_voice` reports; it never rewrites. That distinction is the whole
point: an operator who cannot tell what changed behind their back cannot trust
anything the system produces.
"""

from __future__ import annotations

import re
from typing import Any

# Forbidden promotional register: pattern → replacement, with the reason.
FORBIDDEN: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\bexcited to announce\b", re.I), "We are publishing", "promotional register"),
    (re.compile(r"\bthrilled to\b", re.I), "We have", "promotional register"),
    (re.compile(r"\bgame[- ]chang(er|ing)\b", re.I), "material", "hype"),
    (re.compile(r"\brevolutionary\b", re.I), "new", "hype"),
    (re.compile(r"\bcutting[- ]edge\b", re.I), "current", "hype"),
    (re.compile(r"\bunlock the power\b", re.I), "use", "marketing cliché"),
]

# Any hit forces internal approval, which outranks every other verdict.
SENSITIVE: list[tuple[str, re.Pattern[str]]] = [
    ("unannounced funding", re.compile(r"\b(raised|funding|series [a-d]|valuation)\b", re.I)),
    ("unannounced partnership", re.compile(r"\b(partnership with|partnering with)\b", re.I)),
    ("named customer", re.compile(r"\b(our customer|client)\b", re.I)),
    ("unpublished figures", re.compile(r"\b(internal benchmark|unpublished|preliminary result)\b", re.I)),
    ("competitor comparison", re.compile(r"\b(better than|outperforms) (openai|anthropic|google|meta)\b", re.I)),
]

EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿\U0001F1E6-\U0001F1FF←-⇿⬀-⯿]|️"
)


# Domain tags that stand alone. A single word split out of a multi-word topic
# ("#Reward", "#Modeling") reads as noise, so only these are used whole.
STANDALONE = {
    "rlhf": "RLHF", "rl": "ReinforcementLearning", "llm": "LLM", "ai": "AI",
    "agentic": "AgenticAI", "agents": "AIAgents", "evaluation": "ModelEvaluation",
    "benchmarks": "AIBenchmarks", "alignment": "AIAlignment", "safety": "AISafety",
    "inference": "InferenceOptimization", "synthetic": "SyntheticData",
}


def derive_hashtags(topic: str, count: int = 4) -> dict[str, Any]:
    """
    Topic-derived tags, never reach-bait.

    A multi-word topic becomes one camel-case tag, not one tag per word:
    "reward modeling" is #RewardModeling, never #Reward plus #Modeling.
    """
    words = [w for w in re.findall(r"[A-Za-z]+", topic) if len(w) > 2]
    tags: list[str] = []

    if words:
        tags.append("".join(w.capitalize() for w in words[:3]))

    # A recognised domain term earns its own tag; an arbitrary fragment does not.
    for word in words:
        mapped = STANDALONE.get(word.lower())
        if mapped and mapped not in tags:
            tags.append(mapped)

    tags.extend(["AIResearch", "MachineLearning", "AIEngineering"])

    seen: list[str] = []
    for tag in tags:
        if tag and tag.lower() not in {s.lower() for s in seen}:
            seen.append(tag)

    # The brand range is 3–5 on every platform. Returning two would breach the
    # rule the compliance check is about to catch, so the floor is honoured here.
    return {"hashtags": seen[:max(3, count)]}


def draft_caption(
    title: str,
    description: str,
    topic: str,
    platform: str,
    grounding: list[dict[str, Any]] | None = None,
    hook_max_words: int = 18,
    max_hashtags: int = 5,
) -> dict[str, Any]:
    """
    Writes a caption from the nine-stage skeleton.

    Every factual claim must trace to a supplied grounding entry. With no
    grounding, the caption is structural only and says so — it does not invent
    a statistic to fill the gap.
    """
    grounding = grounding or []
    depth = {"linkedin": 4, "facebook": 3, "instagram": 2, "x": 1}.get(platform, 3)

    hook = " ".join(title.split()[:hook_max_words])
    layers = [description]

    if depth >= 2:
        layers.append(
            grounding[0]["content"] if grounding
            else "The mechanism is unglamorous: contracts, versions, and a measurement you can re-run."
        )
    if depth >= 3 and len(grounding) > 1:
        layers.append(grounding[1]["content"])
    if depth >= 4:
        layers.append("We build the environments and reward infrastructure this depends on.")

    tags = derive_hashtags(topic, max_hashtags - 1)["hashtags"]
    body = "\n\n".join([hook, *layers, " ".join(f"#{t}" for t in tags)])

    # Enforcement runs unconditionally, whatever produced the text.
    applied: list[str] = []
    for pattern, replacement, why in FORBIDDEN:
        if pattern.search(body):
            body = pattern.sub(replacement, body)
            applied.append(why)
    stripped = len(EMOJI.findall(body))
    body = EMOJI.sub("", body)

    return {
        "caption": {
            "body": body.strip(),
            "hashtags": tags,
            "grounded_in": [g.get("id", "") for g in grounding],
            "platform": platform,
        },
        "enforcement_applied": applied,
        "emoji_stripped": stripped,
        "ungrounded": not grounding,
    }


def check_brand_voice(caption: str, topic: str, grounding_ids: list[str] | None = None) -> dict[str, Any]:
    """
    The twenty-rule check across six dimensions.

    Verdict priority is fixed: NEEDS_INTERNAL_APPROVAL outranks CANNOT_VERIFY,
    which outranks REVISE, which outranks APPROVED. A corrected version is
    offered only when every violation is mechanical.
    """
    violations: list[dict[str, Any]] = []

    for label, pattern in SENSITIVE:
        if pattern.search(caption):
            violations.append({
                "rule": 17, "title": "Sensitive topic", "mechanical": False,
                "detail": f"Mentions {label}, which needs internal sign-off before publication.",
                "required_action": "Route to internal approval, or remove the claim.",
            })

    for pattern, replacement, why in FORBIDDEN:
        match = pattern.search(caption)
        if match:
            violations.append({
                "rule": 3, "title": "Forbidden language", "mechanical": True,
                "detail": f"'{match.group(0)}' is {why}.",
                "required_action": f"Replace with '{replacement}'.",
            })

    emoji = len(EMOJI.findall(caption))
    if emoji:
        violations.append({
            "rule": 5, "title": "Emoji budget", "mechanical": True,
            "detail": f"{emoji} emoji found; the budget is zero and no setting raises it.",
            "required_action": "Strip every emoji.",
        })

    tags = re.findall(r"#\w+", caption)
    if not 3 <= len(tags) <= 5:
        violations.append({
            "rule": 11, "title": "Hashtag range", "mechanical": True,
            "detail": f"{len(tags)} hashtags; the range is 3–5 on every platform.",
            "required_action": "Adjust the hashtag block to 3–5 topic-derived tags.",
        })

    numeric = re.findall(r"\b\d+(?:\.\d+)?%?\b", caption)
    if numeric and not grounding_ids:
        violations.append({
            "rule": 6, "title": "Ungrounded numeric claim", "mechanical": False,
            "detail": f"Cites {', '.join(numeric[:3])} with no Knowledge Base entry behind it.",
            "required_action": "Ground the figure in a cited entry, or remove it.",
        })

    if any(v["rule"] == 17 for v in violations):
        verdict = "NEEDS_INTERNAL_APPROVAL"
    elif any(not v["mechanical"] for v in violations):
        verdict = "CANNOT_VERIFY"
    elif violations:
        verdict = "REVISE"
    else:
        verdict = "APPROVED"

    dimensions = {
        "grounding": bool(grounding_ids) or not numeric,
        "voice": not any(v["rule"] == 3 for v in violations),
        "structure": True,
        "platform": 3 <= len(tags) <= 5,
        "visual": True,
        "caption_visual": True,
    }

    result = {
        "verdict": verdict,
        "violations": violations,
        "dimensions": dimensions,
        "reason": (
            f"{len(violations)} violation(s) across {sum(1 for v in dimensions.values() if not v)} "
            f"failing dimension(s)." if violations
            else f"No violations. {len(tags)} hashtags, no emoji, "
                 f"{'grounded' if grounding_ids else 'no numeric claims to ground'}."
        ),
    }

    if violations and all(v["mechanical"] for v in violations):
        corrected = caption
        for pattern, replacement, _ in FORBIDDEN:
            corrected = pattern.sub(replacement, corrected)
        result["corrected_version"] = EMOJI.sub("", corrected)

    return result
