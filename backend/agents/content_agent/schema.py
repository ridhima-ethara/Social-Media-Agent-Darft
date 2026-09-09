"""Typed input and output for the Content Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import Caption, Platform


class ContentInput(BaseModel):
    title: str
    description: str = ""
    topic: str
    platform: Platform = Platform.LINKEDIN
    published_captions: list[str] = Field(
        default_factory=list, description="Priors for the similarity cap."
    )


class ContentOutput(BaseModel):
    caption: Caption | None = None
    compliance: dict = Field(default_factory=dict, description="verdict · violations · dimensions")
    grounded_in: list[str] = Field(default_factory=list)
    ungrounded: bool = False
    similarity: dict = Field(default_factory=dict)
