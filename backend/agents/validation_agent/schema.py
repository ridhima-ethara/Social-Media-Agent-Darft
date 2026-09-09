"""Typed input and output for the Validation Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import ScoredHashtag, ScoredKeyword


class ValidationInput(BaseModel):
    posts: list[dict] = Field(default_factory=list)
    hashtag_candidates: list[dict] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class ValidationOutput(BaseModel):
    keywords_scored: list[ScoredKeyword] = Field(default_factory=list)
    trending: list[ScoredKeyword] = Field(default_factory=list)
    ranked_hashtags: list[ScoredHashtag] = Field(default_factory=list)
    top_hashtags: list[dict] = Field(default_factory=list)
    buckets: dict[str, int] = Field(
        default_factory=dict, description="validated · needs_review · duplicate · rejected"
    )
    review_queue: list[dict] = Field(
        default_factory=list, description="Every needs_review item, with the decision requested."
    )
    weight_warning: str | None = None
