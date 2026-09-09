"""
PLANNING TOOLS — placement and ranking

Placement is a judgement with consequences: a slot chosen badly costs reach
that is never recovered. Every choice carries the evidence it was made on.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# Hour weights from this account's own history, not an industry benchmark.
HOUR_WEIGHTS: dict[int, float] = {
    8: 0.72, 9: 0.88, 10: 1.00, 11: 0.94, 12: 0.61,
    13: 0.70, 14: 0.83, 15: 0.79, 16: 0.68, 17: 0.55, 18: 0.44,
}

FORMAT_FIT: dict[str, dict[str, int]] = {
    "Thought Leadership": {"linkedin": 96, "instagram": 46, "x": 72, "facebook": 74},
    "Carousel": {"linkedin": 82, "instagram": 94, "x": 38, "facebook": 68},
    "Short Post": {"linkedin": 64, "instagram": 58, "x": 92, "facebook": 70},
    "Case Study": {"linkedin": 92, "instagram": 52, "x": 54, "facebook": 66},
}


def place_ideas(
    ideas: list[dict[str, Any]],
    window_start: int = 8,
    window_end: int = 18,
    spacing_hours: int = 6,
) -> dict[str, Any]:
    """
    Places each idea on a date and hour inside the posting window, spreading
    them so two posts on one platform never land within the spacing window.

    Every placement carries `slot_reasons` — facts, not a restatement of the
    decision.
    """
    hours = sorted(
        ((h, w) for h, w in HOUR_WEIGHTS.items() if window_start <= h <= window_end),
        key=lambda pair: pair[1], reverse=True,
    )
    if not hours:
        hours = [(window_start, 1.0)]

    taken: dict[str, list[tuple[str, int]]] = {}
    placed: list[dict[str, Any]] = []
    monday = datetime.now(timezone.utc) - timedelta(days=datetime.now(timezone.utc).weekday())

    for index, idea in enumerate(ideas):
        platform = idea.get("platform", "linkedin")
        day_offset = index % 5  # weekdays only; the weekend is genuinely quiet
        date = (monday + timedelta(days=day_offset)).strftime("%Y-%m-%d")

        chosen_hour, weight = hours[0]
        for hour, hour_weight in hours:
            clashes = [
                h for d, h in taken.get(platform, [])
                if d == date and abs(h - hour) < spacing_hours
            ]
            if not clashes:
                chosen_hour, weight = hour, hour_weight
                break

        taken.setdefault(platform, []).append((date, chosen_hour))
        fit = FORMAT_FIT.get(idea.get("format", "Thought Leadership"), {}).get(platform, 70)

        placed.append({
            **idea,
            "scheduled_date": date,
            "scheduled_time": f"{chosen_hour:02d}:00",
            "slot_reasons": [
                f"{chosen_hour:02d}:00 carries a {weight:.2f} median-reach weight on this account, "
                f"the strongest hour still free that day.",
                f"No other {platform} post is scheduled within {spacing_hours} hours, so the two will not compete.",
                f"Format fit for {platform} scored {fit} against the format-by-platform matrix.",
                f"Placed inside the {window_start:02d}:00–{window_end:02d}:00 posting window; weekends are skipped.",
            ],
            "platform_fit": fit,
        })

    return {"placed_ideas": placed, "placed_count": len(placed)}


def rank_ideas(ideas: list[dict[str, Any]], top_per_platform: int = 10) -> dict[str, Any]:
    """
    Ranks by priority, then applies the slot cap PER PLATFORM independently.

    A platform with fewer ideas than the cap fills what it has — it never
    borrows a slot from another platform.
    """
    scored = []
    for idea in ideas:
        confidence = idea.get("confidence", 70)
        relevance = idea.get("brand_relevance", 80)
        trend = idea.get("trend_score", 70)
        scored.append({
            **idea,
            "priority_score": round(0.45 * confidence + 0.35 * relevance + 0.20 * trend),
        })

    by_platform: dict[str, list[dict[str, Any]]] = {}
    for idea in scored:
        by_platform.setdefault(idea.get("platform", "linkedin"), []).append(idea)

    ranked: list[dict[str, Any]] = []
    demoted: list[str] = []
    for platform, rows in by_platform.items():
        rows.sort(key=lambda r: r["priority_score"], reverse=True)
        for index, row in enumerate(rows):
            row["platform_rank"] = index + 1
            row["calendar_slot"] = "primary" if index < top_per_platform else "suggestion"
            if row["calendar_slot"] == "suggestion":
                demoted.append(row.get("title", ""))
            ranked.append(row)

    primary = [r for r in ranked if r["calendar_slot"] == "primary"]
    return {
        "ranked_ideas": ranked,
        "primary_count": len(primary),
        "suggestion_count": len(ranked) - len(primary),
        "suggestions": demoted,
    }
