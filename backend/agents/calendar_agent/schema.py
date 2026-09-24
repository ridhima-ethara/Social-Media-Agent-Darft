"""Typed input and output for the Calendar Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import ContentIdea


class CalendarInput(BaseModel):
    trending: list[dict] = Field(default_factory=list)
    top_hashtags: list[dict] = Field(default_factory=list)


class CalendarOutput(BaseModel):
    ranked_ideas: list[ContentIdea] = Field(default_factory=list)
    primary_count: int = 0
    # Ranked below the cap and therefore not placed. There is no suggestion list.
    not_placed_count: int = 0
    per_platform: dict[str, int] = Field(default_factory=dict)
