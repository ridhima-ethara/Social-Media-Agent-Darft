"""
CORPUS INGESTION — the Brain's side

Reads every PDF in `corpus/` and writes it into `backend/data/knowledge.json`,
the same file-backed store every Python agent's `recall_knowledge` /
`recall_visual_knowledge` tool reads. `server/scripts/ingest-corpus.ts` does
the equivalent for the Postgres store the TypeScript pipeline reads — the two
engines do not share a database, so a PDF dropped in `corpus/` needs both
ingesters run to reach both agent rosters. This one is Sherlock's, Dora's,
SpongeBob's, Minnie's, Jerry's and Velma's side of it.

Entries are written with `origin="brand"`, which is the same origin
`seed_brain.py` uses for the brand definition: definitional material the
operator supplied directly carries no citation floor (`Brain.learn` only
requires independent sources for `origin in ("research", "learned")`). A
single PDF is one source; requiring two would make it impossible to ever
store what you dropped in.

Idempotent by content hash, tracked in `backend/data/corpus_manifest.json` —
`MemoryEntry` has no tags field to stash a hash on, unlike the TS side's
`sha:` tag, so the manifest does that job here. Re-running with unchanged
PDFs writes nothing new; a changed PDF deactivates its old sections and
inserts the new ones; a removed PDF deactivates its sections and forgets it.

    backend/.venv/bin/python backend/ingest_corpus.py
    backend/.venv/bin/python backend/ingest_corpus.py --dry
"""

from __future__ import annotations

import hashlib
import json
import logging
import sys
from pathlib import Path

logging.getLogger("pypdf").setLevel(logging.ERROR)  # font-parsing notices, not extraction failures

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.brain import Brain  # noqa: E402
from core.schema import Citation, MemoryEntry  # noqa: E402
from tools.extract_corpus import extract  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
CORPUS_DIR = REPO_ROOT / "corpus"
MANIFEST_PATH = Path(__file__).resolve().parent / "data" / "corpus_manifest.json"

TARGET_WORDS = 1_200  # roughly one screen of reading, matches the TS sectioniser
MIN_WORDS = 40  # below this a "section" is noise, not a citable passage
SUPPORTED = {".pdf", ".md", ".txt", ".csv", ".json", ".yml", ".yaml", ".rst", ".log"}


def _walk() -> list[Path]:
    if not CORPUS_DIR.exists():
        return []
    return sorted(
        p for p in CORPUS_DIR.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED and p.name != "README.md"
    )


def _sectionise(text: str) -> list[str]:
    """Splits on blank lines, accumulates whole paragraphs up to the word target.
    Mirrors `server/scripts/ingest-corpus.ts`'s `sectionise` so a document reads
    the same shape in either store."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    sections: list[str] = []
    buffer: list[str] = []
    words = 0

    def flush() -> None:
        nonlocal buffer, words
        if not buffer:
            return
        body = "\n\n".join(buffer)
        if len(body.split()) >= MIN_WORDS:
            sections.append(body)
        buffer, words = [], 0

    for paragraph in paragraphs:
        count = len(paragraph.split())
        if words + count > TARGET_WORDS and buffer:
            flush()
        buffer.append(paragraph)
        words += count
    flush()

    if not sections and text.strip():
        sections.append(text.strip())
    return sections


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    dry = "--dry" in sys.argv[1:]

    if not CORPUS_DIR.exists():
        print(f"No {CORPUS_DIR}.")
        return 1

    files = _walk()
    if not files:
        print("corpus/ has no PDFs or text files yet.")
        return 0

    manifest: dict[str, dict[str, str]] = {}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8") or "{}")

    brain = Brain()
    inserted = merged = skipped = deactivated = 0
    unreadable: list[str] = []

    for path in files:
        display_name = str(path.relative_to(CORPUS_DIR))
        record = extract(path)
        if record["error"]:
            unreadable.append(f"{display_name} — {record['error']}")
            continue

        sections = _sectionise(record["text"])
        if not sections:
            unreadable.append(f"{display_name} — held no usable text")
            continue

        pages = record["pages"]
        page_note = f", pages {pages[0]}-{pages[-1]}" if pages else ""
        source_url = f"corpus/{display_name}{page_note}"

        prior = manifest.get(display_name, {})
        current_hashes = {_hash(s) for s in sections}

        # A hash no longer present means that passage left the file — its old
        # entry deactivates, same as the TS ingester does for a changed PDF.
        stale_ids = [entry_id for h, entry_id in prior.items() if h not in current_hashes]
        if not dry:
            for entry_id in stale_ids:
                if brain.deactivate(entry_id):
                    deactivated += 1

        new_manifest: dict[str, str] = {}
        for index, section in enumerate(sections, start=1):
            h = _hash(section)
            if h in prior:
                new_manifest[h] = prior[h]
                skipped += 1
                continue

            if dry:
                new_manifest[h] = "(dry-run)"
                inserted += 1
                continue

            action, entry, _reason = brain.learn(MemoryEntry(
                title=f"{display_name} · part {index}",
                category="Brand Corpus",
                content=section,
                origin="brand",
                sources=[Citation(title=display_name, url=source_url)],
            ))
            if action == "inserted" and entry:
                new_manifest[h] = entry.id
                inserted += 1
            elif action == "merged":
                merged += 1
            # "discarded" cannot happen for origin="brand" — no citation floor.

        manifest[display_name] = new_manifest
        print(f"  = {display_name} · {len(sections)} section(s)")

    if unreadable:
        print("\nNot ingested:")
        for line in unreadable:
            print(f"  ! {line}")

    if not dry:
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(
        f"\n{'Would insert' if dry else 'Inserted'} {inserted}"
        f"{f', merged {merged}' if merged else ''}"
        f"{f', skipped {skipped} unchanged' if skipped else ''}"
        f"{f', deactivated {deactivated} superseded' if deactivated else ''}."
    )
    if not dry and inserted:
        print("Sherlock, Dora, SpongeBob, Minnie, Jerry and Velma can now recall this corpus.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
