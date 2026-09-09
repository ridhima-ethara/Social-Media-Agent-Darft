"""
SOURCE TOOLS — capture, and nothing else

These gather. They do not judge. Nothing here assigns a verdict, scores
relevance, or decides what is trending — that is the Validation Agent's work,
and mixing the two makes both untestable.

Every source returns `RawPost`, whatever platform produced it, so adding a site
is an adapter rather than a branch downstream.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.schema import HashtagCandidate, Platform, RawPost

FIXTURES = Path(__file__).resolve().parent.parent / "data" / "fixtures.json"
TIMEOUT = 20

# Reddit rejects generic agents. This is the format its API documents.
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

def _apify_configured() -> bool:
    return bool(os.environ.get("APIFY_API_TOKEN"))


def _fetch_apify(keyword: str, max_items: int, window_days: int) -> list[RawPost]:
    """
    LinkedIn via Apify. Bearer header, cost cap in the query string — never the
    body, so a misconfigured actor cannot run past the cap.
    """
    actor = os.environ.get("APIFY_LINKEDIN_POSTS_ACTOR", "harvestapi~linkedin-post-search")
    base = os.environ.get("APIFY_BASE_URL", "https://api.apify.com/v2")
    url = f"{base}/actors/{actor}/run-sync-get-dataset-items?maxItems={max_items}"
    body = json.dumps({
        "searchQueries": [keyword],
        "maxPosts": max_items,
        "sortBy": "date",
        "postedLimit": "week" if window_days <= 7 else "month",
    }).encode()
    request = urllib.request.Request(
        url, data=body,
        headers={
            "Authorization": f"Bearer {os.environ['APIFY_API_TOKEN']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
        items = json.loads(response.read().decode("utf-8"))

    posts: list[RawPost] = []
    for item in items if isinstance(items, list) else items.get("items", []):
        text = item.get("content") or item.get("text") or ""
        link = item.get("linkedinUrl") or item.get("url") or ""
        if not text or not link:
            continue
        engagement = item.get("engagement") or {}
        author = item.get("author") or {}
        posts.append(RawPost(
            external_id=str(item.get("id") or link),
            text=text,
            url=link,
            author_name=author.get("name", ""),
            author_headline=author.get("info", ""),
            posted_at=(item.get("postedAt") or {}).get("date", ""),
            reactions=int(engagement.get("likes") or 0),
            comments=int(engagement.get("comments") or 0),
            reposts=int(engagement.get("shares") or 0),
            hashtags=extract_hashtags(text),
            keyword=keyword,
            source_name="LinkedIn · Apify",
            platform=Platform.LINKEDIN,
        ))
    return posts


def _fetch_reddit(keyword: str, max_items: int, window_days: int) -> list[RawPost]:
    """Reddit's public JSON. Keyless and free — no token, no cost."""
    query = urllib.parse.quote(keyword)
    url = f"https://www.reddit.com/search.json?q={query}&sort=top&t=month&limit={max_items}"
    payload = _get_json(url)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).timestamp()

    posts: list[RawPost] = []
    for child in payload.get("data", {}).get("children", []):
        row = child.get("data", {})
        if row.get("created_utc", 0) < cutoff:
            continue
        text = f"{row.get('title', '')}\n\n{row.get('selftext', '')}".strip()
        if not text:
            continue
        posts.append(RawPost(
            external_id=str(row.get("id", "")),
            text=text[:4000],
            url=f"https://reddit.com{row.get('permalink', '')}",
            author_name=row.get("author", ""),
            author_headline=f"r/{row.get('subreddit', '')}",
            posted_at=datetime.fromtimestamp(row.get("created_utc", 0), timezone.utc).isoformat(),
            reactions=int(row.get("ups") or 0),
            comments=int(row.get("num_comments") or 0),
            hashtags=extract_hashtags(text),
            keyword=keyword,
            source_name=f"Reddit · r/{row.get('subreddit', '')}",
        ))
    return posts


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
        text = f"{hit.get('title', '')}\n\n{hit.get('story_text') or ''}".strip()
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


def _fetch_fixtures(keyword: str, max_items: int) -> list[RawPost]:
    """The bundled corpus. A supported configuration, not a stub."""
    if not FIXTURES.exists():
        return []
    rows = json.loads(FIXTURES.read_text(encoding="utf-8"))
    posts = [RawPost(**row) for row in rows]
    matched = [p for p in posts if keyword.lower() in f"{p.text} {p.keyword}".lower()]
    chosen = (matched or posts)[:max_items]
    return [p.model_copy(update={"keyword": keyword}) for p in chosen]


SOURCES = {
    "linkedin": (_fetch_apify, "Apify · LinkedIn", "APIFY_API_TOKEN"),
    "reddit": (_fetch_reddit, "Reddit", ""),
    "hackernews": (_fetch_hackernews, "Hacker News", ""),
}


# ── The tools ──────────────────────────────────────────────────────────────

def available_sources() -> dict[str, Any]:
    """
    Which sources can be read right now, and why the others cannot.

    A source that is unavailable is named with its env key, never silently
    dropped — the operator must be able to see what they are missing.
    """
    rows = []
    for key, (_, label, env_key) in SOURCES.items():
        configured = not env_key or bool(os.environ.get(env_key))
        rows.append({
            "id": key,
            "label": label,
            "configured": configured,
            "reason": "Ready." if configured else f"{env_key} is not set",
            "env_key": env_key,
        })
    live = [r["id"] for r in rows if r["configured"]]
    return {
        "sources": rows,
        "live_sources": live,
        "mode": "live" if live else "fixture",
    }


def fetch_posts(keywords: list[str], max_items: int = 50, window_days: int = 14) -> dict[str, Any]:
    """
    Captures posts for each keyword from every reachable source.

    One source failing never fails the run: it is named in `unreachable`, and
    the rest carry on. A keyword with no live source falls back to the bundled
    corpus with the reason recorded.
    """
    captured: list[dict[str, Any]] = []
    unreachable: list[str] = []
    any_live = False

    for keyword in keywords:
        for key, (fetch, label, env_key) in SOURCES.items():
            if env_key and not os.environ.get(env_key):
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

    if not captured:
        for keyword in keywords:
            captured.extend(p.model_dump() for p in _fetch_fixtures(keyword, max_items))

    return {
        "posts": captured,
        "post_count": len(captured),
        "keywords_scanned": len(keywords),
        "source": "live" if any_live else "fixture",
        "unreachable": unreachable,
        "fallback_reason": None if any_live else "No live source was reachable; the bundled corpus was used.",
    }


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
            })
            bucket["post_count"] += 1
            bucket["total_engagement"] += post.engagement
            if post.engagement > bucket["_top"]:
                bucket["_top"] = post.engagement
                bucket["top_post_url"] = post.url
                bucket["top_post_title"] = post.text.split("\n")[0][:80]

    candidates = []
    for bucket in buckets.values():
        if bucket["post_count"] < min_occurrences:
            continue
        bucket.pop("_top", None)
        bucket["feed_url"] = f"https://www.linkedin.com/feed/hashtag/{bucket['tag']}/"
        candidates.append(HashtagCandidate(**bucket).model_dump())

    candidates.sort(key=lambda c: c["total_engagement"], reverse=True)
    return {
        "hashtag_candidates": candidates,
        "hashtag_count": len(candidates),
        "dropped_generic": dropped_generic,
    }
