"""
THE BRAIN — the Knowledge Base as shared memory

Deliberately *not* an agent. It is the store every agent reads before it acts
and writes back to after every outcome: research findings, the brand
definition, learned preferences, and the reasons behind past decisions.

One store, one retrieval path — so the active-entry filter, the citation
requirement and the ranking are applied once, in one place. An agent that
queried the database directly would eventually apply them differently.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

from .schema import Citation, Confidence, MemoryEntry, utcnow

# An entry citing fewer independent sources than this is discarded, not stored
# with low confidence — an uncited claim in the store is a claim something
# downstream will eventually ground on.
MIN_SOURCES = 2

# At or above this Dice similarity, a candidate merges rather than inserts.
DEDUPE_THRESHOLD = 0.72

_WORD = re.compile(r"[a-z0-9]+")


def _bigrams(text: str) -> set[str]:
    words = _WORD.findall(text.lower())
    grams = set(words)
    grams.update(f"{a} {b}" for a, b in zip(words, words[1:]))
    return grams


def similarity(a: str, b: str) -> float:
    """Dice over content-word bigrams. Computed, never judged by a model."""
    left, right = _bigrams(a), _bigrams(b)
    if not left or not right:
        return 0.0
    return 2 * len(left & right) / (len(left) + len(right))


def _domains(sources: Iterable[Citation]) -> set[str]:
    """Three URLs from one domain are ONE independent source."""
    out: set[str] = set()
    for source in sources:
        match = re.search(r"https?://(?:www\.)?([^/]+)", source.url)
        out.add(match.group(1) if match else source.url)
    return out


def derive_confidence(independent_sources: int) -> Confidence:
    """Derived from evidence, never asserted by a caller."""
    if independent_sources >= 3:
        return Confidence.HIGH
    if independent_sources == 2:
        return Confidence.MEDIUM
    return Confidence.LOW


class Brain:
    """
    File-backed shared memory. The path is injected, so tests and the live
    workspace bind different stores without either knowing which it has.
    """

    def __init__(self, path: str | Path = "backend/data/knowledge.json") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._entries: list[MemoryEntry] = []
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8") or "[]")
        self._entries = [MemoryEntry(**row) for row in raw]

    def _save(self) -> None:
        self.path.write_text(
            json.dumps([e.model_dump() for e in self._entries], indent=2), encoding="utf-8"
        )

    # ── The read path every agent uses ─────────────────────────────────────

    def recall(self, topic: str, limit: int = 8, categories: list[str] | None = None) -> list[MemoryEntry]:
        """
        Inactive entries are never returned to a generation path — that is what
        makes "switch an entry off and generation changes" true rather than
        decorative.
        """
        words = [w for w in topic.lower().split() if len(w) > 3]
        scored: list[tuple[float, MemoryEntry]] = []

        for entry in self._entries:
            if not entry.active:
                continue
            if categories and entry.category not in categories:
                continue
            haystack = f"{entry.title} {entry.content}".lower()
            overlap = sum(1 for w in words if w in haystack)
            topical = overlap / len(words) if words else 0.0
            weight = {Confidence.HIGH: 1.0, Confidence.MEDIUM: 0.6, Confidence.LOW: 0.3}[entry.confidence]
            score = topical * 0.6 + weight * 0.4
            if score > 0.2:
                scored.append((score, entry))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [entry for _, entry in scored[:limit]]

    # ── The write path ─────────────────────────────────────────────────────

    def learn(self, entry: MemoryEntry) -> tuple[str, MemoryEntry | None, str]:
        """
        Returns `(action, entry, reason)` where action is inserted | merged | discarded.

        Merging is how the store gets more confident rather than merely longer.
        """
        independent = len(_domains(entry.sources))
        needs_citation = entry.origin in ("research", "learned")

        # Merge is checked BEFORE the citation floor. A thinly-cited candidate
        # that matches an existing entry *adds* evidence to it, which is the
        # behaviour we want; the floor exists to stop a new uncited claim
        # entering the store, not to reject corroboration of a known one.
        for existing in self._entries:
            if not existing.active or existing.category != entry.category:
                continue
            score = similarity(f"{entry.title} {entry.content}", f"{existing.title} {existing.content}")
            if score >= DEDUPE_THRESHOLD:
                seen = {s.url for s in existing.sources}
                existing.sources.extend(s for s in entry.sources if s.url not in seen)
                existing.evidence_count += 1
                existing.confidence = derive_confidence(len(_domains(existing.sources)))
                self._save()
                return ("merged", existing,
                        f'Merged into "{existing.title}" at {score:.2f} similarity. '
                        f"Evidence count is now {existing.evidence_count}.")

        if needs_citation and independent < MIN_SOURCES:
            return ("discarded", None,
                    f'"{entry.title}" cites {independent} independent source(s), below the floor of '
                    f"{MIN_SOURCES}, and matches nothing already stored. An uncited claim never enters the store.")

        entry.id = entry.id or f"kb-{len(self._entries) + 1:04d}"
        entry.confidence = derive_confidence(independent) if needs_citation else entry.confidence
        entry.created_at = entry.created_at or utcnow()
        self._entries.insert(0, entry)
        self._save()
        return ("inserted", entry, f'"{entry.title}" stored with {independent} independent source(s).')

    def deactivate(self, entry_id: str) -> MemoryEntry | None:
        """Entries deactivate. There is deliberately no delete path."""
        for entry in self._entries:
            if entry.id == entry_id:
                entry.active = False
                self._save()
                return entry
        return None

    def adjust_confidence(self, entry_id: str, direction: str) -> MemoryEntry | None:
        """
        Raises confidence after confirmation, lowers it after contradiction.
        The demotion path is not optional: a store that only ever gains
        confidence is a store that cannot be corrected.
        """
        order = [Confidence.LOW, Confidence.MEDIUM, Confidence.HIGH]
        for entry in self._entries:
            if entry.id != entry_id:
                continue
            index = order.index(entry.confidence)
            entry.confidence = order[min(len(order) - 1, index + 1)] if direction == "confirm" else order[max(0, index - 1)]
            if direction == "confirm":
                entry.evidence_count += 1
            self._save()
            return entry
        return None

    def stats(self) -> dict[str, int]:
        return {
            "total": len(self._entries),
            "active": sum(1 for e in self._entries if e.active),
            "high_confidence": sum(1 for e in self._entries if e.active and e.confidence == Confidence.HIGH),
            "research": sum(1 for e in self._entries if e.origin == "research"),
        }
