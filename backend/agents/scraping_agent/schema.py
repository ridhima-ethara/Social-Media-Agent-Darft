"""Typed input and output for the Scraping Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import HashtagCandidate, RawPost, SourceMode


class ScrapingInput(BaseModel):
    keywords: list[str] = Field(description="The keyword set to scan, in weight order.")


class ScrapingOutput(BaseModel):
    posts: list[RawPost] = Field(default_factory=list)
    hashtag_candidates: list[HashtagCandidate] = Field(default_factory=list)
    post_count: int = 0
    hashtag_count: int = 0
    keywords_scanned: int = 0
    source: SourceMode = SourceMode.FIXTURE
    unreachable: list[str] = Field(default_factory=list, description="Sources that failed, named.")
    fallback_reason: str | None = None
