"""
THE LEARNING AGENT

The assistant the operator actually talks to, and the only agent whose product
is knowledge.

Two streams feed it, and they are different in kind:

    the human    what the operator asked for in the assistant. A directive.
                 The human said it, so it is true of how we want to work — it
                 is definitional, and carries no citation floor.

    the outcome  what the audience did with what we published. A finding, and
                 findings need evidence: the posts they rest on, by permalink,
                 plus the measurement that observed them.

Both end in the same place. `Brain.learn` decides what is stored, merged or
discarded, so the citation floor is applied once no matter which stream a
candidate came from — and what this agent writes today is what the Calendar,
Content and Image agents read tomorrow. That loop is the whole point: the
Knowledge Base is the brain, and this is the agent that grows it.
"""

from __future__ import annotations

from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from core.schema import Citation, MemoryEntry
from tools import consolidate, detect_patterns, distil_requests


class LearningAgent(Agent):
    agent_id = "learning_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "learn"
    hands_off_to = []
    skills = ["knowledge-base"]

    _candidates: list[dict[str, Any]] = []
    _known: list[dict[str, Any]] = []

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        Both streams are read before the loop, so every tool sees the same set.

        The order matters: human directives are distilled first, then outcome
        patterns, then the two are consolidated together. A directive and a
        pattern that say the same thing become one entry carrying both kinds of
        evidence, which is stronger than either alone.
        """
        cfg = self.config
        topic = payload.get("topic") or " ".join(payload.get("keywords", [])[:3])

        self._known = [
            {"id": e.id, "title": e.title, "content": e.content, "category": e.category,
             "confidence": e.confidence.value}
            for e in self.brain.recall(topic or "post performance", limit=8)
        ]

        human = distil_requests(payload.get("assistant_messages", []), cfg["min_request_words"])
        outcomes = detect_patterns(
            payload.get("published_posts", []), payload.get("comparisons", []), cfg["min_evidence_posts"]
        )

        self._candidates = consolidate(
            human["candidates"] + outcomes["candidates"], cfg["consolidation_threshold"]
        )["consolidated"]

        self._human = human
        self._outcomes = outcomes

    _human: dict[str, Any] = {}
    _outcomes: dict[str, Any] = {}

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        cfg = self.config

        def write_knowledge(
            title: str | None = None,
            category: str | None = None,
            content: str | None = None,
            origin: str = "learned",
            sources: list[dict[str, Any]] | None = None,
        ) -> dict[str, Any]:
            """
            The only write path. With no arguments it writes every consolidated
            candidate — which is what the deterministic path does, and what the
            model does when it has nothing to add to them.
            """
            batch = (
                [{"title": title, "category": category or "Audience Insight", "content": content,
                  "origin": origin, "sources": sources or []}]
                if title and content else self._candidates
            )
            return {"written": [self._store(c) for c in batch]}

        def adjust_confidence(entry_id: str, direction: str = "confirm") -> dict[str, Any]:
            """
            The demotion path is not optional: a store that only ever gains
            confidence is a store that cannot be corrected.
            """
            entry = self.brain.adjust_confidence(entry_id, direction)
            if entry is None:
                return {"adjusted": False, "reason": f"No entry {entry_id} is in the store."}
            return {
                "adjusted": True, "entry_id": entry.id, "confidence": entry.confidence.value,
                "reason": (
                    f'"{entry.title}" was {direction}ed and now reads {entry.confidence.value} '
                    f"on {entry.evidence_count} piece(s) of evidence."
                ),
            }

        return [
            ToolSpec(
                name="recall_knowledge",
                description="What the store already knows. Check before writing anything.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "limit": {"type": "integer"}},
                },
                handler=lambda topic="", limit=8: {"known": self._known},
            ),
            ToolSpec(
                name="distil_requests",
                description="Separate the operator's durable instructions from one-off requests.",
                # Reads the operator's actual messages. A model retyping them
                # would be reporting what it remembered the operator asking
                # for, which is how a directive nobody gave becomes durable.
                input_schema={"type": "object", "properties": {}},
                handler=lambda: distil_requests(
                    payload.get("assistant_messages", []), cfg["min_request_words"],
                ),
            ),
            ToolSpec(
                name="detect_patterns",
                description="What the outcomes show, only where enough posts support it.",
                input_schema={
                    "type": "object",
                    "properties": {"min_evidence": {"type": "integer"}},
                },
                handler=lambda min_evidence=cfg["min_evidence_posts"]: detect_patterns(
                    payload.get("published_posts", []), payload.get("comparisons", []), min_evidence
                ),
            ),
            ToolSpec(
                name="consolidate",
                description="Fold near-identical candidates together, keeping both sets of citations.",
                # Folds the candidates `prepare` derived, not a retyped set:
                # a candidate's citations must survive consolidation, and they
                # do not survive a trip through the model.
                input_schema={"type": "object", "properties": {}},
                handler=lambda: consolidate(self._candidates, cfg["consolidation_threshold"]),
            ),
            ToolSpec(
                name="write_knowledge",
                description="Write to the brain. The citation floor is enforced there, not here.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "category": {"type": "string"},
                        "content": {"type": "string"},
                        "origin": {"type": "string"},
                        "sources": {"type": "array", "items": {"type": "object"}},
                    },
                },
                handler=write_knowledge,
            ),
            ToolSpec(
                name="adjust_confidence",
                description="Raise after confirmation, lower after contradiction. Both directions work.",
                input_schema={
                    "type": "object",
                    "properties": {"entry_id": {"type": "string"}, "direction": {"type": "string"}},
                    "required": ["entry_id"],
                },
                handler=adjust_confidence,
            ),
        ]

    def _store(self, candidate: dict[str, Any]) -> dict[str, Any]:
        """One candidate through the brain, with the brain's verdict kept verbatim."""
        action, entry, reason = self.brain.learn(MemoryEntry(
            title=candidate.get("title", ""),
            category=candidate.get("category", "Audience Insight"),
            content=candidate.get("content", ""),
            origin=candidate.get("origin", "learned"),
            sources=[Citation(**s) for s in candidate.get("sources", [])],
        ))
        return {
            "action": action,
            "title": candidate.get("title", ""),
            "category": candidate.get("category", ""),
            "entry_id": entry.id if entry else None,
            "reason": reason,
        }

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Learn from this run: {len(payload.get('assistant_messages', []))} operator message(s) "
            f"and {len(payload.get('published_posts', []))} published post(s) carrying measured "
            "outcomes.\n\n"
            "Check what the store already knows, distil the operator's durable instructions, detect "
            "what the outcomes show, consolidate the two, and write back what survives. Say what you "
            "stored, what merged, and what was discarded and why."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        """The write runs here too, so the deterministic path learns as well."""
        output = dict(reasoning.payload)

        output["human_stream"] = self._human
        output["outcome_stream"] = self._outcomes
        output["candidates"] = self._candidates

        if not output.get("written"):
            output["written"] = [self._store(c) for c in self._candidates]

        written = output.get("written", [])
        output["stored"] = [w for w in written if w["action"] == "inserted"]
        output["merged"] = [w for w in written if w["action"] == "merged"]
        output["discarded"] = [w for w in written if w["action"] == "discarded"]
        output["brain_stats"] = self.brain.stats()
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        stored = len(result.get("stored", []))
        merged = len(result.get("merged", []))
        discarded = result.get("discarded", [])
        human = result.get("human_stream", {})
        outcomes = result.get("outcome_stream", {})
        stats = result.get("brain_stats", {})

        tail = (
            " Discarded: " + "; ".join(d["reason"] for d in discarded)
            if discarded else ""
        )
        return (
            f"Read {human.get('messages_read', 0)} operator message(s) and "
            f"{outcomes.get('posts_measured', 0)} measured post(s). "
            f"Stored {stored}, merged {merged} into existing entries, discarded {len(discarded)}. "
            f"The Knowledge Base now holds {stats.get('active', 0)} active entr"
            f"{'y' if stats.get('active') == 1 else 'ies'}, {stats.get('high_confidence', 0)} at high "
            f"confidence.{tail}"
        )
