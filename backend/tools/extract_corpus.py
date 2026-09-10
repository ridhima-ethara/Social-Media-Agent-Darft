"""
CORPUS TEXT EXTRACTION

Reads the files an operator dropped in `corpus/` and prints one JSON object on
stdout. Spawned by `server/scripts/ingest-corpus.ts`, which is the same
process-boundary-as-interface pattern the crawler and the agent bridge use: the
PDF reader lives where the Python dependencies already are, and Node does not
grow a parser it would only use here.

    backend/.venv/bin/python -m tools.extract_corpus <file> [<file> ...]

Every file produces one record, including the ones that could not be read. A
file whose text could not be extracted is reported with the reason and an empty
body — a scanned PDF is a real finding about that PDF, and OCR-guessing at it
would be inventing evidence.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

#: Read as plain text. Anything else needs a reader.
TEXT_SUFFIXES = {".md", ".txt", ".csv", ".json", ".yml", ".yaml", ".rst", ".log"}


def scrub(text: str) -> str:
    """
    Removes what a Postgres `text` column will not accept.

    A PDF text layer routinely carries NUL bytes, and Postgres rejects them
    outright: `invalid byte sequence for encoding "UTF8": 0x00`. That aborted the
    whole ingestion on the third document, so twenty-one PDFs an operator had
    added were never stored and nothing said why.

    Other C0 control characters go too — they carry no meaning in extracted prose
    and survive into captions as invisible breakage. Tab, newline and carriage
    return are kept, because they are the document's own structure.
    """
    kept = {"\t", "\n", "\r"}
    return "".join(ch for ch in text if ch in kept or ch >= " ")


def _read_pdf(path: Path) -> tuple[str, list[int], str | None]:
    """
    Returns `(text, page_numbers_with_text, error)`.

    Page numbers travel with the text so an entry can cite the pages it came
    from. A citation to "the PDF" is not a citation.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return ("", [], "pypdf is not installed in this interpreter — run `pip install pypdf`")

    try:
        reader = PdfReader(str(path))
    except Exception as error:  # noqa: BLE001 — reported, never swallowed
        return ("", [], f"could not be opened: {error}")

    chunks: list[str] = []
    pages: list[int] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            body = (page.extract_text() or "").strip()
        except Exception:  # noqa: BLE001 — one bad page never fails the file
            continue
        if body:
            chunks.append(body)
            pages.append(index)

    if not chunks:
        return (
            "",
            [],
            f"no extractable text layer across {len(reader.pages)} page(s) — "
            "it is probably a scan, and nothing was guessed at",
        )

    return ("\n\n".join(chunks), pages, None)


def extract(path: Path) -> dict[str, object]:
    record: dict[str, object] = {
        "path": str(path),
        "name": path.name,
        "suffix": path.suffix.lower(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "text": "",
        "pages": [],
        "error": None,
    }

    if not path.exists():
        record["error"] = "the file no longer exists"
        return record

    suffix = path.suffix.lower()

    if suffix == ".pdf":
        text, pages, error = _read_pdf(path)
        record["text"] = scrub(text)
        record["pages"] = pages
        record["error"] = error
        return record

    if suffix in TEXT_SUFFIXES:
        try:
            record["text"] = scrub(path.read_text(encoding="utf-8", errors="replace")).strip()
        except Exception as error:  # noqa: BLE001
            record["error"] = f"could not be read as text: {error}"
        return record

    record["error"] = f"{suffix or 'no extension'} is not a supported corpus format"
    return record


def main() -> int:
    paths = [Path(a) for a in sys.argv[1:]]
    if not paths:
        print(json.dumps({"files": [], "error": "no files given"}))
        return 1
    print(json.dumps({"files": [extract(p) for p in paths]}, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
