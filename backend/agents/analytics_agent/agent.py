"""
THE ANALYTICS AGENT

Measures against this account's own trailing baseline, explains what moved,
and writes the lesson back to the brain.

It reads `published_posts`, never `posts`. `posts` is what the Scraping Agent
captured from other people's accounts, and measuring those against "this
account's own baseline" produces a number that is arithmetically fine and
means nothing at all.
"""

from __future__ import annotations

import statistics
from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from core.schema import Citation, MemoryEntry

METRICS = ("reach", "impressions", "likes", "comments", "shares")


def compute_baseline(posts: list[dict[str, Any]], window: int = 4) -> dict[str, Any]:
    """
    The trailing baseline, over this account's own posts.

    A metric that has not been reported is excluded — never counted as zero,
    which would deflate the mean and manufacture a decline that never happened.
    """
    baselines: list[dict[str, Any]] = []
    missing: list[str] = []

    for metric in METRICS:
        values = [p[metric] for p in posts[:window] if p.get(metric) is not None]
        unreported = len(posts[:window]) - len(values)
        if unreported:
            missing.append(f"{metric} ({unreported} of {len(posts[:window])} posts unreported)")
        if not values:
            continue
        baselines.append({
            "metric": metric,
            "mean": round(statistics.fmean(values), 1),
            "stdev": round(statistics.stdev(values), 1) if len(values) > 1 else 0.0,
            "window_used": len(values),
            "unreported": unreported,
        })

    return {
        "baselines": baselines,
        "missing_metrics": missing,
        "sample_note": (
            f"Baseline computed over {min(window, len(posts))} post(s)."
            + (" That is too small a sample to call a trend." if len(posts) < 3 else "")
        ),
    }


def compare_to_baseline(post: dict[str, Any], baselines: list[dict[str, Any]], sigma: float = 1.5) -> dict[str, Any]:
    """Compares one post, skipping metrics it has not reported."""
    comparisons: list[dict[str, Any]] = []
    anomalies: list[dict[str, Any]] = []

    for baseline in baselines:
        metric = baseline["metric"]
        value = post.get(metric)
        if value is None:
            comparisons.append({"metric": metric, "status": "unreported",
                                "note": f"{metric} has not been reported for this post yet."})
            continue

        mean = baseline["mean"]
        delta_pct = ((value - mean) / mean * 100) if mean else 0.0
        deviations = ((value - mean) / baseline["stdev"]) if baseline["stdev"] else 0.0

        row = {
            "metric": metric, "value": value, "baseline": mean,
            "delta_pct": round(delta_pct, 1), "sigma": round(deviations, 2),
            "window_used": baseline["window_used"],
            "note": (
                f"{metric} {value} against a {baseline['window_used']}-post trailing mean of {mean} "
                f"— {delta_pct:+.0f}% ({deviations:+.1f}σ)."
            ),
        }
        comparisons.append(row)
        if abs(deviations) >= sigma:
            anomalies.append(row)

    return {"comparisons": comparisons, "anomalies": anomalies}


class AnalyticsAgent(Agent):
    agent_id = "analytics_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "learn"
    hands_off_to = ["learning_agent"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        posts = payload.get("published_posts", [])
        cfg = self.config

        def write_lesson(title: str, content: str, sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
            action, entry, reason = self.brain.learn(MemoryEntry(
                title=title, category="High Performer", content=content, origin="learned",
                sources=[Citation(**s) for s in (sources or [])],
            ))
            return {"action": action, "reason": reason, "entry_id": entry.id if entry else None}

        return [
            ToolSpec(
                name="compute_baseline",
                description="This account's trailing baseline. Call before any comparison.",
                input_schema={"type": "object", "properties": {"window": {"type": "integer"}}},
                handler=lambda window=cfg["baseline_window"]: compute_baseline(posts, window),
            ),
            ToolSpec(
                name="compare_to_baseline",
                description="Compare one post; missing metrics are skipped, never zeroed.",
                input_schema={"type": "object", "properties": {"post": {"type": "object"}}},
                handler=lambda post=None: compare_to_baseline(
                    post or (posts[0] if posts else {}), self._baselines, cfg["anomaly_sigma"]
                ),
            ),
            ToolSpec(
                name="recall_knowledge",
                description="What the store already knows. Check before writing a lesson.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "limit": {"type": "integer"}},
                },
                handler=lambda topic="post performance", limit=5: {"known": self.recall(topic, limit)},
            ),
            ToolSpec(
                name="write_lesson",
                description="Write a lesson back to the brain. The citation floor is enforced there.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "sources": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["title", "content"],
                },
                handler=write_lesson,
            ),
        ]

    _baselines: list[dict[str, Any]] = []

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Measure {len(payload.get('published_posts', []))} published post(s) against this account's own "
            "trailing baseline, explain what moved and where it concentrated, and write the lesson "
            "back to the Knowledge Base with its evidence."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = self.config
        posts = payload.get("published_posts", [])
        output = dict(reasoning.payload)

        if not output.get("baselines"):
            output.update(compute_baseline(posts, cfg["baseline_window"]))
        self._baselines = output.get("baselines", [])

        if posts and not output.get("comparisons"):
            output.update(compare_to_baseline(posts[0], self._baselines, cfg["anomaly_sigma"]))

        anomalies = output.get("anomalies", [])
        output["recommendation"] = (
            f"{anomalies[0]['metric']} moved {anomalies[0]['delta_pct']:+.0f}% against its "
            f"{anomalies[0]['window_used']}-post baseline. Repeat what this post did differently, "
            "and check whether the movement holds over the next two."
            if anomalies else
            "Nothing moved outside its own trailing band. No change is warranted on this evidence."
        )
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        baselines = result.get("baselines", [])
        anomalies = result.get("anomalies", [])
        missing = result.get("missing_metrics", [])
        tail = f" Unreported: {'; '.join(missing)}." if missing else ""
        return (
            f"Measured {len(baselines)} metric(s) against a "
            f"{baselines[0]['window_used'] if baselines else 0}-post trailing baseline. "
            f"{len(anomalies)} outside their own band. {result.get('recommendation', '')}{tail}"
        )
