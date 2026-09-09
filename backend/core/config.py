"""
THE CONFIG REGISTRY

Constraint 1: every number comes from here. No literal threshold, weight or
limit in a prompt, an instructions file, or an agent body.

Every field carries a plain-language description, because that description is
what the operator reads in Agent Studio. A field without one is invalid.
"""

from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel, Field


class Knob(BaseModel):
    key: str
    label: str
    default: Any
    description: str = Field(description="Rendered directly to the operator.")
    minimum: float | None = None
    maximum: float | None = None
    unit: str | None = None


REGISTRY: dict[str, list[Knob]] = {
    "research_agent": [
        Knob(key="max_keywords_per_run", label="Keywords per run", default=12, minimum=1, maximum=20,
             description="How many keywords a single run scans, taken in descending weight order."),
        Knob(key="max_items_per_keyword", label="Items per keyword", default=50, minimum=5, maximum=200,
             description="Ceiling on posts captured per keyword per source. Caps cost as well as noise."),
        Knob(key="min_occurrences", label="Hashtag floor", default=2, minimum=1, maximum=10,
             description="A tag seen fewer times than this in a run is noise, not signal."),
        Knob(key="window_days", label="Recency window", default=14, minimum=1, maximum=90, unit="days",
             description="How far back a source is read. Older posts are excluded, not down-weighted."),
    ],
    "validation_agent": [
        Knob(key="top_keywords", label="Top keywords", default=5, minimum=1, maximum=20,
             description="How many keywords are marked trending and carried into hashtag ranking."),
        Knob(key="top_hashtags_per_keyword", label="Hashtags per keyword", default=5, minimum=1, maximum=15,
             description="How many hashtags each trending keyword contributes before consolidation."),
        Knob(key="volume_weight", label="Volume weight", default=25, minimum=0, maximum=100, unit="%",
             description="Share of the trend score from post count. The four weights must sum to 100."),
        Knob(key="engagement_weight", label="Engagement weight", default=35, minimum=0, maximum=100, unit="%",
             description="Share of the trend score from total engagement."),
        Knob(key="velocity_weight", label="Velocity weight", default=20, minimum=0, maximum=100, unit="%",
             description="Share of the trend score from engagement per hour since posting."),
        Knob(key="growth_weight", label="Growth weight", default=20, minimum=0, maximum=100, unit="%",
             description="Share of the trend score from movement against this account's own prior runs."),
        Knob(key="accept_threshold", label="Accept threshold", default=70, minimum=0, maximum=100, unit="%",
             description="At or above this relevance a candidate is validated without a human."),
        Knob(key="reject_threshold", label="Reject threshold", default=40, minimum=0, maximum=100, unit="%",
             description="Below this relevance a candidate is rejected. Between the two, a human decides."),
        Knob(key="similarity_threshold", label="Duplicate threshold", default=62, minimum=0, maximum=100, unit="%",
             description="Dice similarity at or above which two candidates are the same story."),
    ],
    "content_agent": [
        Knob(key="hook_max_words", label="Hook length", default=18, minimum=6, maximum=40, unit="words",
             description="The opening line's budget. Longer hooks lose the reader before the claim lands."),
        Knob(key="min_hashtags", label="Minimum hashtags", default=3, minimum=1, maximum=10,
             description="Fewer than this and the post is under-indexed on every platform."),
        Knob(key="max_hashtags", label="Maximum hashtags", default=5, minimum=1, maximum=10,
             description="More than this reads as reach-bait to a research audience. No knob may raise the emoji budget above zero."),
        Knob(key="similarity_cap", label="Similarity cap", default=70, minimum=0, maximum=100, unit="%",
             description="Above this similarity to a published caption, the draft is regenerated on a different angle."),
    ],
    "calendar_agent": [
        Knob(key="top_per_platform", label="Calendar slots per platform", default=10, minimum=1, maximum=30,
             description="How many ideas take a calendar slot per platform. The rest go to More suggestions with their rank."),
        Knob(key="spacing_hours", label="Minimum spacing", default=6, minimum=1, maximum=48, unit="hours",
             description="Two posts on one platform inside this window split reach rather than compounding it."),
        Knob(key="window_start", label="Posting window opens", default=8, minimum=0, maximum=23, unit="h",
             description="Earliest hour a post may be placed, in the workspace timezone."),
        Knob(key="window_end", label="Posting window closes", default=18, minimum=0, maximum=23, unit="h",
             description="Latest hour a post may be placed."),
    ],
    "publishing_agent": [
        Knob(key="require_two_approvals", label="Two-stage approval", default=True,
             description="Marketing then Leadership. This gate has no off switch; the control is shown for honesty."),
    ],
    "analytics_agent": [
        Knob(key="baseline_window", label="Baseline window", default=4, minimum=2, maximum=26, unit="posts",
             description="How many prior posts form the trailing baseline every comparison is made against."),
        Knob(key="anomaly_sigma", label="Anomaly threshold", default=1.5, minimum=0.5, maximum=4.0, unit="σ",
             description="How far outside its own trailing band a metric must move before it is called an anomaly."),
    ],
}


class Config:
    """
    Resolved settings for one agent. `defaults < environment < run overrides`.

    A value that fails validation does not silently become the default: the
    default is used *and* the rejection is recorded, so a typo surfaces.
    """

    def __init__(self, agent_id: str, overrides: dict[str, Any] | None = None) -> None:
        self.agent_id = agent_id
        self.rejected: list[str] = []
        self._knobs = {k.key: k for k in REGISTRY.get(agent_id, [])}
        self._values: dict[str, Any] = {k.key: k.default for k in self._knobs.values()}

        for key, knob in self._knobs.items():
            env_key = f"{agent_id.upper()}_{key.upper()}"
            if env_key in os.environ:
                self._set(key, os.environ[env_key])
        for key, value in (overrides or {}).items():
            self._set(key, value)

    def _set(self, key: str, raw: Any) -> None:
        knob = self._knobs.get(key)
        if knob is None:
            self.rejected.append(f"{key}: not a declared setting for {self.agent_id}")
            return
        try:
            value = type(knob.default)(raw) if not isinstance(knob.default, bool) else str(raw).lower() in ("1", "true", "yes", "on")
        except (TypeError, ValueError):
            self.rejected.append(f"{key}: {raw!r} is not a {type(knob.default).__name__}")
            return
        if knob.minimum is not None and value < knob.minimum:
            self.rejected.append(f"{key}: {value} is below {knob.minimum}")
            return
        if knob.maximum is not None and value > knob.maximum:
            self.rejected.append(f"{key}: {value} is above {knob.maximum}")
            return
        self._values[key] = value

    def __getitem__(self, key: str) -> Any:
        if key not in self._values:
            raise KeyError(f"{self.agent_id} has no declared setting '{key}'. Declare it in core/config.py first.")
        return self._values[key]

    def get(self, key: str, fallback: Any = None) -> Any:
        return self._values.get(key, fallback)

    def used(self) -> dict[str, Any]:
        """The fully resolved config, recorded on every run so it stays replayable."""
        return dict(self._values)

    def check_weights(self, keys: list[str]) -> str | None:
        """
        Weights that must sum to 100. A set that does not is a reported error,
        never silently rescaled — rescaling makes intent and behaviour diverge.
        """
        total = sum(float(self._values[k]) for k in keys)
        if abs(total - 100.0) < 0.01:
            return None
        return f"{' + '.join(keys)} sum to {total:g}, not 100. Adjust them — they will not be rescaled for you."
