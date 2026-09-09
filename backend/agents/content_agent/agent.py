"""
THE CONTENT AGENT

Writes captions grounded in the Knowledge Base, and checks every one against
the twenty rules before returning it.
"""

from __future__ import annotations

from typing import Any

from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from tools import check_brand_voice, derive_hashtags, draft_caption, similarity_check


class ContentAgent(Agent):
    agent_id = "content_agent"
    name = "Content Agent"
    stage = "create"
    hands_off_to = ["publishing_agent"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        topic = payload.get("topic", "")
        platform = payload.get("platform", "linkedin")
        cfg = self.config

        return [
            ToolSpec(
                name="recall_knowledge",
                description="The Knowledge Base read path. Call first, every time.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "limit": {"type": "integer"}},
                },
                handler=lambda topic=topic, limit=6: {"grounding": self.recall(topic, limit)},
            ),
            ToolSpec(
                name="draft_caption",
                description="Write the caption from the brand skeleton at the platform's depth.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "topic": {"type": "string"},
                        "platform": {"type": "string"},
                    },
                },
                handler=lambda title=payload.get("title", ""), description=payload.get("description", ""),
                               topic=topic, platform=platform: draft_caption(
                    title, description, topic, platform, self._grounding,
                    cfg["hook_max_words"], cfg["max_hashtags"],
                ),
            ),
            ToolSpec(
                name="check_brand_voice",
                description="The twenty-rule check. Run on every caption before returning it.",
                input_schema={
                    "type": "object",
                    "properties": {"caption": {"type": "string"}, "topic": {"type": "string"}},
                    "required": ["caption"],
                },
                handler=lambda caption, topic=topic: check_brand_voice(
                    caption, topic, [g["id"] for g in self._grounding]
                ),
            ),
            ToolSpec(
                name="derive_hashtags",
                description="Topic-derived tags. Never reach-bait.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "count": {"type": "integer"}},
                },
                handler=lambda topic=topic, count=cfg["max_hashtags"]: derive_hashtags(topic, count),
            ),
            ToolSpec(
                name="similarity_check",
                description="Similarity against published captions. Computed, never estimated.",
                input_schema={
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
                handler=lambda text: similarity_check(
                    text, payload.get("published_captions", []), cfg["similarity_cap"]
                ),
            ),
        ]

    _grounding: list[dict[str, Any]] = []
    _brand: list[dict[str, Any]] = []

    #: Categories that can carry a factual claim. Brand and compliance entries
    #: govern *how* to write; they are never the evidence a claim rests on.
    EVIDENCE_CATEGORIES = ["Research", "High Performer", "Audience Insight", "Platform Preference"]

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        The brain is read first, always — before any tool closes over it.

        Only evidence-bearing categories are used as factual layers. A brand
        rule in the body of a caption is a rule quoted at the reader, which is
        not what the rule is for.
        """
        topic = payload.get("topic", "")
        self._grounding = [
            {"id": e.id, "title": e.title, "content": e.content, "confidence": e.confidence.value}
            for e in self.brain.recall(topic, limit=6, categories=self.EVIDENCE_CATEGORIES)
        ]
        # Brand rules still travel with the prompt — as constraints, not content.
        self._brand = [
            {"id": e.id, "title": e.title, "content": e.content}
            for e in self.brain.recall(topic, limit=8, categories=["Brand Voice", "Brand Guideline", "Compliance Rule"])
        ]

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Write a {payload.get('platform', 'linkedin')} caption for \"{payload.get('title', '')}\" "
            f"on the topic of {payload.get('topic', '')}.\n\n"
            "Recall what we know first, ground every factual claim in it, then check the result "
            "against the twenty rules before returning it."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = self.config
        topic = payload.get("topic", "")
        output = dict(reasoning.payload)

        output["grounding"] = self._grounding
        output["brand_rules_applied"] = [b["title"] for b in self._brand]

        if not output.get("caption"):
            output.update(draft_caption(
                payload.get("title", ""), payload.get("description", ""), topic,
                payload.get("platform", "linkedin"), self._grounding,
                cfg["hook_max_words"], cfg["max_hashtags"],
            ))

        caption = output.get("caption", {})
        body = caption.get("body", "") if isinstance(caption, dict) else ""

        # Enforcement is unconditional — whatever produced the text.
        output["compliance"] = check_brand_voice(body, topic, [g["id"] for g in self._grounding])
        output["similarity"] = similarity_check(body, payload.get("published_captions", []), cfg["similarity_cap"])
        output["grounded_in"] = [g["id"] for g in self._grounding]
        output["ungrounded"] = not self._grounding
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        compliance = result.get("compliance", {})
        grounded = len(result.get("grounded_in", []))
        similarity = result.get("similarity", {})
        grounding = (
            f"grounded in {grounded} Knowledge Base entr{'y' if grounded == 1 else 'ies'}"
            if grounded else "UNGROUNDED — no Knowledge Base entry matched this topic, so it carries no factual claims"
        )
        return (
            f"Caption written and {grounding}. Brand voice: {compliance.get('verdict', 'unchecked')} — "
            f"{compliance.get('reason', '')} Similarity {similarity.get('highest', 0)} against "
            f"published captions, {'above' if similarity.get('exceeds') else 'below'} the cap."
        )
