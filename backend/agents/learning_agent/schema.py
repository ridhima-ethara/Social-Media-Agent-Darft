"""Typed input and output for the Learning Agent."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from core.schema import Citation, SourceMode


class AssistantMessage(BaseModel):
    """One thing the operator said in the assistant. The human stream's input."""

    id: str = ""
    role: Literal["user", "assistant"] = "user"
    author: str = Field(default="the operator", description="Attribution travels with the directive.")
    text: str = ""
    at: str = ""


class LearningInput(BaseModel):
    assistant_messages: list[AssistantMessage] = Field(
        default_factory=list,
        description="What the operator asked for. Durable instructions become knowledge; one-off requests do not.",
    )
    posts: list[dict] = Field(
        default_factory=list,
        description="Published posts with their metrics. A post reporting nothing is excluded, never zeroed.",
    )
    comparisons: list[dict] = Field(
        default_factory=list, description="The Analytics Agent's comparisons against the trailing baseline."
    )


class Candidate(BaseModel):
    """A proposed memory entry. Nothing here is stored until the brain accepts it."""

    title: str
    category: str
    content: str
    origin: Literal["brand", "research", "learned", "manual"] = "learned"
    sources: list[Citation] = Field(default_factory=list)
    reason: str = Field(default="", description="Why this is durable. Never 'low confidence' alone.")


class WriteOutcome(BaseModel):
    action: Literal["inserted", "merged", "discarded"]
    title: str
    category: str = ""
    entry_id: str | None = None
    reason: str = Field(description="The brain's own verdict, kept verbatim.")


class LearningOutput(BaseModel):
    candidates: list[Candidate] = Field(default_factory=list)
    written: list[WriteOutcome] = Field(default_factory=list)
    stored: list[WriteOutcome] = Field(default_factory=list)
    merged: list[WriteOutcome] = Field(default_factory=list)
    discarded: list[WriteOutcome] = Field(default_factory=list)
    human_stream: dict = Field(default_factory=dict, description="What the operator asked, and what was passed over.")
    outcome_stream: dict = Field(default_factory=dict, description="What the posts showed, and what was withheld.")
    brain_stats: dict = Field(default_factory=dict)
    source: SourceMode = SourceMode.FIXTURE
    fallback_reason: str | None = None
