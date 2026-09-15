"""
THE VALIDATION AGENT

Scores keywords, ranks hashtags, and gives every candidate exactly one verdict
with the evidence behind it.
"""

from __future__ import annotations

from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from tools import consolidate_hashtags, rank_hashtags, route_verdict, score_keywords, similarity_check


class ValidationAgent(Agent):
    agent_id = "validation_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "assess"
    hands_off_to = ["content_agent", "calendar_agent"]
    skills = ["content-validator"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        posts = payload.get("posts", [])
        keywords = payload.get("keywords", [])
        candidates = payload.get("hashtag_candidates", [])
        cfg = self.config

        return [
            ToolSpec(
                name="score_keywords",
                description="Rank keywords on the four-component weighted composite.",
                input_schema={"type": "object", "properties": {"top_keywords": {"type": "integer"}}},
                handler=lambda top_keywords=cfg["top_keywords"]: score_keywords(
                    posts, keywords, top_keywords,
                    cfg["volume_weight"], cfg["engagement_weight"],
                    cfg["velocity_weight"], cfg["growth_weight"],
                ),
            ),
            ToolSpec(
                name="rank_hashtags",
                description="Rank each trending keyword's hashtags.",
                input_schema={
                    "type": "object",
                    "properties": {"trending_terms": {"type": "array", "items": {"type": "string"}}},
                },
                handler=lambda trending_terms=None: rank_hashtags(
                    candidates,
                    trending_terms if trending_terms is not None else self._trending_terms,
                    cfg["top_hashtags_per_keyword"],
                    cfg["freshness_half_life_hours"],
                ),
            ),
            ToolSpec(
                name="similarity_check",
                description="Dice similarity against prior items. Computed, never estimated.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "priors": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["text"],
                },
                handler=lambda text, priors=None: similarity_check(
                    text, priors or [], cfg["similarity_threshold"]
                ),
            ),
            ToolSpec(
                name="route_verdict",
                description="The four-verdict gate. The only way a verdict is produced.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "item": {"type": "object"},
                        "relevance": {"type": "integer"},
                        "duplicate_of": {"type": "string"},
                    },
                    "required": ["item", "relevance"],
                },
                handler=lambda item, relevance, duplicate_of=None: route_verdict(
                    item, relevance, cfg["accept_threshold"], cfg["reject_threshold"], duplicate_of
                ),
            ),
            ToolSpec(
                name="consolidate_hashtags",
                description="Merge and re-rank into the consolidated top set.",
                input_schema={"type": "object", "properties": {"top_hashtags": {"type": "integer"}}},
                handler=lambda top_hashtags=25: consolidate_hashtags(self._ranked, top_hashtags),
            ),
        ]

    _trending_terms: list[str] = []
    _ranked: list[dict[str, Any]] = []

    def prepare(self, payload: dict[str, Any]) -> None:
        """Score first, so `rank_hashtags` sees the trending terms whichever path runs."""
        cfg = self.config
        scored = score_keywords(
            payload.get("posts", []), payload.get("keywords", []), cfg["top_keywords"],
            cfg["volume_weight"], cfg["engagement_weight"], cfg["velocity_weight"], cfg["growth_weight"],
        )
        self._trending_terms = [k["term"] for k in scored.get("trending", [])]

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Score these {len(payload.get('keywords', []))} keywords against "
            f"{len(payload.get('posts', []))} captured posts, rank the hashtags each trending keyword "
            f"surfaced, and give every one of the {len(payload.get('hashtag_candidates', []))} "
            "hashtag candidates exactly one verdict with the evidence behind it."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = self.config
        output = dict(reasoning.payload)

        if not output.get("keywords_scored"):
            output.update(score_keywords(
                payload.get("posts", []), payload.get("keywords", []), cfg["top_keywords"],
                cfg["volume_weight"], cfg["engagement_weight"], cfg["velocity_weight"], cfg["growth_weight"],
            ))

        trending_terms = [k["term"] for k in output.get("trending", [])]
        self._trending_terms = trending_terms

        if not output.get("ranked_hashtags"):
            output.update(rank_hashtags(
                payload.get("hashtag_candidates", []), trending_terms,
                cfg["top_hashtags_per_keyword"], cfg["freshness_half_life_hours"],
            ))
        self._ranked = output.get("ranked_hashtags", [])

        # Every candidate gets exactly one verdict, and the review queue is
        # materialised with the decision requested — never a flag nobody reads.
        buckets = {"validated": 0, "needs_review": 0, "duplicate": 0, "rejected": 0}
        review_queue: list[dict[str, Any]] = []
        seen: list[str] = []

        for row in self._ranked:
            text = f"{row.get('display_tag', '')} {row.get('keyword', '')}"
            duplicate = similarity_check(text, seen, cfg["similarity_threshold"])
            duplicate_of = duplicate["matches"][0]["against"] if duplicate["exceeds"] else None
            seen.append(text)

            verdict = route_verdict(
                row, row.get("hashtag_score", 0),
                cfg["accept_threshold"], cfg["reject_threshold"], duplicate_of,
            )
            row.update(verdict)
            buckets[verdict["verdict"]] = buckets.get(verdict["verdict"], 0) + 1

            if verdict["verdict"] == "needs_review":
                review_queue.append({
                    "tag": row.get("display_tag"),
                    "reason": verdict["reason"],
                    "decision_requested": f"Should #{row.get('display_tag')} be researched with the top set, or dropped?",
                    "options": ["Approve", "Reject"],
                })

        if not output.get("top_hashtags"):
            output.update(consolidate_hashtags(self._ranked, 25))

        output["buckets"] = buckets
        output["review_queue"] = review_queue
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        trending = result.get("trending", [])
        lead = trending[0] if trending else None
        buckets = result.get("buckets", {})
        warning = f" {result['weight_warning']}" if result.get("weight_warning") else ""
        head = (
            f"{len(trending)} keywords are trending. {lead['term']} leads at {lead['trend_score']} — {lead['reason']}"
            if lead else "No keyword cleared the trending threshold this run."
        )
        return (
            f"{head} Verdicts: {buckets.get('validated', 0)} validated, "
            f"{buckets.get('needs_review', 0)} for review, {buckets.get('duplicate', 0)} duplicate, "
            f"{buckets.get('rejected', 0)} rejected.{warning}"
        )
