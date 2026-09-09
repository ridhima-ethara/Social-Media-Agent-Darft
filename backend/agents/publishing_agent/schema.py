"""Typed input and output for the Publishing Agent."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from core.schema import Platform


class Approval(BaseModel):
    by: str
    at: str


class PublishingInput(BaseModel):
    title: str
    caption: str
    platform: Platform = Platform.LINKEDIN
    marketing_approval: Approval | None = None
    leadership_approval: Approval | None = None
    mode: Literal["demo", "live"] = "demo"


class Receipt(BaseModel):
    external_id: str
    platform: Platform
    mode: Literal["demo", "live"]
    published_at: str
    body_length: int
    history: list[dict] = Field(default_factory=list)


class PublishingOutput(BaseModel):
    receipt: Receipt | None = None
    published: bool = False
    refused_because: str | None = None
    format_issues: list[dict] = Field(default_factory=list)
