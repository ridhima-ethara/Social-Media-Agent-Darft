"""
CRAWL4AI — keyword-driven, platform-scoped open-web capture.

Why a sidecar rather than a service: crawl4ai drives a real browser, which is a
local process, not an endpoint. Wrapping it in an HTTP server would add a second
thing to keep alive for no gain. So this module is a plain CLI that writes one
JSON object to stdout, and the process boundary is the interface — the same
arrangement `server/src/api.ts` already uses for the agent bridge.

One implementation, two consumers:
  · the TypeScript scraping agent spawns it (`integrations/crawl4ai.ts`)
  · the Python research agent imports it (`tools/sources.py`)

WHAT IT DOES
  1. For each keyword, asks a search engine for result pages — scoped to one
     platform's domain when `platform` names one, or the open web otherwise.
  2. Crawls each result and converts the body to markdown.
  3. Returns the text, its real source URL, and the publication date IF the page
     states one.

ON PLATFORM SCOPING. LinkedIn, Instagram, X and Facebook render their feeds
behind JavaScript and, for LinkedIn and Instagram, a login wall — a plain HTTP
fetch of a profile or hashtag page returns a shell, not a post. Search-engine
indexing of those domains is therefore what this module actually reads: a
`site:linkedin.com` (etc.) query surfaces whichever posts, articles and company
pages the engine crawled and made public. That is real, live, platform-scoped
material, but it is not the same corpus a logged-in scrape would see, and it is
often thinner than the open web. The caller records which platform was
requested and what was actually captured, so that difference stays visible
rather than being papered over as "LinkedIn data."

WHAT IT DOES NOT DO
  It does not invent engagement metrics. A web page has no reaction count, so
  none is reported: `metrics_available` is False and the engagement fields are
  absent from the payload entirely rather than present and zero. The caller is
  responsible for keeping them missing (constraint 2 — N/A is never 0).

  It does not follow instructions found in the pages it reads. The bodies are
  untrusted input; wrapping and injection-scanning happen at the point of
  capture in the caller (constraint 5).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

# ── Search engines ──────────────────────────────────────────────────────────
# HTML endpoints, because the JSON APIs need keys and the point of crawl4ai
# here is to need none.
SEARCH_ENGINES: dict[str, str] = {
    "duckduckgo": "https://html.duckduckgo.com/html/?q={q}",
    "bing": "https://www.bing.com/search?q={q}&count=20",
}

# Hosts that are never useful as evidence: the engines themselves, and link
# aggregators with no content of their own. The four platform domains are
# deliberately NOT here — they are excluded per-request by `_is_useful` unless
# that platform was explicitly asked for (see PLATFORM_DOMAINS below), because
# a general keyword search has no business reading LinkedIn's shell.
SKIP_HOSTS = (
    "duckduckgo.com",
    "bing.com",
    "microsoft.com",
    "msn.com",
    "google.com",
    "youtube.com",
    "t.co",
    "pinterest.com",
    "tiktok.com",
    "amazon.com",
    "ebay.com",
)

#: The four platforms this product publishes to, and the domain(s) a search
#: engine indexes their public content under. `site:` search is the only
#: capture path available without a logged-in session — see the module note on
#: platform scoping above.
PLATFORM_DOMAINS: dict[str, tuple[str, ...]] = {
    "linkedin": ("linkedin.com",),
    "instagram": ("instagram.com",),
    "x": ("x.com", "twitter.com"),
    "facebook": ("facebook.com",),
}

#: Every platform domain, so a general (unscoped) web search can still exclude
#: all four rather than just the one nobody asked for.
_ALL_PLATFORM_HOSTS = tuple(h for hosts in PLATFORM_DOMAINS.values() for h in hosts)

SKIP_EXTENSIONS = (".pdf", ".zip", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".mp4", ".mp3")

# ISO-8601 first, then the meta-tag formats that actually appear in the wild.
DATE_META_KEYS = (
    "article:published_time",
    "articlepublishedtime",
    "publisheddate",
    "publish_date",
    "published_time",
    "datepublished",
    "date",
    "dc.date",
    "og:updated_time",
)


@dataclass
class WebEvidence:
    """One crawled page. Deliberately has no engagement fields."""

    external_id: str
    url: str
    title: str
    text: str
    site_name: str
    keyword: str
    author_name: str = ""
    #: Only set when the page itself states a date. Never inferred.
    published_at: str | None = None
    #: When the crawl happened. Always known, never confused with published_at.
    captured_at: str = ""
    hashtags: list[str] = field(default_factory=list)
    metrics_available: bool = False
    #: The platform this row was captured FOR — `None` for the general web
    #: tier. Not the same claim as "this page is on that platform's domain",
    #: though today it always is; the field exists so a caller never has to
    #: re-derive it from the URL.
    platform: str | None = None

    def to_dict(self) -> dict:
        return {
            "externalId": self.external_id,
            "url": self.url,
            "title": self.title,
            "text": self.text,
            "siteName": self.site_name,
            "keyword": self.keyword,
            "authorName": self.author_name,
            "publishedAt": self.published_at,
            "capturedAt": self.captured_at,
            "hashtags": self.hashtags,
            "metricsAvailable": self.metrics_available,
            "platform": self.platform,
        }


# ── URL handling ────────────────────────────────────────────────────────────


def _unwrap_redirect(href: str) -> str:
    """
    DuckDuckGo hands back `//duckduckgo.com/l/?uddg=<encoded target>`; Bing uses
    a `u=` parameter. Following the wrapper would crawl the engine, not the
    result, so the real target is recovered first.
    """
    if href.startswith("//"):
        href = "https:" + href

    try:
        parsed = urlparse(href)
    except ValueError:
        return href

    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [])
        if target:
            return unquote(target[0])

    if "bing.com" in parsed.netloc and "/ck/a" in parsed.path:
        raw = parse_qs(parsed.query).get("u", [])
        if raw:
            candidate = raw[0]
            # Bing base64-encodes the target with an "a1" prefix.
            if candidate.startswith("a1"):
                import base64

                pad = "=" * (-len(candidate[2:]) % 4)
                try:
                    return base64.urlsafe_b64decode(candidate[2:] + pad).decode("utf-8")
                except Exception:
                    return href
            return unquote(candidate)

    return href


def _is_useful(url: str, platform: str | None) -> bool:
    """
    Whether a result URL is worth crawling.

    `platform=None` (the general web search) excludes every platform domain —
    a keyword search with no platform named should not silently become a
    LinkedIn reading. `platform='linkedin'` etc. requires the URL be ON that
    platform's domain(s); a search scoped to LinkedIn that wandered onto a
    news aggregator would not be evidence of what LinkedIn is saying.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False

    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.netloc:
        return False

    host = parsed.netloc.lower().removeprefix("www.")
    if any(host == skip or host.endswith("." + skip) for skip in SKIP_HOSTS):
        return False
    if parsed.path.lower().endswith(SKIP_EXTENSIONS):
        return False

    if platform is None:
        if any(host == p or host.endswith("." + p) for p in _ALL_PLATFORM_HOSTS):
            return False
        return True

    allowed = PLATFORM_DOMAINS.get(platform, ())
    return any(host == d or host.endswith("." + d) for d in allowed)


def _dedupe_key(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc.lower().removeprefix('www.')}{parsed.path.rstrip('/').lower()}"


def _site_name(url: str) -> str:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return host or "unknown"


# ── Body handling ───────────────────────────────────────────────────────────

_IMAGE_MD = re.compile(r"!\[[^\]]*\]\([^)]*\)")
#: `[text](url)` → `text`. The URL is dropped because the citation the caller
#: produces uses the page's own URL, not whatever it happened to link to.
_LINK_MD = re.compile(r"\[([^\]]*)\]\((?:[^)]*)\)")
_ANCHOR_ONLY = re.compile(r"^#+\s*$")
_RULE_ONLY = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
_TABLE_ROW = re.compile(r"^\s*\|")

# Navigation copy that carries no evidence, however it is phrased.
_CHROME = re.compile(
    r"^(?:skip to (?:main |)content|cookie|accept all|subscribe|sign (?:in|up)|log in|"
    r"menu|share this|follow us|advertisement|related (?:articles|posts)|"
    r"copy page|join the .{0,40} community|table of contents|"
    r"we use cookies|privacy policy|terms of (?:use|service)|"
    # Site-wide banners and fundraising notices. These sit ABOVE the article and
    # would otherwise be mistaken for its opening line.
    r"wiki loves|arxiv is now|donate|back to articles|"
    r"home\s+whiteboard|jump to (?:content|navigation)|"
    r"last updated\s*:|published\s*:|reading time|min read|share on)\b",
    re.IGNORECASE,
)


def _clean_markdown(markdown: str, max_chars: int) -> str:
    """
    Turns crawl4ai's markdown into prose.

    Images and link targets go, link TEXT stays — a page's argument often lives
    inside its links, so dropping the whole construct would destroy evidence
    while dropping only the URL does not.

    Conservative on the rest: a line is removed only when it is entirely
    boilerplate, because over-cleaning silently loses the thing being cited.
    """
    kept: list[str] = []
    for raw_line in markdown.splitlines():
        line = _IMAGE_MD.sub("", raw_line)
        line = _LINK_MD.sub(r"\1", line)
        # Markdown heading anchors leave a stray `#` once the link is unwrapped.
        line = re.sub(r"^(#+)\s*\s*", r"\1 ", line)
        stripped = line.strip()

        if not stripped:
            if kept and kept[-1] != "":
                kept.append("")
            continue
        if _ANCHOR_ONLY.match(stripped) or _RULE_ONLY.match(stripped):
            continue
        if _TABLE_ROW.match(stripped):
            continue
        if _CHROME.match(stripped):
            continue
        # A line with no letters is punctuation or layout, never evidence.
        if not re.search(r"[A-Za-z]", stripped):
            continue
        if len(stripped) < 3:
            continue
        kept.append(stripped)

    text = "\n".join(kept).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)

    if len(text) > max_chars:
        # Cut at a sentence boundary where one is near, so the tail is not a
        # fragment that reads as a truncated claim.
        window = text[:max_chars]
        cut = max(window.rfind(". "), window.rfind("\n"))
        text = (window[: cut + 1] if cut > max_chars * 0.6 else window).rstrip() + " […]"

    return text


def _hashtags_for_web_page() -> list[str]:
    """
    A website has no hashtags, so none are reported.

    This function exists to hold the reason. An earlier version scanned page
    bodies for `#token` and produced tags like `#cite_note` and `#Cite_note-1`
    from Wikipedia's footnote anchors — URL fragments dressed up as topic
    signals, which then reached a caption and were published as if the audience
    used them.

    Deriving topic tags from prose is the Analysis Agent's job. The scraper
    gathers; it does not judge (see this module's header). Returning an empty
    list is the honest answer, and an empty list is not the same as zero
    engagement: it means the concept does not apply to this artefact.
    """
    return []


def _normalise_date(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    # ISO-8601, with or without a zone.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%B %d, %Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


#: Trailing site branding on a <title>: "Reinforcement learning - Wikipedia".
_TITLE_SUFFIX = re.compile(r"\s*[|\u2013\u2014\u00b7-]\s*[^|\u2013\u2014\u00b7-]{1,40}$")


def _page_title(metadata: dict, body: str, url: str) -> str:
    """
    The page's subject, in preference order: its own `<title>` or `og:title`,
    then its first markdown heading, then the last path segment.

    The site-branding suffix is trimmed only when what remains is still
    substantial, so a page genuinely titled "RLHF - Explained" keeps its second
    half while "Reinforcement learning - Wikipedia" loses the site name.
    """
    lowered = {str(k).lower(): v for k, v in (metadata or {}).items()}
    for key in ("title", "og:title", "twitter:title"):
        value = lowered.get(key)
        if isinstance(value, str) and value.strip():
            title = value.strip()
            trimmed = _TITLE_SUFFIX.sub("", title).strip()
            return (trimmed if len(trimmed) >= 12 else title)[:200]

    for line in body.splitlines():
        if line.startswith("#"):
            heading = line.lstrip("#").strip()
            if len(heading) >= 8:
                return heading[:200]

    slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    return slug.replace("-", " ").replace("_", " ").strip()[:200]


def _published_at(metadata: dict) -> str | None:
    """The page's own stated date, or None. Never the crawl time."""
    if not isinstance(metadata, dict):
        return None
    lowered = {str(k).lower(): v for k, v in metadata.items()}
    for key in DATE_META_KEYS:
        value = lowered.get(key)
        if isinstance(value, str):
            normalised = _normalise_date(value)
            if normalised:
                return normalised
    return None


# ── The crawl ───────────────────────────────────────────────────────────────


def _search_query(keyword: str, platform: str | None) -> str:
    """
    The literal query sent to the search engine.

    A platform-scoped request adds `site:<domain>` — the standard operator
    every general-purpose engine honours, and the only way to bias results
    toward one platform without that platform's own (login-walled) search.
    """
    if platform is None:
        return keyword
    domains = PLATFORM_DOMAINS.get(platform, ())
    if not domains:
        return keyword
    site_clause = " OR ".join(f"site:{d}" for d in domains)
    return f"{keyword} ({site_clause})" if len(domains) > 1 else f"{keyword} site:{domains[0]}"


async def _collect_result_urls(
    crawler,
    engines: list[str],
    keyword: str,
    want: int,
    cfg_cls,
    errors: list[str],
    platform: str | None = None,
) -> list[str]:
    """Runs the keyword past each engine in turn until enough URLs are gathered."""
    found: list[str] = []
    seen: set[str] = set()
    query = _search_query(keyword, platform)

    for engine in engines:
        if len(found) >= want:
            break
        template = SEARCH_ENGINES.get(engine)
        if not template:
            errors.append(f"unknown search engine '{engine}'")
            continue

        url = template.format(q=quote_plus(query))
        try:
            result = await crawler.arun(url=url, config=cfg_cls(cache_mode=None, page_timeout=45_000))
        except Exception as exc:  # noqa: BLE001 — an engine failing must not end the run
            errors.append(f"{engine} search for '{keyword}' failed: {exc}")
            continue

        if not getattr(result, "success", False):
            errors.append(f"{engine} search for '{keyword}' returned no page")
            continue

        links = getattr(result, "links", {}) or {}
        candidates = list(links.get("external", [])) + list(links.get("internal", []))

        for link in candidates:
            href = link.get("href") if isinstance(link, dict) else str(link)
            if not href:
                continue
            target = _unwrap_redirect(href)
            if not _is_useful(target, platform):
                continue
            key = _dedupe_key(target)
            if key in seen:
                continue
            seen.add(key)
            found.append(target)
            if len(found) >= want:
                break

    return found[:want]


async def crawl_keywords(
    keywords: list[str],
    *,
    engines: list[str] | None = None,
    max_pages: int = 8,
    max_chars: int = 6_000,
    delay_ms: int = 400,
    headless: bool = True,
    platform: str | None = None,
) -> dict:
    """
    Searches each keyword and crawls the results.

    `platform` — one of `linkedin`, `instagram`, `x`, `facebook`, or `None` for
    the open web. Scoping is a `site:` search operator (see the module note);
    it narrows WHICH pages are crawled, not how they are crawled.

    Returns `{"posts": [...], "engines": [...], "errors": [...]}`. Errors are
    reported alongside whatever succeeded rather than raised, because a run that
    captured nine keywords out of ten is worth having.
    """
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

    if platform is not None and platform not in PLATFORM_DOMAINS:
        raise ValueError(
            f"platform must be one of {sorted(PLATFORM_DOMAINS)} or None, got {platform!r}"
        )

    engines = engines or ["duckduckgo", "bing"]
    errors: list[str] = []
    posts: list[WebEvidence] = []
    now = datetime.now(timezone.utc).isoformat()

    browser = BrowserConfig(headless=headless, verbose=False, light_mode=True)

    # crawl4ai's progress logger writes to stdout regardless of `verbose`, and
    # stdout is this module's data channel. Rather than fight the library's
    # logging config, stdout is pointed at stderr for the duration of the crawl:
    # the diagnostics stay visible to an operator, and stdout stays parseable.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        async with AsyncWebCrawler(config=browser) as crawler:
            for keyword in keywords:
                urls = await _collect_result_urls(
                    crawler, engines, keyword, max_pages, CrawlerRunConfig, errors, platform
                )

                if not urls:
                    scope = f"'{platform}' " if platform else ""
                    errors.append(f"no {scope}result URLs for '{keyword}'")
                    continue

                for url in urls:
                    if delay_ms > 0:
                        await asyncio.sleep(delay_ms / 1000)
                    try:
                        page = await crawler.arun(
                            url=url,
                            config=CrawlerRunConfig(
                                cache_mode=None,
                                page_timeout=45_000,
                                word_count_threshold=25,
                                excluded_tags=["nav", "footer", "header", "aside", "form"],
                                remove_overlay_elements=True,
                                verbose=False,
                            ),
                        )
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"crawl of {url} failed: {exc}")
                        continue

                    if not getattr(page, "success", False):
                        errors.append(f"crawl of {url} returned no page")
                        continue

                    raw_md = getattr(page, "markdown", "") or ""
                    # crawl4ai returns either a string or a MarkdownGenerationResult.
                    if not isinstance(raw_md, str):
                        raw_md = (
                            getattr(raw_md, "fit_markdown", "")
                            or getattr(raw_md, "raw_markdown", "")
                            or ""
                        )

                    body = _clean_markdown(raw_md, max_chars)
                    if len(body) < 200:
                        # Too thin to be evidence. Reported, not silently dropped.
                        errors.append(f"{url} yielded only {len(body)} usable characters")
                        continue

                    metadata = getattr(page, "metadata", {}) or {}
                    title = _page_title(metadata, body, url)

                    posts.append(
                        WebEvidence(
                            external_id=f"crawl4ai:{_dedupe_key(url)}",
                            url=url,
                            title=title,
                            # The title leads the body as a heading.
                            #
                            # Consumers derive a headline from the first words of
                            # the text (`headlineFrom` on the TypeScript side), and
                            # a page's first prose line is very often a banner
                            # rather than its subject. Putting the real title first
                            # makes that derivation correct without either consumer
                            # needing to know why.
                            text=f"# {title}\n\n{body}" if title else body,
                            site_name=_site_name(url),
                            keyword=keyword,
                            author_name=(metadata.get("author") or "").strip()[:120],
                            published_at=_published_at(metadata),
                            captured_at=now,
                            hashtags=_hashtags_for_web_page(),
                            metrics_available=False,
                            platform=platform,
                        )
                    )
    finally:
        sys.stdout = real_stdout

    return {
        "posts": [p.to_dict() for p in posts],
        "engines": engines,
        "errors": errors,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Keyword-driven open-web capture via crawl4ai.")
    parser.add_argument("--keywords", required=True, help="Comma-separated keywords.")
    parser.add_argument(
        "--platform",
        default="",
        choices=["", *sorted(PLATFORM_DOMAINS)],
        help="Scope the search to one platform's domain via a site: query. Blank = open web.",
    )
    parser.add_argument("--engines", default="duckduckgo,bing")
    parser.add_argument("--max-pages", type=int, default=8, help="Pages per keyword.")
    parser.add_argument("--max-chars", type=int, default=6000, help="Characters kept per page.")
    parser.add_argument("--delay-ms", type=int, default=400, help="Politeness delay between fetches.")
    parser.add_argument("--headed", action="store_true", help="Show the browser window.")
    parser.add_argument(
        "--out",
        default="",
        help="Write the JSON here instead of stdout. Preferred by machine callers.",
    )
    args = parser.parse_args(argv)

    def emit(payload: dict) -> None:
        text = json.dumps(payload)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as handle:
                handle.write(text)
        else:
            print(text)

    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    if not keywords:
        emit({"posts": [], "engines": [], "errors": ["no keywords given"]})
        return 2

    engines = [e.strip().lower() for e in args.engines.split(",") if e.strip()]

    try:
        payload = asyncio.run(
            crawl_keywords(
                keywords,
                engines=engines,
                max_pages=args.max_pages,
                max_chars=args.max_chars,
                delay_ms=args.delay_ms,
                headless=not args.headed,
                platform=args.platform or None,
            )
        )
    except Exception as exc:  # noqa: BLE001 — the caller needs JSON, not a traceback
        emit({"posts": [], "engines": engines, "errors": [str(exc)]})
        return 1

    emit(payload)
    if payload["errors"]:
        print(f"{len(payload['errors'])} non-fatal issue(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
