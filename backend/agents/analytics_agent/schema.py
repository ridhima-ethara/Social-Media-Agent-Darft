"""Typed input and output for the Analytics Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import Reported


class AnalyticsInput(BaseModel):
    posts: list[dict] = Field(default_factory=list, description="Published posts with their readings.")


class Baseline(BaseModel):
    metric: str
    mean: float
    stdev: float
    window_used: int = Field(description="The actual sample size, which may be smaller than requested.")
    unreported: int = 0


class AnalyticsOutput(BaseModel):
    baselines: list[Baseline] = Field(default_factory=list)
    comparisons: list[dict] = Field(default_factory=list)
    anomalies: list[dict] = Field(default_factory=list)
    recommendation: str = ""
    lesson_written: dict | None = None
    missing_metrics: list[str] = Field(default_factory=list)
