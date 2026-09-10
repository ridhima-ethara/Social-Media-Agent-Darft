# `corpus/` — the reference library the agents write from

Drop files in here and run one command. Everything you add becomes **Brand Corpus** knowledge in the
Knowledge Base, which is the same store the Content Agent grounds captions on, the Review Agent
checks against, and the Scraping Agent scores captured pages with.

```bash
npm run corpus:ingest          # read every file in corpus/, write it into the Knowledge Base
npm run corpus:ingest -- --dry # show what would be written, write nothing
```

The API server does not need to be running; the script talks to Postgres directly. Postgres does.

---

## What you can put in here

| Extension | How it is read |
|---|---|
| `.pdf` | Text layer extracted page by page with `pypdf` |
| `.md`, `.txt` | Read as-is |
| `.csv`, `.json`, `.yml`, `.yaml` | Read as text |

Subfolders are fine and are used as tags. A file in `corpus/research/rlhf/paper.pdf` arrives tagged
`research` and `rlhf`, so you can shape what the Scraping Agent treats as on-topic just by how you
file things.

**A scanned PDF with no text layer is reported, never guessed at.** If `pypdf` finds no extractable
text the file is listed as skipped with that reason — it is not passed through OCR and it is not
silently counted as ingested. Run it through OCR yourself and re-add it if you need it.

---

## What happens to a file

1. Text is extracted. A PDF goes through `backend/tools/extract_corpus.py`, which needs the backend
   venv — the same interpreter `CRAWL4AI_PYTHON` points at.
2. It is split into sections of roughly 1,200 words on paragraph boundaries, never mid-sentence. One
   40-page PDF becomes several entries rather than one unreadable wall, because retrieval scores
   entries and a single huge entry either always wins or always loses.
3. Each section is written as one Knowledge Base entry: `category: Brand Corpus`, `origin: brand`,
   `source` naming the file and page range, tagged `brand`, `brand-corpus`, `brand-domain`, plus its
   folder names.

`origin: brand` matters — retrieval prioritises brand-origin entries over scraped research, so your
own material outranks something found on the open web.

---

## Re-running it

Ingestion is idempotent by content: a section whose text is unchanged is skipped, so running it twice
adds nothing. Edit a file and re-run and the changed sections are added as new entries while the old
ones are **deactivated, never deleted** — the codebase rule is that nothing is ever deleted, and
history stays explainable.

To take something out of circulation, switch the entry off in the Knowledge Base screen. It stops
reaching generation immediately and the record of it stays.

---

## Checking it worked

Open **Knowledge Base** and filter to **Brand Corpus**. Each entry shows its source file. Anything
active is in play for the next post the agents write.
