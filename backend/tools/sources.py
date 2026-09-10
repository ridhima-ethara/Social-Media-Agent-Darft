"""
SOURCE TOOLS — capture, and nothing else

These gather. They do not judge. Nothing here assigns a verdict, scores
relevance, or decides what is trending — that is the Validation Agent's work,
and mixing the two makes both untestable.

Every source returns `RawPost`, whatever platform produced it, so adding a site
is an adapter rather than a branch downstream.
"""

from __future__ import annotations

import html
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from core.schema import HashtagCandidate, Platform, RawPost

TIMEOUT = 20

# A named agent string. Public APIs reject generic ones.
UA = "python:ethara-socialai:1.0 (by /u/ethara-ai)"

GENERIC = {
    "ai", "tech", "innovation", "future", "digital", "business", "growth",
    "marketing", "startup", "success", "motivation", "leadership", "trending",
    "viral", "follow", "like",
}


def _get_json(url: str, headers: dict[str, str] | None = None) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 — fixed hosts
        return json.loads(response.read().decode("utf-8"))


# ── Sources ────────────────────────────────────────────────────────────────

def _fetch_hackernews(keyword: str, max_items: int, window_days: int) -> list[RawPost]:
    """Hacker News via Algolia. Keyless and free."""
    since = int((datetime.now(timezone.utc) - timedelta(days=window_days)).timestamp())
    url = (
        f"https://hn.algolia.com/api/v1/search?query={urllib.parse.quote(keyword)}"
        f"&tags=story&numericFilters=created_at_i>{since}&hitsPerPage={max_items}"
    )
    payload = _get_json(url)

    posts: list[RawPost] = []
    for hit in payload.get("hits", []):
        text = clean_text(f"{hit.get('title', '')}\n\n{hit.get('story_text') or ''}").strip()
        if not text:
            continue
        posts.append(RawPost(
            external_id=str(hit.get("objectID", "")),
            text=text[:4000],
            url=hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            author_name=hit.get("author", ""),
            author_headline="Hacker News",
            posted_at=hit.get("created_at", ""),
            reactions=int(hit.get("points") or 0),
            comments=int(hit.get("num_comments") or 0),
            hashtags=extract_hashtags(text),
            keyword=keyword,
            source_name="Hacker News",
        ))
    return posts


def _crawl4ai_configured() -> bool:
    """
    crawl4ai needs no key, so presence of the package is the whole test. It is
    checked by import rather than by env var because there is no env var that
    would make an absent package work.
    """
    try:
        import crawl4ai  # noqa: F401
    except ImportError:
        return False
    return True


def _crawl(keyword: str, max_items: int, platform: str | None) -> list[RawPost]:
    """
    One crawl4ai capture, scoped to `platform` or unscoped for the open web.

    Keyless: it searches, then reads the results.

    ON THE ENGAGEMENT FIELDS. A web page has no reaction count. `RawPost`
    defaults the trio to 0 and this function leaves them there rather than
    inventing plausible numbers — `source_name` records that the capture came
    from a website, so nothing downstream reads those zeros as a performance
    reading (constraint 2 — N/A is never 0).

    Recency is not filtered here: a search engine decides its own, and
    pretending to filter on a date the page may not state would be a fabricated
    constraint. That is why `window_days` never reaches this function.
    """
    import asyncio

    from .crawl import crawl_keywords

    pages = int(os.environ.get("CRAWL4AI_MAX_PAGES_PER_KEYWORD", "6"))
    chars = int(os.environ.get("CRAWL4AI_MAX_CHARS_PER_PAGE", "6000"))
    engines = [
        e.strip().lower()
        for e in os.environ.get("CRAWL4AI_SEARCH_ENGINES", "duckduckgo,bing").split(",")
        if e.strip()
    ]

    result = asyncio.run(
        crawl_keywords(
            [keyword],
            engines=engines,
            max_pages=min(max_items, pages),
            max_chars=chars,
            delay_ms=int(os.environ.get("CRAWL4AI_DELAY_MS", "400")),
            platform=platform,
        )
    )

    posts: list[RawPost] = []
    for row in result.get("posts", []):
        posts.append(RawPost(
            external_id=row["externalId"],
            text=clean_text(row["text"]),
            url=row["url"],
            author_name=row.get("authorName") or row.get("siteName", ""),
            author_headline=row.get("siteName", ""),
            # The page's own stated date when it has one, the capture time
            # otherwise — never one dressed as the other.
            posted_at=row.get("publishedAt") or row.get("capturedAt", ""),
            # A crawled page's `#tokens` are URL fragments, not hashtags —
            # see `_hashtags_for_web_page` in `crawl.py`. Whatever the sidecar
            # reported is what is recorded, and nothing is derived from prose.
            hashtags=row.get("hashtags") or [],
            keyword=keyword,
            source_name=f"crawl4ai · {row.get('siteName', 'web')}",
            **({"platform": Platform(platform)} if platform else {}),
        ))
    return posts


def _lane(platform: str | None):
    """Binds one platform lane to the shared `(keyword, max_items, window_days)` signature."""

    def fetch(keyword: str, max_items: int, window_days: int) -> list[RawPost]:
        del window_days  # See `_crawl`: recency is the engine's to decide.
        return _crawl(keyword, max_items, platform)

    return fetch


#: Every lane, in capture order. The four platforms are crawl4ai searches
#: scoped by `site:`; `web` is the same crawler unscoped. Hacker News keeps its
#: own keyless API, which returns real engagement figures that a search-indexed
#: page cannot.
#:
#: REDDIT WAS REMOVED at the operator's instruction. It had been answering
#: `HTTP 403: Blocked` to this crawler, so every run spent a request on it and
#: reported it as unreachable. Hacker News is now the only lane that reports real
#: reaction counts — which matters downstream, because engagement carries the
#: largest single share of the trend score.
SOURCES = {
    "linkedin": (_lane("linkedin"), "crawl4ai · LinkedIn", ""),
    "instagram": (_lane("instagram"), "crawl4ai · Instagram", ""),
    "x": (_lane("x"), "crawl4ai · X", ""),
    "facebook": (_lane("facebook"), "crawl4ai · Facebook", ""),
    "web": (_lane(None), "crawl4ai · open web", ""),
    "hackernews": (_fetch_hackernews, "Hacker News", ""),
}

#: Sources whose availability is not an env var. A keyless source can still be
#: unavailable — crawl4ai needs its package and its browser — and reporting it
#: as ready because no key is missing would be a lie of omission.
PROBES: dict[str, Any] = {
    key: _crawl4ai_configured
    for key in ("linkedin", "instagram", "x", "facebook", "web")
}


def _source_ready(key: str, env_key: str) -> bool:
    if env_key and not os.environ.get(env_key):
        return False
    probe = PROBES.get(key)
    return True if probe is None else bool(probe())


# ── The tools ──────────────────────────────────────────────────────────────

def available_sources() -> dict[str, Any]:
    """
    Which sources can be read right now, and why the others cannot.

    A source that is unavailable is named with its env key, never silently
    dropped — the operator must be able to see what they are missing.
    """
    rows = []
    for key, (_, label, env_key) in SOURCES.items():
        configured = _source_ready(key, env_key)
        if configured:
            reason = "Ready."
        elif env_key:
            reason = f"{env_key} is not set"
        else:
            reason = f"the {key} package is not installed"
        rows.append({
            "id": key,
            "label": label,
            "configured": configured,
            "reason": reason,
            "env_key": env_key,
        })
    live = [r["id"] for r in rows if r["configured"]]
    return {
        "sources": rows,
        "live_sources": live,
        "mode": "live" if live else "none",
    }


def fetch_posts(keywords: list[str], max_items: int = 50, window_days: int = 14) -> dict[str, Any]:
    """
    Captures posts for each keyword from every reachable source.

    One source failing never fails the run: it is named in `unreachable`, and
    the rest carry on. There is nothing behind these sources — no bundled
    corpus — so a keyword no source could answer contributes nothing, and the
    reason says which sources were tried.
    """
    captured: list[dict[str, Any]] = []
    unreachable: list[str] = []
    any_live = False

    for keyword in keywords:
        for key, (fetch, label, env_key) in SOURCES.items():
            if not _source_ready(key, env_key):
                continue
            try:
                posts = fetch(keyword, max_items, window_days)
                if posts:
                    any_live = True
                    captured.extend(p.model_dump() for p in posts)
            except Exception as error:  # noqa: BLE001 — named, never swallowed
                reason = f"{label}: {error}"
                if reason not in unreachable:
                    unreachable.append(reason)

    return {
        "posts": captured,
        "post_count": len(captured),
        "keywords_scanned": len(keywords),
        "source": "live" if any_live else "none",
        "unreachable": unreachable,
        "fallback_reason": None
        if any_live
        else "No source returned anything for these keywords. Nothing was substituted.",
    }


def clean_text(raw: str) -> str:
    """
    Decodes HTML entities once, at capture.

    Kept after Reddit was removed, because the failure it prevents is not
    Reddit-specific: any source that hands back entity-encoded bodies — a JSON
    API or a crawled page — turns `&#x27;` into raw text containing a `#`, and
    every apostrophe in the corpus is then harvested as the hashtag `#x27`,
    which out-ranks real tags on sheer volume. That is how it was found.

    It does not weaken the injection scan. An `&lt;script&gt;` that stayed
    encoded would slip past the scanner as inert prose; decoded, it is seen for
    what it is, reported, and still never followed.
    """
    return html.unescape(raw or "")


def extract_hashtags(text: str) -> list[str]:
    seen: list[str] = []
    for raw in re.findall(r"#[\wÀ-ɏ]+", text or ""):
        tag = raw[1:]
        if tag.lower() not in {t.lower() for t in seen}:
            seen.append(tag)
    return seen


def harvest_hashtags(posts: list[dict[str, Any]], min_occurrences: int = 2) -> dict[str, Any]:
    """
    Extracts tags from post bodies and counts them.

    Generic reach-bait tags are excluded by rule, not by score — high volume
    with no topical signal is exactly what that list exists to catch.
    """
    buckets: dict[str, dict[str, Any]] = {}
    dropped_generic = 0

    for row in posts:
        post = RawPost(**row) if not isinstance(row, RawPost) else row
        for tag in (post.hashtags or extract_hashtags(post.text)):
            key = tag.lower()
            if key in GENERIC:
                dropped_generic += 1
                continue
            bucket = buckets.setdefault(key, {
                "tag": key, "display_tag": tag, "keyword": post.keyword,
                "post_count": 0, "total_engagement": 0,
                "top_post_url": None, "top_post_title": None, "_top": 0,
                "_aligned": 0, "last_seen_at": "",
            })
            bucket["post_count"] += 1
            bucket["total_engagement"] += post.engagement
            # Counting, not judging. Whether the post text actually names the
            # keyword that surfaced it is a fact about the post; turning the
            # count into a score is the Validation Agent's business.
            if post.keyword and post.keyword.lower() in post.text.lower():
                bucket["_aligned"] += 1
            if post.posted_at > bucket["last_seen_at"]:
                bucket["last_seen_at"] = post.posted_at
            if post.engagement > bucket["_top"]:
                bucket["_top"] = post.engagement
                bucket["top_post_url"] = post.url
                bucket["top_post_title"] = post.text.split("\n")[0][:80]

    candidates = []
    for bucket in buckets.values():
        if bucket["post_count"] < min_occurrences:
            continue
        bucket.pop("_top", None)
        aligned = bucket.pop("_aligned", 0)
        bucket["brand_relevance"] = round(100 * aligned / max(1, bucket["post_count"]))
        bucket["feed_url"] = f"https://www.linkedin.com/feed/hashtag/{bucket['tag']}/"
        candidates.append(HashtagCandidate(**bucket).model_dump())

    candidates.sort(key=lambda c: c["total_engagement"], reverse=True)
    return {
        "hashtag_candidates": candidates,
        "hashtag_count": len(candidates),
        "dropped_generic": dropped_generic,
    }
