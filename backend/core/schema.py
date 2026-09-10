"""
THE SHARED CONTRACT

Types every agent, tool and workflow speaks. Nothing here has behaviour, and
nothing here carries a number — a threshold in a contract is a threshold nobody
can tune (Constraint 1).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Stage(str, Enum):
    DISCOVER = "discover"
    ASSESS = "assess"
    PLAN = "plan"
    CREATE = "create"
    SHIP = "ship"
    LEARN = "learn"


class Platform(str, Enum):
    LINKEDIN = "linkedin"
    INSTAGRAM = "instagram"
    X = "x"
    FACEBOOK = "facebook"


class Verdict(str, Enum):
    VALIDATED = "validated"
    NEEDS_REVIEW = "needs_review"
    DUPLICATE = "duplicate"
    REJECTED = "rejected"


class Confidence(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class SourceMode(str, Enum):
    LIVE = "live"
    FIXTURE = "fixture"


class Reported(BaseModel, Generic[T]):
    """
    A metric that may legitimately be absent.

    Constraint 2: `N/A` is never `0`. A consumer cannot read `.value` without
    passing through `.reported`, so absence cannot silently become zero.
    """

    reported: bool
    value: T | None = None
    reason: str | None = None

    @classmethod
    def of(cls, value: T) -> "Reported[T]":
        return cls(reported=True, value=value)

    @classmethod
    def missing(cls, reason: str) -> "Reported[T]":
        return cls(reported=False, reason=reason)


class Citation(BaseModel):
    title: str
    url: str
    published_at: str | None = None


class InjectionAttempt(BaseModel):
    """Something in scraped content that read as an instruction. Reported, never followed."""

    item_id: str
    pattern_id: str
    label: str
    excerpt: str


class RawPost(BaseModel):
    """One captured post, whatever platform produced it."""

    external_id: str
    text: str
    url: str
    author_name: str = ""
    author_headline: str = ""
    author_followers: int = 0
    posted_at: str = ""
    reactions: int = 0
    comments: int = 0
    reposts: int = 0
    hashtags: list[str] = Field(default_factory=list)
    keyword: str = ""
    source_name: str = ""
    platform: Platform = Platform.LINKEDIN

    @property
    def engagement(self) -> int:
        """Weighted the way the whole product weights it."""
        return self.reactions + self.comments * 3 + self.reposts * 5


class HashtagCandidate(BaseModel):
    tag: str
    display_tag: str
    keyword: str
    post_count: int = 0
    total_engagement: int = 0
    feed_url: str = ""
    top_post_url: str | None = None
    top_post_title: str | None = None
    #: Share of the posts carrying this tag whose text actually names the
    #: keyword that surfaced them. A tag that travels with our topics scores
    #: high; one that merely appeared alongside them once does not.
    brand_relevance: int = 0
    #: The most recent `posted_at` among the posts carrying the tag. The
    #: Validation Agent turns this into a freshness score against a half-life;
    #: capture only records when it was last seen.
    last_seen_at: str = ""


class ScoredKeyword(BaseModel):
    term: str
    post_count: int
    total_engagement: int
    trend_score: int
    rank: int
    is_trending: bool
    reason: str = Field(description="Names the evidence. 'Low confidence' alone is a defect.")
    search_url: str = ""
    top_post_url: str | None = None


class ScoredHashtag(BaseModel):
    tag: str
    keyword: str
    hashtag_score: int
    rank: int
    verdict: Verdict
    reason: str
    feed_url: str = ""
    top_post_url: str | None = None
    duplicate_of: str | None = None


class ContentIdea(BaseModel):
    title: str
    description: str
    source_topic: str
    hashtag: str
    platform: Platform
    scheduled_date: str
    scheduled_time: str
    confidence: int
    priority_score: int
    calendar_slot: Literal["primary", "suggestion"] = "suggestion"
    platform_rank: int | None = None
    slot_reasons: list[str] = Field(default_factory=list)


class Caption(BaseModel):
    body: str
    hashtags: list[str] = Field(default_factory=list)
    grounded_in: list[str] = Field(
        default_factory=list,
        description="Knowledge entry ids the factual claims rest on. Empty means ungrounded.",
    )
    platform: Platform
    source: SourceMode = SourceMode.FIXTURE
    fallback_reason: str | None = None


class MemoryEntry(BaseModel):
    """One thing the platform has learned. The Knowledge Base is made of these."""

    id: str = ""
    title: str
    category: str
    content: str
    sources: list[Citation] = Field(default_factory=list)
    confidence: Confidence = Confidence.MEDIUM
    evidence_count: int = 1
    active: bool = True
    origin: Literal["brand", "research", "learned", "manual"] = "research"
    created_at: str = Field(default_factory=utcnow)


class AgentResult(BaseModel):
    """What every agent returns. Uniform, so the workflow never special-cases one."""

    agent_id: str
    status: Literal["completed", "failed", "refused"] = "completed"
    payload: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    reason: str = ""
    tool_calls: list[str] = Field(default_factory=list)
    injection_attempts: list[InjectionAttempt] = Field(default_factory=list)
    source: SourceMode = SourceMode.FIXTURE
    fallback_reason: str | None = None
    duration_ms: int = 0
    error: str | None = None
