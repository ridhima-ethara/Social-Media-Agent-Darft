"""
THE CALENDAR AGENT

Forms ideas from validated signal, places them with evidence-bearing reasons,
and applies the per-platform slot cap.
"""

from __future__ import annotations

from typing import Any

from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from tools import place_ideas, rank_ideas

PLATFORM_CYCLE = ["linkedin", "linkedin", "facebook", "linkedin", "instagram", "x"]


class CalendarAgent(Agent):
    agent_id = "calendar_agent"
    name = "Calendar Agent"
    stage = "plan"
    hands_off_to = ["content_agent"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        cfg = self.config
        return [
            ToolSpec(
                name="recall_knowledge",
                description="What the store has learned about timing and platform preference.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "limit": {"type": "integer"}},
                },
                handler=lambda topic="posting time platform preference", limit=4: {
                    "timing_knowledge": self.recall(topic, limit)
                },
            ),
            ToolSpec(
                name="place_ideas",
                description="Place ideas on dates and hours with evidence-bearing slot reasons.",
                input_schema={"type": "object", "properties": {"ideas": {"type": "array", "items": {"type": "object"}}}},
                handler=lambda ideas=None: place_ideas(
                    ideas if ideas is not None else self._ideas,
                    cfg["window_start"], cfg["window_end"], cfg["spacing_hours"],
                ),
            ),
            ToolSpec(
                name="rank_ideas",
                description="Rank by priority and apply the per-platform slot cap.",
                input_schema={"type": "object", "properties": {"top_per_platform": {"type": "integer"}}},
                handler=lambda top_per_platform=cfg["top_per_platform"]: rank_ideas(
                    self._placed, top_per_platform
                ),
            ),
        ]

    _ideas: list[dict[str, Any]] = []
    _placed: list[dict[str, Any]] = []

    def prepare(self, payload: dict[str, Any]) -> None:
        """Form and place before the loop, so `rank_ideas` has something to rank."""
        cfg = self.config
        self._ideas = self._form_ideas(payload)
        self._placed = place_ideas(
            self._ideas, cfg["window_start"], cfg["window_end"], cfg["spacing_hours"]
        )["placed_ideas"]

    def _form_ideas(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """One idea per trending signal, deduplicated on the source topic."""
        ideas: list[dict[str, Any]] = []
        seen: set[str] = set()

        for index, keyword in enumerate(payload.get("trending", [])):
            term = keyword.get("term", "")
            if term in seen:
                continue
            seen.add(term)
            tags = [h for h in payload.get("top_hashtags", []) if h.get("keyword") == term]
            ideas.append({
                "title": f"What the evidence says about {term}",
                "description": keyword.get("reason", ""),
                "source_topic": term,
                "hashtag": (tags[0].get("display_tag") if tags else term.replace(" ", "")),
                "platform": PLATFORM_CYCLE[index % len(PLATFORM_CYCLE)],
                "format": "Thought Leadership",
                "confidence": min(95, 60 + keyword.get("trend_score", 0) // 3),
                "brand_relevance": min(98, 70 + keyword.get("trend_score", 0) // 4),
                "trend_score": keyword.get("trend_score", 0),
            })
        return ideas

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Form ideas from the {len(payload.get('trending', []))} trending keywords, place each on "
            f"a date and hour with the evidence for that slot, then rank them and apply the "
            f"per-platform cap of {self.config['top_per_platform']}."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = self.config
        output = dict(reasoning.payload)

        if not output.get("placed_ideas"):
            output.update(place_ideas(self._ideas, cfg["window_start"], cfg["window_end"], cfg["spacing_hours"]))
        self._placed = output.get("placed_ideas", self._placed)

        if not output.get("ranked_ideas"):
            output.update(rank_ideas(self._placed, cfg["top_per_platform"]))

        per_platform: dict[str, int] = {}
        for idea in output.get("ranked_ideas", []):
            if idea.get("calendar_slot") == "primary":
                per_platform[idea.get("platform", "linkedin")] = per_platform.get(idea.get("platform", "linkedin"), 0) + 1
        output["per_platform"] = per_platform
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        spread = ", ".join(f"{p} {n}" for p, n in sorted(result.get("per_platform", {}).items())) or "none"
        return (
            f"{result.get('primary_count', 0)} ideas took a calendar slot ({spread}) and "
            f"{result.get('suggestion_count', 0)} went to suggestions with their ranks intact, "
            f"against a cap of {self.config['top_per_platform']} per platform."
        )
