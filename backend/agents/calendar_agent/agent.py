"""
THE CALENDAR AGENT

Forms ideas from validated signal, places them with evidence-bearing reasons,
and applies the per-platform slot cap.

Ideas come from what the Scraping Agent captured. *Where and when* they go
comes from the Knowledge Base — what the Learning Agent stored about which
platform this account does well on, and what the audience responded to. That
is the loop: a lesson written after last week's posts changes which platform
gets a slot this week, without anyone editing this file.
"""

from __future__ import annotations

import re
from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from tools import place_ideas, post_ready_dates, rank_ideas

PLATFORM_CYCLE = ["linkedin", "linkedin", "facebook", "linkedin", "instagram", "x"]


class CalendarAgent(Agent):
    agent_id = "calendar_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "plan"
    hands_off_to = ["content_agent"]
    skills = ["calendar-idea-agent"]

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
                # No `ideas` parameter: it places the ideas `prepare` formed
                # from the trending keywords. Offering the model the array
                # invited it to retype them, and what came back was its
                # paraphrase of the evidence rather than the evidence.
                input_schema={"type": "object", "properties": {}},
                handler=lambda: place_ideas(
                    self._ideas, cfg["window_start"], cfg["window_end"], cfg["spacing_hours"],
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
    _knowledge: list[dict[str, Any]] = []
    _preferred: list[str] = []

    #: Entries that can legitimately change where and when a post goes. A
    #: research finding grounds the caption's claim, not the schedule.
    #: `Human Directive` is here for the reason it is on the Content and Image
    #: agents: an operator who told the assistant "favour LinkedIn" was
    #: instructing the plan, and an instruction the planner cannot recall is an
    #: instruction that holds until the next run and is then planned away.
    PLANNING_CATEGORIES = [
        "Platform Preference", "High Performer", "Audience Insight", "Human Directive",
    ]

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        The brain is read first, then ideas are formed and placed — so
        `rank_ideas` has something to rank, and what it ranks already reflects
        what the platform has learned.
        """
        cfg = self.config
        topic = " ".join(k.get("term", "") for k in payload.get("trending", [])[:4])

        self._knowledge = [
            {
                "id": e.id, "title": e.title, "content": e.content,
                "confidence": e.confidence.value,
                # Carried through because the reason text turns on it: `manual`
                # is an instruction, anything else is a measurement.
                "origin": e.origin,
            }
            for e in self.brain.recall(
                f"{topic} posting platform audience", limit=6, categories=self.PLANNING_CATEGORIES
            )
        ]
        self._preferred = self._preferred_platforms(self._knowledge)

        self._ideas = self._form_ideas(payload)
        self._placed = place_ideas(
            self._ideas, cfg["window_start"], cfg["window_end"], cfg["spacing_hours"]
        )["placed_ideas"]

    def _preferred_platforms(self, knowledge: list[dict[str, Any]]) -> list[str]:
        """
        Which platforms the store actually names, in the order it names them.

        Only platforms this account posts to count. An entry that mentions a
        platform we do not publish on tells us nothing about where to publish.
        """
        found: list[str] = []
        for entry in knowledge:
            for platform in PLATFORM_CYCLE:
                if platform not in found and self._names(entry, platform):
                    found.append(platform)
        return found

    def _form_ideas(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """
        One idea per trending signal, deduplicated on the source topic.

        The trending signal decides *what* the idea is about; the Knowledge
        Base decides *where* it goes. When the store has learned nothing about
        platforms yet, the neutral cycle is used and the reason says so.
        """
        ideas: list[dict[str, Any]] = []
        seen: set[str] = set()
        rotation = self._preferred or PLATFORM_CYCLE

        for index, keyword in enumerate(payload.get("trending", [])):
            term = keyword.get("term", "")
            if term in seen:
                continue
            seen.add(term)
            tags = [h for h in payload.get("top_hashtags", []) if h.get("keyword") == term]
            platform = rotation[index % len(rotation)]

            grounding = self._grounding_for(platform, term)
            naming = [k for k in self._knowledge if self._names(k, platform)]
            # Told apart because they are different kinds of thing. A measured
            # entry says this platform performed; an operator directive says to
            # use it. Reporting an instruction as though it were a measurement
            # would make the reason a claim about the audience that nobody ever
            # measured.
            told = [k for k in naming if k.get("origin") == "manual"]
            measured = [k for k in naming if k.get("origin") != "manual"]

            ideas.append({
                "title": f"What the evidence says about {term}",
                "description": keyword.get("reason", ""),
                "source_topic": term,
                "hashtag": (tags[0].get("display_tag") if tags else term.replace(" ", "")),
                "platform": platform,
                "format": "Thought Leadership",
                "confidence": min(95, 60 + keyword.get("trend_score", 0) // 3),
                "brand_relevance": min(98, 70 + keyword.get("trend_score", 0) // 4),
                "trend_score": keyword.get("trend_score", 0),
                "knowledge_grounded_in": [k["id"] for k in grounding],
                "knowledge_titles": [k["title"] for k in grounding],
                "platform_reason": self._platform_reason(platform, told, measured),
            })
        return ideas

    @staticmethod
    def _names(entry: dict[str, Any], needle: str) -> bool:
        """
        Whole-word match. One of our platforms is called `x`, and as a substring
        that occurs inside almost any English text — "experiment", "context",
        "next". Without the boundary, every entry in the store would look like
        it named X, and X would be a preferred platform on every run.
        """
        haystack = f"{entry['title']} {entry['content']}"
        return re.search(rf"\b{re.escape(needle)}\b", haystack, re.I) is not None

    def _platform_reason(
        self, platform: str, told: list[dict[str, Any]], measured: list[dict[str, Any]]
    ) -> str:
        """
        Names which of the two reasons put the idea here, and never blurs them.

        An instruction is stated as an instruction. It is the stronger reason —
        an operator who asked for LinkedIn gets LinkedIn — but it is reported as
        something that was asked for, not something that was observed.
        """
        name = platform.capitalize()
        if not self._preferred:
            return (
                f"{name} — from the neutral rotation. Nothing is stored yet about which "
                "platform this account does best on."
            )
        if told:
            also = (
                f" {len(measured)} measured entr{'y' if len(measured) == 1 else 'ies'} agree."
                if measured else ""
            )
            return (
                f"{name} — a standing instruction in the Knowledge Base asks for it: "
                f"\"{told[0]['title']}\".{also}"
            )
        if measured:
            return (
                f"{name} — named in {len(measured)} stored Knowledge Base "
                f"entr{'y' if len(measured) == 1 else 'ies'} about where this account performs."
            )
        return (
            f"{name} — from the rotation the store's platform preferences set. No entry names "
            "this platform specifically."
        )

    def _grounding_for(self, platform: str, term: str) -> list[dict[str, Any]]:
        """
        The entries behind one idea: those naming its platform, and those
        naming a substantial word from its topic. Short words match everything
        and would make every idea look grounded in everything.
        """
        words = [w for w in term.lower().split() if len(w) > 3]
        return [
            k for k in self._knowledge
            if self._names(k, platform) or any(self._names(k, w) for w in words)
        ]

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"{len(self._ideas)} idea(s) have already been formed from the "
            f"{len(payload.get('trending', []))} trending keywords and are loaded. "
            "Place them on dates and hours with the evidence for each slot, then rank "
            f"them and apply the per-platform cap of {self.config['top_per_platform']}. "
            "`place_ideas` reads the loaded ideas; you do not pass them to it."
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

        # The hand-off to the Content Agent. Deciding what ships next is this
        # agent's job, so naming it is part of this agent's output: the
        # Content Agent reads `title`, `topic`, `description` and `platform`,
        # and nothing was setting them, so it was asked to write a caption for
        # "" on the topic of "" and — correctly — refused.
        #
        # The top-ranked POST-READY topic is the one that ships: today's, or
        # tomorrow's when the posting schedule requires it. A topic on a later
        # date is not written — it waits in the Topic Queue for Generate Post.
        # If nothing post-ready was placed the keys stay absent rather than
        # empty: an agent that reports it has no idea to write about is right,
        # and a blank title dressed up as an idea is the thing that would be wrong.
        ready = set(post_ready_dates())
        chosen = min(
            (
                i for i in output.get("ranked_ideas", [])
                if i.get("calendar_slot") == "primary" and i.get("scheduled_date") in ready
            ),
            key=lambda i: i.get("platform_rank", 99),
            default=None,
        )
        output["post_ready_dates"] = sorted(ready)
        if chosen:
            output["chosen_idea"] = chosen
            for key in ("title", "topic", "description", "platform"):
                if chosen.get(key):
                    output[key] = chosen[key]

        return output

    def summarise(self, result: dict[str, Any]) -> str:
        spread = ", ".join(f"{p} {n}" for p, n in sorted(result.get("per_platform", {}).items())) or "none"
        return (
            f"{result.get('primary_count', 0)} validated topics took a calendar date ({spread}) and "
            f"{result.get('not_placed_count', 0)} ranked below the cap were not placed, "
            f"against a cap of {self.config['top_per_platform']} per platform. "
            "Only today's post (and tomorrow's when the schedule requires it) is written; "
            "later dates hold the topic until Generate Post."
        )
