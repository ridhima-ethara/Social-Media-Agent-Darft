"""
LEARNING TOOLS — turning what happened into what we know

Two streams feed the brain, and they are different in kind:

    the human   what the operator asked for in the assistant. A directive, not
                a finding. It is definitional — the human said it, so it is
                true of how we want to work — and carries no citation floor.

    the outcome what the audience actually did. A finding, and findings need
                evidence: the posts it rests on, named individually, plus the
                measurement run that observed them.

Nothing here writes. These tools shape candidates; `Brain.learn` decides what
is stored, merged or discarded, so the citation floor is applied in exactly one
place no matter which stream produced the candidate.
"""

from __future__ import annotations

import re
from typing import Any

_WORD = re.compile(r"[a-z0-9]+")

# What an operator's message is asking the platform to *remember*, and the
# Knowledge Base category each kind of ask belongs in.
# Ordered most specific first — the first cue set that matches wins. The modal
# words ("always", "never") are deliberately absent: they mark a *durable*
# instruction, not a compliance one, and putting them here would route every
# standing instruction into Compliance Rule regardless of what it was about.
#
# Cues match on whole words. Substring matching sent "evaluation benchmarks" to
# Compliance Rule because "e-valuation-" contains "valuation" — and evaluation
# is one of the four things this lab actually publishes about, so the most
# common subject on the platform was being filed as a disclosure risk.
DIRECTIVE_CUES: list[tuple[str, str, list[str]]] = [
    ("Compliance Rule", "what we may not publish",
     ["confidential", "unannounced", "legal", "competitor", "funding", "valuation",
      "customer name", "disclose", "approval", "under embargo"]),
    ("Visual Preference", "how our pictures look",
     ["image", "picture", "visual", "colour", "color", "canvas", "logo", "graphic",
      "thumbnail", "photo", "illustration"]),
    ("Platform Preference", "where and when we post",
     ["linkedin", "instagram", "facebook", "twitter", "x", "platform", "schedule",
      "posting time", "time of day", "weekday", "weekend"]),
    ("Brand Voice", "how we sound",
     ["tone", "voice", "sound", "register", "wording", "phrase", "caption", "hook",
      "headline", "open with", "opening", "say", "write", "word"]),
    ("Audience Insight", "who we are talking to",
     ["audience", "reader", "researcher", "engineer", "follower", "practitioner"]),
]

# Phrasing that marks a message as an instruction to remember rather than a
# passing request. "Always open with the number" is durable; "run it" is not.
DURABLE = re.compile(
    r"\b(always|never|from now on|going forward|prefer|stop|remember|make sure|"
    r"every time|in future|should|must)\b", re.I
)


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def _mentions(text: str, cue: str) -> bool:
    """
    Whole-word cue matching. A multi-word cue matches as a phrase.

    Word boundaries are the whole point: without them "valuation" fires on
    "evaluation" and "word" fires on "wording", so the cue that happens to sit
    highest in the list wins on an accident of spelling.
    """
    return re.search(rf"\b{re.escape(cue)}\b", text, re.I) is not None


def similarity(a: str, b: str) -> float:
    """Dice over content words. Computed, never judged (Constraint 4)."""
    left, right = _words(a), _words(b)
    if not left or not right:
        return 0.0
    return 2 * len(left & right) / (len(left) + len(right))


# ── The human stream ──────────────────────────────────────────────────────────

# The assistant stores a turn as `AssistantTurn` — `speaker` and `utterance`
# (src/types.ts). Other callers hand the more conventional `role`/`text` pair.
# Both are read, because a reader that silently matched neither would report
# "0 instructions" on a full transcript and look like the operator had simply
# never asked for anything.
_HUMAN_SPEAKERS = {"operator", "user", "human"}
_TEXT_KEYS = ("utterance", "text", "content", "message")
_TIME_KEYS = ("created_at", "at", "timestamp")


def _is_human(message: dict[str, Any]) -> bool:
    """A turn with no speaker at all is treated as the operator's — the
    assistant's own turns are always labelled, so an unlabelled one came in
    from outside."""
    speaker = message.get("speaker") or message.get("role") or "operator"
    return str(speaker).lower() in _HUMAN_SPEAKERS


def _utterance(message: dict[str, Any]) -> str:
    for key in _TEXT_KEYS:
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _asked_at(message: dict[str, Any]) -> str:
    for key in _TIME_KEYS:
        value = message.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _author(message: dict[str, Any]) -> str:
    return str(message.get("author") or message.get("asked_by") or "the operator")


def distil_requests(
    messages: list[dict[str, Any]] | None = None,
    min_words: int = 4,
) -> dict[str, Any]:
    """
    Reads what the operator asked for in the assistant and separates the
    durable instructions from the passing ones.

    "Always lead with the number" changes every caption from here on. "Run the
    scrape again" changes nothing once it has run. Only the first kind becomes
    knowledge — storing the second would fill the brain with noise the operator
    never meant to teach it.
    """
    messages = messages or []
    candidates: list[dict[str, Any]] = []
    passed_over: list[dict[str, Any]] = []

    for message in messages:
        if not _is_human(message):
            continue
        text = _utterance(message)
        if len(text.split()) < min_words:
            passed_over.append({"text": text, "reason": f"Under {min_words} words — too short to carry a durable instruction."})
            continue
        if not DURABLE.search(text):
            passed_over.append({"text": text, "reason": "Reads as a one-off request, not an instruction about how to work."})
            continue

        category, subject = "Human Directive", "how we work"
        for name, described, cues in DIRECTIVE_CUES:
            if any(_mentions(text, cue) for cue in cues):
                category, subject = name, described
                break

        candidates.append({
            "title": " ".join(text.split()[:9]).rstrip(".,:;"),
            "category": category,
            "content": text,
            "origin": "manual",
            "subject": subject,
            "asked_by": _author(message),
            "asked_at": _asked_at(message),
            "sources": [{
                "title": f"Assistant request from {_author(message)}",
                "url": f"ethara://assistant/{message.get('id', 'message')}",
                "published_at": _asked_at(message) or None,
            }],
            "reason": (
                f"The operator gave a standing instruction about {subject}. A human instruction "
                "outranks a brand guideline, so it is stored as given, not paraphrased."
            ),
        })

    return {
        "candidates": candidates,
        "passed_over": passed_over,
        "messages_read": len(messages),
        "note": (
            f"{len(candidates)} durable instruction(s) out of {len(messages)} message(s). "
            f"{len(passed_over)} were one-off requests and were not stored."
        ),
    }


# ── The outcome stream ────────────────────────────────────────────────────────

def _permalink(post: dict[str, Any]) -> str:
    """
    Where the post actually is. A citation the operator cannot click is not a
    citation, so the internal id is only used when nothing real is on offer.
    """
    for key in ("permalink", "url", "post_url", "link"):
        value = post.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    identifier = post.get("id") or post.get("external_id")
    return f"ethara://post/{identifier}" if identifier else ""


def detect_patterns(
    posts: list[dict[str, Any]] | None = None,
    comparisons: list[dict[str, Any]] | None = None,
    min_evidence: int = 2,
) -> dict[str, Any]:
    """
    Reads what the audience did and proposes what it means.

    A pattern must rest on at least `min_evidence` posts. One post above its
    baseline is a post above its baseline; it is not yet a thing we know, and
    writing it down as one is how a Knowledge Base fills with coincidence.

    Every candidate cites the posts it rests on, by permalink, plus the
    measurement that observed them. That second citation is a real artefact —
    the analytics run — and not a device for clearing the citation floor.
    """
    posts = posts or []
    comparisons = comparisons or []

    reported = [p for p in posts if p.get("likes") is not None or p.get("reach") is not None]
    unreported = len(posts) - len(reported)

    def strength(post: dict[str, Any]) -> int:
        """Engagement weighted the way the whole product weights it."""
        return (post.get("likes") or 0) + (post.get("comments") or 0) * 3 + (post.get("shares") or 0) * 5

    ranked = sorted(reported, key=strength, reverse=True)
    candidates: list[dict[str, Any]] = []
    withheld: list[str] = []

    def cite(group: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sources = [
            {"title": p.get("title") or _caption(p)[:60] or "Published post", "url": _permalink(p)}
            for p in group if _permalink(p)
        ]
        sources.append({"title": "Analytics run against this account's trailing baseline",
                        "url": "https://analytics.ethara.ai/runs/latest"})
        return sources

    # What the strongest posts share — the pattern worth repeating.
    top = ranked[:max(min_evidence, 2)]
    if len(top) >= min_evidence:
        shared = _shared_traits(top, ranked)
        if shared:
            candidates.append({
                "title": f"{shared['label']} posts lead this account",
                "category": "High Performer",
                "content": (
                    f"The {len(top)} strongest posts on record all {shared['description']}. "
                    f"Weighted engagement ran {strength(top[0])} at the top against "
                    f"{strength(ranked[-1])} at the bottom of {len(ranked)} measured post(s). "
                    "Repeat this and check whether it holds over the next two."
                ),
                "origin": "learned",
                "sources": cite(top),
                "evidence_posts": len(top),
                "reason": f"Held across {len(top)} posts, above the floor of {min_evidence}.",
            })
        else:
            withheld.append(
                f"The {len(top)} strongest posts share no trait the platform can name, so there is "
                "nothing to learn from them yet."
            )
    else:
        withheld.append(
            f"Only {len(top)} post(s) carry reported engagement — below the floor of {min_evidence}. "
            "One post above its baseline is not a pattern."
        )

    # What the weakest posts share — equally a finding, and the one teams skip.
    bottom = ranked[-min_evidence:] if len(ranked) >= min_evidence * 2 else []
    if not bottom and ranked:
        withheld.append(
            f"{len(ranked)} measured post(s) is too few to separate a weakest group from a strongest "
            f"one without the two overlapping. At least {min_evidence * 2} are needed."
        )
    if bottom:
        shared = _shared_traits(bottom, ranked)
        if shared:
            candidates.append({
                "title": f"{shared['label']} posts trail this account",
                "category": "Audience Insight",
                "content": (
                    f"The {len(bottom)} weakest posts on record all {shared['description']}. "
                    f"Weighted engagement ran {strength(bottom[-1])} at the bottom. "
                    "This is what to stop doing, stated as plainly as what to repeat."
                ),
                "origin": "learned",
                "sources": cite(bottom),
                "evidence_posts": len(bottom),
                "reason": f"Held across {len(bottom)} posts, above the floor of {min_evidence}.",
            })
        else:
            withheld.append(
                f"The {len(bottom)} weakest posts share no trait that the strongest posts lack, so "
                "there is nothing here to stop doing. They underperformed for a reason this run "
                "cannot name."
            )

    # An anomaly the Analytics Agent already named is evidence, not a new claim.
    anomalies = [c for c in comparisons if c.get("metric") and abs(c.get("sigma", 0)) >= 1.5]

    return {
        "candidates": candidates,
        "withheld": withheld,
        "posts_measured": len(reported),
        "posts_unreported": unreported,
        "anomalies_considered": len(anomalies),
        "note": (
            f"{len(candidates)} pattern(s) from {len(reported)} measured post(s)."
            + (f" {unreported} post(s) reported no metrics and were excluded, never counted as zero."
               if unreported else "")
        ),
    }


def _caption(post: dict[str, Any]) -> str:
    """The caption text, however the caller shaped it."""
    body = post.get("caption") or post.get("body") or post.get("text") or ""
    if isinstance(body, dict):
        body = body.get("body", "")
    return str(body).strip()


def _opening(post: dict[str, Any]) -> str:
    """The first sentence, which is the part that decides whether the rest is read."""
    text = _caption(post)
    return re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0] if text else ""


#: How a post is described, in the terms the platform can act on. Each entry is
#: (label, description, test). Caption shape comes first, deliberately: it is
#: the thing a writer can change tomorrow. Platform and format come last, and
#: only survive the discrimination check below when they actually distinguish
#: the group from everything else measured.
TRAITS: list[tuple[str, str, Any]] = [
    ("Number-first", "opened on a hard number",
     lambda p: re.search(r"\d", _opening(p)) is not None),
    ("Question-opening", "opened with a question",
     lambda p: _opening(p).endswith("?")),
    ("Announcement register", "used the announcement register",
     lambda p: re.search(r"\b(excited|thrilled|delighted|proud|pleased)\b", _caption(p), re.I) is not None),
    ("First-person-plural", "led with what we did rather than what is true",
     lambda p: re.match(r"\s*(we|our|i)\b", _opening(p), re.I) is not None),
    ("Evidence-linked", "pointed at the evidence behind the claim",
     lambda p: re.search(r"\b(here is|trace|measurement|benchmark|data|paper)\b", _caption(p), re.I) is not None),
]


def _shared_traits(
    group: list[dict[str, Any]],
    population: list[dict[str, Any]] | None = None,
) -> dict[str, str] | None:
    """
    What a group of posts has in common *and the rest do not*.

    The second half is the whole point. Every post in an account may run on
    LinkedIn, in which case "ran on LinkedIn" is true of the strongest posts and
    equally true of the weakest — and reporting it produces the pair of entries
    "LinkedIn leads this account" and "LinkedIn trails this account", which
    cannot both be acted on and makes the store worse than empty.

    So a trait qualifies only when every post in the group has it and at least
    one post outside the group does not. Returns `None` when nothing separates
    them, which is a finding too, and a better one than inventing a resemblance.
    """
    if not group:
        return None
    population = population or group
    outside = [p for p in population if p not in group]

    def separates(test: Any) -> bool:
        if not all(test(p) for p in group):
            return False
        # With nothing to compare against, a shared trait is still the most we
        # can say — but once there is an outside, it has to differ there.
        return not outside or not all(test(p) for p in outside)

    for label, description, test in TRAITS:
        if separates(test):
            return {"label": label, "description": description}

    for key, describe in (
        ("format", lambda v: f"used the {v} format"),
        ("concept", lambda v: f"carried a {str(v).replace('-', ' ')} visual"),
        ("platform", lambda v: f"ran on {v}"),
    ):
        values = {p.get(key) for p in group if p.get(key)}
        if len(values) == 1 and separates(lambda p, k=key, v=next(iter(values)): p.get(k) == v):
            value = next(iter(values))
            return {"label": str(value).replace("-", " ").capitalize(), "description": describe(value)}

    return None


# ── Consolidation ─────────────────────────────────────────────────────────────

def consolidate(candidates: list[dict[str, Any]] | None = None, threshold: float = 72) -> dict[str, Any]:
    """
    Folds near-identical candidates together before any of them reaches the
    brain, so one run never writes the same lesson twice under two titles.

    The brain deduplicates too. This runs first because a candidate that merges
    here keeps both sets of citations, which is what makes the surviving entry
    stronger rather than merely first.
    """
    candidates = candidates or []
    cut = threshold / 100 if threshold > 1 else threshold
    kept: list[dict[str, Any]] = []
    folded: list[str] = []

    for candidate in candidates:
        text = f"{candidate.get('title', '')} {candidate.get('content', '')}"
        match = next(
            (k for k in kept
             if k.get("category") == candidate.get("category")
             and similarity(text, f"{k.get('title', '')} {k.get('content', '')}") >= cut),
            None,
        )
        if match is None:
            kept.append(dict(candidate))
            continue
        seen = {s["url"] for s in match.get("sources", [])}
        match.setdefault("sources", []).extend(
            s for s in candidate.get("sources", []) if s["url"] not in seen
        )
        folded.append(
            f'"{candidate.get("title", "")}" folded into "{match.get("title", "")}" '
            f"— its citations were kept."
        )

    return {
        "consolidated": kept,
        "folded": folded,
        "note": f"{len(kept)} candidate(s) after folding {len(folded)}.",
    }
