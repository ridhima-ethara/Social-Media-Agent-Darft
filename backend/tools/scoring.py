"""
SCORING TOOLS — arithmetic, not judgement

Every function here is deterministic and returns its inputs alongside its
output, so a verdict can always be re-derived years later. No model estimates
a score; that would be unreproducible and unauditable.

The model decides which of these to call and when. These decide what the
answer is.
"""

from __future__ import annotations

import math
from typing import Any

from core.brain import similarity

# Semantic aliases string distance cannot see: #RL and #ReinforcementLearning
# share almost no characters but mean the same thing.
ALIASES: list[set[str]] = [
    {"rl", "reinforcementlearning", "deeprl"},
    {"genai", "generativeai"},
    {"llm", "llms", "largelanguagemodels"},
    {"rlhf", "humanfeedback", "preferencelearning"},
    {"ml", "machinelearning"},
    {"ai", "artificialintelligence"},
    {"agenticai", "aiagents", "agents"},
    {"posttraining", "finetuning", "llmfinetuning"},
]


def _normalise(value: float, ceiling: float) -> float:
    return 0.0 if ceiling <= 0 else min(100.0, (value / ceiling) * 100.0)


def _is_alias(a: str, b: str) -> bool:
    left = "".join(ch for ch in a.lower() if ch.isalnum())
    right = "".join(ch for ch in b.lower() if ch.isalnum())
    if left == right:
        return True
    return any(left in group and right in group for group in ALIASES)


def score_keywords(
    posts: list[dict[str, Any]],
    keywords: list[str],
    top_keywords: int = 5,
    volume_weight: float = 25,
    engagement_weight: float = 35,
    velocity_weight: float = 20,
    growth_weight: float = 20,
) -> dict[str, Any]:
    """
    Ranks keywords on a weighted composite of four declared components.

    The four components are returned separately as well as combined — the
    composite is a convenience for sorting, never a replacement for the
    evidence behind it.
    """
    total_weight = volume_weight + engagement_weight + velocity_weight + growth_weight
    warning = None
    if abs(total_weight - 100.0) > 0.01:
        warning = (
            f"Weights sum to {total_weight:g}, not 100. Scores are reported against the "
            "declared weights and are NOT rescaled — fix the settings."
        )

    aggregates: list[dict[str, Any]] = []
    for term in keywords:
        own = [p for p in posts if term.lower() in f"{p.get('keyword','')} {p.get('text','')}".lower()]
        engagement = sum(
            p.get("reactions", 0) + p.get("comments", 0) * 3 + p.get("reposts", 0) * 5 for p in own
        )
        aggregates.append({
            "term": term,
            "post_count": len(own),
            "total_engagement": engagement,
            "velocity": round(engagement / max(1, len(own)), 2),
            "top_post": max(own, key=lambda p: p.get("reactions", 0), default=None),
        })

    max_posts = max((a["post_count"] for a in aggregates), default=0)
    max_engagement = max((a["total_engagement"] for a in aggregates), default=0)
    max_velocity = max((a["velocity"] for a in aggregates), default=0)

    scored: list[dict[str, Any]] = []
    for agg in aggregates:
        volume = _normalise(agg["post_count"], max_posts)
        engage = _normalise(agg["total_engagement"], max_engagement)
        velocity = _normalise(agg["velocity"], max_velocity)
        # No prior runs in this process, so growth contributes its neutral
        # midpoint and the reason says so rather than implying stability.
        growth = 50.0
        composite = (
            volume * volume_weight + engage * engagement_weight
            + velocity * velocity_weight + growth * growth_weight
        ) / max(total_weight, 1)

        top = agg.pop("top_post", None)
        scored.append({
            **agg,
            "components": {
                "volume": round(volume), "engagement": round(engage),
                "velocity": round(velocity), "growth": round(growth),
            },
            "trend_score": max(0, min(100, round(composite))),
            "search_url": f"https://www.linkedin.com/search/results/content/?keywords={agg['term'].replace(' ', '%20')}",
            "top_post_url": (top or {}).get("url"),
        })

    scored.sort(key=lambda s: (s["trend_score"], s["total_engagement"]), reverse=True)

    for index, row in enumerate(scored):
        row["rank"] = index + 1
        row["is_trending"] = index < top_keywords and row["post_count"] > 0
        components = row["components"]
        row["reason"] = (
            f"{row['post_count']} posts carrying {row['total_engagement']} engagement "
            f"({components['engagement']}/100 against the strongest keyword this run, "
            f"{components['volume']}/100 on volume). Growth could not be computed — "
            "there are no prior runs in this batch to compare against."
        )

    return {
        "keywords_scored": scored,
        "trending": [s for s in scored if s["is_trending"]],
        "weight_warning": warning,
    }


def rank_hashtags(
    candidates: list[dict[str, Any]],
    trending_terms: list[str],
    top_per_keyword: int = 5,
) -> dict[str, Any]:
    """Ranks each trending keyword's hashtags on engagement per post and volume."""
    max_engagement = max((c.get("total_engagement", 0) for c in candidates), default=0)
    max_posts = max((c.get("post_count", 0) for c in candidates), default=0)

    ranked: list[dict[str, Any]] = []
    for term in trending_terms:
        own = [c for c in candidates if c.get("keyword", "").lower() == term.lower()] or candidates
        rows = []
        for candidate in own:
            per_post = candidate.get("total_engagement", 0) / max(1, candidate.get("post_count", 1))
            score = round(
                0.6 * _normalise(candidate.get("total_engagement", 0), max_engagement)
                + 0.4 * _normalise(candidate.get("post_count", 0), max_posts)
            )
            rows.append({
                **candidate,
                "keyword": term,
                "engagement_per_post": round(per_post, 1),
                "hashtag_score": score,
            })
        rows.sort(key=lambda r: r["hashtag_score"], reverse=True)
        for index, row in enumerate(rows[:top_per_keyword]):
            row["rank"] = index + 1
            ranked.append(row)

    return {"ranked_hashtags": ranked, "ranked_count": len(ranked)}


def similarity_check(text: str, priors: list[str], threshold: float = 62) -> dict[str, Any]:
    """
    Dice similarity against prior items. Computed, never estimated by a model
    — the same pair always scores identically, which is what lets a past
    verdict be re-derived.
    """
    scores = sorted(
        ({"against": prior[:80], "score": round(similarity(text, prior) * 100)} for prior in priors),
        key=lambda row: row["score"], reverse=True,
    )
    highest = scores[0]["score"] if scores else 0
    return {
        "highest": highest,
        "exceeds": highest >= threshold,
        "matches": scores[:3],
        "reason": (
            f"Scores {highest} against {len(priors)} prior item(s), "
            f"{'at or above' if highest >= threshold else 'below'} the {threshold:g} threshold."
        ),
    }


def route_verdict(
    item: dict[str, Any],
    relevance: int,
    accept_threshold: int = 70,
    reject_threshold: int = 40,
    duplicate_of: str | None = None,
) -> dict[str, Any]:
    """
    The four-verdict gate, in strict priority order.

    Every branch names the number it fell against and what would change it —
    "low confidence" alone is a defect.
    """
    if duplicate_of:
        return {
            "verdict": "duplicate",
            "duplicate_of": duplicate_of,
            "reason": f"Near-identical to '{duplicate_of[:60]}'. Linked to the original rather than dropped.",
        }
    if relevance < reject_threshold:
        return {
            "verdict": "rejected",
            "reason": f"Relevance {relevance}, below the {reject_threshold} reject threshold. "
                      "It would need to match the brand topic vocabulary far more closely to be carried forward.",
        }
    if relevance < accept_threshold:
        return {
            "verdict": "needs_review",
            "reason": f"Relevance {relevance}, between the {reject_threshold} reject and "
                      f"{accept_threshold} accept thresholds. A human decides this one.",
        }
    return {
        "verdict": "validated",
        "reason": f"Relevance {relevance}, at or above the {accept_threshold} accept threshold.",
    }


def consolidate_hashtags(ranked: list[dict[str, Any]], top_hashtags: int = 25) -> dict[str, Any]:
    """
    Merges per-keyword hashtag sets, de-duplicates across keywords including
    semantic aliases, and re-ranks globally into the consolidated top set.
    """
    merged: dict[str, dict[str, Any]] = {}
    alias_links: list[dict[str, str]] = []

    for row in sorted(ranked, key=lambda r: r.get("hashtag_score", 0), reverse=True):
        tag = row.get("tag", "")
        existing = next((k for k in merged if _is_alias(k, tag)), None)
        if existing:
            merged[existing]["post_count"] += row.get("post_count", 0)
            merged[existing]["total_engagement"] += row.get("total_engagement", 0)
            if existing != tag:
                alias_links.append({"tag": tag, "merged_into": existing})
            continue
        merged[tag] = dict(row)

    consolidated = sorted(merged.values(), key=lambda r: r.get("hashtag_score", 0), reverse=True)[:top_hashtags]
    for index, row in enumerate(consolidated):
        row["rank"] = index + 1
        row["in_top_set"] = True

    return {
        "top_hashtags": consolidated,
        "top_count": len(consolidated),
        "alias_merges": alias_links,
    }
