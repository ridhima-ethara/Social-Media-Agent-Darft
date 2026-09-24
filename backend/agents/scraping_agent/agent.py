"""
THE SCRAPING AGENT

The research end of the pipeline. Given a keyword set, it reads every reachable
source, captures what is genuinely being discussed, and harvests the hashtags
those posts actually used.

There is no separate research agent: research *is* scraping against the
keywords supplied. Gathers; never judges.

    prompt.md        identity, objective, output contract
    instructions.md  Rules and Boundaries — the specification
    tools.md         what each tool does and must not be used for
    schema.py        the typed input and output
"""

from __future__ import annotations

from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.evidence import prepare
from core.llm import Reasoning, ToolSpec
from core.schema import RawPost
from tools import available_sources, fetch_posts, harvest_hashtags


class ScrapingAgent(Agent):
    agent_id = "scraping_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "discover"
    hands_off_to = ["validation_agent"]
    skills = ["content-scraper"]

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        Clears the capture buffer before either path runs.

        It was a class attribute, which made it shared mutable state across
        every instance and — because nothing ever assigned to it — permanently
        empty. Both are fixed by owning it per run, here, where `prepare` is
        guaranteed to have run before any tool closes over it.
        """
        self._captured = []

    def _capture(self, keywords: list[str], max_items: int, window_days: int) -> dict[str, Any]:
        """
        Captures, and keeps what was captured.

        `harvest_hashtags` needs the real post bodies. Handing them back to the
        model so it can pass them to the next tool would mean the evidence
        makes a round trip through a language model, and what returns is what
        the model remembered rather than what the source said — the exact
        fabrication constraint 3 forbids. So the posts stay here.
        """
        result = fetch_posts(keywords, max_items, window_days)
        self._captured = list(result.get("posts", []))
        return result

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        keywords = payload.get("keywords", [])[: self.config["max_keywords_per_run"]]
        max_items = self.config["max_items_per_keyword"]
        window = self.config["window_days"]
        floor = self.config["min_occurrences"]

        return [
            ToolSpec(
                name="available_sources",
                description="Which platforms the Claude Bridge can discover on now, and why any other cannot.",
                input_schema={"type": "object", "properties": {}},
                handler=available_sources,
            ),
            ToolSpec(
                name="fetch_posts",
                description=(
                    "Discover what is trending on LinkedIn, Instagram, Facebook and X through the Claude "
                    "Bridge — one call with the full keyword list. Returns the trends and their posts, newest first."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "keywords": {"type": "array", "items": {"type": "string"}},
                        "max_items": {"type": "integer"},
                        "window_days": {"type": "integer"},
                    },
                    "required": ["keywords"],
                },
                handler=lambda keywords=keywords, max_items=max_items, window_days=window: self._capture(
                    keywords, max_items, window_days
                ),
            ),
            ToolSpec(
                name="harvest_hashtags",
                # The schema takes no posts on purpose: it reads the ones
                # `fetch_posts` actually captured. Advertising a `posts`
                # parameter invited the model to retype the corpus, and it
                # retyped two of a hundred and fourteen, without their urls.
                description=(
                    "Extract and count hashtags from the posts fetch_posts captured. "
                    "Operates on the captured corpus itself — you do not pass the posts."
                ),
                input_schema={
                    "type": "object",
                    "properties": {"min_occurrences": {"type": "integer"}},
                },
                handler=lambda min_occurrences=floor: harvest_hashtags(self._captured, min_occurrences),
            ),
        ]

    def task(self, payload: dict[str, Any]) -> str:
        keywords = payload.get("keywords", [])[: self.config["max_keywords_per_run"]]
        return (
            f"Discover what is trending, relevant to Ethara, for these {len(keywords)} keywords: "
            f"{', '.join(keywords)}.\n\n"
            "Check which platforms the Claude Bridge can reach, run one discovery with the full keyword "
            "list, then harvest the hashtags those posts used. Report the trends and posts per platform, "
            "newest first, and why any platform came back empty."
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
