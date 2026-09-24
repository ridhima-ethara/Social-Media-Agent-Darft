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
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.schema import HashtagCandidate, Platform, RawPost

GENERIC = {
    "ai", "tech", "innovation", "future", "digital", "business", "growth",
    "marketing", "startup", "success", "motivation", "leadership", "trending",
    "viral", "follow", "like",
}


# ── Sources: platform-level trend discovery through the Claude Bridge ─────
#
# Capture is ONE call to the Claude Bridge (server/src/bridges/claude-bridge/,
# ADR-013/014) — the same platform-level discovery the Node tier's Scraping
# Agent runs: for each of LinkedIn, Instagram, Facebook and X, one quoted topic
# per search (the current month named), built from the Knowledge Base, research
# corpus, brand context and keywords;
# only posts whose date is verifiable inside the window and that mention an
# Ethara keyword are kept; newest first. No other scraping service is used.
#
# What a row states: a real post URL, a verified date (decoded from the post
# id), the text the search result showed, the hashtags written in it, and the
# author handle the URL carries. It states no engagement, so the counts stay at
# the RawPost default of 0 — "not stated", never "performed badly".

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_CLI = REPO_ROOT / "server" / "src" / "bridges" / "claude-bridge" / "cli.ts"
TSX = REPO_ROOT / "node_modules" / ".bin" / "tsx"

#: One discovery drives a Claude Code session per platform, all at once.
BRIDGE_TIMEOUT = int(os.environ.get("CLAUDE_BRIDGE_TIMEOUT_S", "600"))

LANES: dict[str, str] = {
    "linkedin": "LinkedIn",
    "instagram": "Instagram",
    "facebook": "Facebook",
    "x": "X",
}


def _run_bridge(args: list[str]) -> dict[str, Any]:
    """Runs the bridge CLI and returns its JSON. Raises with the bridge's own reason."""
    if not TSX.exists():
        raise RuntimeError(f"tsx is not installed at {TSX} — run `npm install` in the repository root")
    proc = subprocess.run(  # noqa: S603 — fixed executable, arguments are data
        [str(TSX), str(BRIDGE_CLI), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=BRIDGE_TIMEOUT,
        check=False,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as error:
        tail = (proc.stderr or proc.stdout or "").strip()[-300:]
        raise RuntimeError(f"the Claude Bridge returned no JSON (exit {proc.returncode}): {tail}") from error


_lane_cache: dict[str, str] | None = None


def _lane_reasons() -> dict[str, str]:
    """lane → "" when it can run, else the reason. Asked once per process; makes no search."""
    global _lane_cache  # noqa: PLW0603 — a per-process memo of a config check
    if _lane_cache is None:
        try:
            _lane_cache = {k: str(v) for k, v in _run_bridge(["--lanes"]).items()}
        except Exception as error:  # noqa: BLE001 — reported as every lane's reason
            _lane_cache = {lane: f"the Claude Bridge could not be reached: {error}" for lane in LANES}
    return _lane_cache


# ── The tools ──────────────────────────────────────────────────────────────

def available_sources() -> dict[str, Any]:
    """
    Which platforms discovery can read right now, and why the others cannot.

    A platform that is unavailable is named with its reason, never silently
    dropped — the operator must be able to see what they are missing.
    """
    reasons = _lane_reasons()
    rows = []
    for key, label in LANES.items():
        reason = reasons.get(key, "unknown lane")
        rows.append({
            "id": key,
            "label": f"Claude Bridge · {label}",
            "configured": reason == "",
            "reason": "Ready." if reason == "" else reason,
            "env_key": "",
        })
    live = [r["id"] for r in rows if r["configured"]]
    return {
        "sources": rows,
        "live_sources": live,
        "mode": "live" if live else "none",
    }


def fetch_posts(keywords: list[str], max_items: int = 50, window_days: int = 0) -> dict[str, Any]:
    """
    Discovers what is trending on each platform for these keywords.

    `max_items` is kept for the tool's signature; the bridge caps posts per trend
    itself. `window_days` 0 is the current month so far (the bridge's default);
    anything else becomes a rolling window in hours. One platform
    finding nothing never fails the run: its reason is named in `unreachable`.
    """
    del max_items  # the bridge's own per-trend cap governs
    terms = [k.replace(",", " ").strip() for k in keywords if k and k.strip()]
    if not terms:
        return {"posts": [], "post_count": 0, "keywords_scanned": 0, "source": "none",
                "unreachable": ["No keywords were supplied."], "fallback_reason": "No keywords were supplied.",
                "platform_trends": []}

    try:
        report = _run_bridge([
            "--platform-trends",
            *(["--hours", str(int(window_days * 24))] if window_days > 0 else []),
            "--platforms", ",".join(LANES.keys()),
            "--keywords", ",".join(terms),
        ])
    except Exception as error:  # noqa: BLE001 — named, never swallowed
        return {"posts": [], "post_count": 0, "keywords_scanned": len(terms), "source": "none",
                "unreachable": [f"Claude Bridge: {error}"],
                "fallback_reason": f"The Claude Bridge could not run: {error}", "platform_trends": []}

    unreachable = [
        f"{p['platform']}: {p.get('reason') or p.get('status')}"
        for p in report.get("platforms", [])
        if p.get("status") != "ok"
    ]
    captured: list[dict[str, Any]] = []
    for post in report.get("posts", []):  # newest first, as the bridge returned them
        matched = post.get("matchedEtharaKeywords") or []
        platform_id = post.get("platformId")
        captured.append(RawPost(
            external_id=post["url"],
            text=clean_text(post.get("text") or ""),
            url=post["url"],
            author_name=post.get("author") or "",
            posted_at=post["publishedAt"],
            hashtags=[h.lstrip("#") for h in post.get("hashtags", [])],
            keyword=matched[0] if matched else "",
            source_name=f"Claude Bridge · {post.get('platform', '')}",
            **({"platform": Platform(platform_id)} if platform_id in LANES else {}),
        ).model_dump())

    return {
        "posts": captured,
        "post_count": len(captured),
        "keywords_scanned": len(terms),
        "source": "live" if captured else "none",
        "unreachable": unreachable,
        "platform_trends": report.get("trends", []),
        "fallback_reason": None
        if captured
        else "No Ethara-relevant post was verifiably published in the window on any platform. Nothing was substituted.",
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
