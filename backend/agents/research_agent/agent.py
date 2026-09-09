"""
THE RESEARCH AGENT

Captures posts and harvests hashtags. Gathers; never judges.

    prompt.md        identity, objective, output contract
    instructions.md  Rules and Boundaries — the specification
    tools.md         what each tool does and must not be used for
    schema.py        the typed input and output
"""

from __future__ import annotations

from typing import Any

from core.agent import Agent
from core.evidence import prepare
from core.llm import Reasoning, ToolSpec
from core.schema import RawPost
from tools import available_sources, fetch_posts, harvest_hashtags


class ResearchAgent(Agent):
    agent_id = "research_agent"
    name = "Research Agent"
    stage = "discover"
    hands_off_to = ["validation_agent"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        keywords = payload.get("keywords", [])[: self.config["max_keywords_per_run"]]
        max_items = self.config["max_items_per_keyword"]
        window = self.config["window_days"]
        floor = self.config["min_occurrences"]

        return [
            ToolSpec(
                name="available_sources",
                description="Which sources are reachable now, and why the others are not.",
                input_schema={"type": "object", "properties": {}},
                handler=available_sources,
            ),
            ToolSpec(
                name="fetch_posts",
                description="Capture posts for each keyword from every reachable source.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "keywords": {"type": "array", "items": {"type": "string"}},
                        "max_items": {"type": "integer"},
                        "window_days": {"type": "integer"},
                    },
                    "required": ["keywords"],
                },
                handler=lambda keywords=keywords, max_items=max_items, window_days=window: fetch_posts(
                    keywords, max_items, window_days
                ),
            ),
            ToolSpec(
                name="harvest_hashtags",
                description="Extract and count hashtags from captured post bodies.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "posts": {"type": "array", "items": {"type": "object"}},
                        "min_occurrences": {"type": "integer"},
                    },
                },
                handler=lambda posts=None, min_occurrences=floor: harvest_hashtags(
                    posts if posts is not None else self._last_posts, min_occurrences
                ),
            ),
        ]

    _last_posts: list[dict[str, Any]] = []

    def task(self, payload: dict[str, Any]) -> str:
        keywords = payload.get("keywords", [])[: self.config["max_keywords_per_run"]]
        return (
            f"Capture what is being discussed about these {len(keywords)} keywords: "
            f"{', '.join(keywords)}.\n\n"
            "Check which sources are reachable, capture posts for every keyword, then harvest the "
            "hashtags those posts used. Report what you captured, from where, and what failed."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        """
        The deterministic path calls tools with no arguments, so the posts are
        fetched here and threaded into the harvest explicitly.
        """
        output = dict(reasoning.payload)

        if not output.get("posts"):
            keywords = payload.get("keywords", [])[: self.config["max_keywords_per_run"]]
            output.update(available_sources())
            output.update(fetch_posts(keywords, self.config["max_items_per_keyword"], self.config["window_days"]))

        if not output.get("hashtag_candidates"):
            output.update(harvest_hashtags(output.get("posts", []), self.config["min_occurrences"]))

        # Constraint 5: nothing reaches a model unwrapped. Scanned at capture.
        posts = [RawPost(**p) if isinstance(p, dict) else p for p in output.get("posts", [])]
        _, attempts = prepare(posts)
        self.note_injection(attempts)

        output["keywords_scanned"] = len(payload.get("keywords", [])[: self.config["max_keywords_per_run"]])
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        sources = ", ".join(result.get("live_sources", [])) or "the bundled corpus"
        unreachable = result.get("unreachable", [])
        tail = f" {len(unreachable)} source(s) were unreachable: {'; '.join(unreachable)}." if unreachable else ""
        return (
            f"Captured {result.get('post_count', 0)} posts across "
            f"{result.get('keywords_scanned', 0)} keywords from {sources}, and harvested "
            f"{result.get('hashtag_count', 0)} hashtag candidates.{tail}"
        )
