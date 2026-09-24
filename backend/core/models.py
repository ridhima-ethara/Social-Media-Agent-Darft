"""
THE DEFAULT MODEL TAGS — THE PYTHON TIER'S HOME.

Mirrors the constants in `shared/text-models.ts` and `shared/image-models.ts`,
which are the canonical declarations. Python cannot import TypeScript, so this
file exists to give this tier ONE place for the same facts rather than a literal
buried in `llm.py` and another in `painter.py`.

The two files are kept honest by a test, not by a comment: `tests/model-defaults
.test.ts` reads both off disk and asserts every tag matches character for
character. A drift here fails `npm run verify` naming both sides and both values.

WHY THIS MATTERS MORE THAN IT LOOKS. These are `os.environ.get` fallbacks, so
they only take effect when the key is absent — which is exactly the fresh-machine
case. A default naming a tag that is not installed produces "model not found"
from inside a run that has already spent its crawl, rather than at configuration
time where it belongs.
"""

from __future__ import annotations

import os

# ── Text ────────────────────────────────────────────────────────────────────

#: This tier's hosted binding. It has no Gemini client — see `core/llm.py`.
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"

# ── Images ──────────────────────────────────────────────────────────────────

#: The mflux (MLX) weight set. 4b is Apache-2.0 and ungated; 9b is gated.
DEFAULT_MFLUX_MODEL = "flux2-klein-4b"

# ── Embeddings ──────────────────────────────────────────────────────────────

#: `gemini-embedding-001` at 768 dimensions. `server/src/db/schema.sql` fixes
#: the column width to match. Served by the Node tier over the Google credential.
DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"


def resolved(key: str, default: str) -> str:
    """
    An environment override, or the declared default.

    Treats a blank value as absent, matching `str()` in `server/src/config.ts`:
    a key written as `MFLUX_MODEL=` is present as the empty string, and
    returning it would ask for a model named "".
    """
    value = os.environ.get(key, "").strip()
    return value or default
