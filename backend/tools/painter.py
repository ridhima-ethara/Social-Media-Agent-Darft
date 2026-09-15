"""
THE BACKGROUND PAINTER

FLUX.2 Klein, the local background painter for the Python agent tier. Mirrors
`server/src/agents/image/image-models/flux2-klein.ts` — same model, same two
transports, same prompt, same seed rule — so a brief painted by either tier
produces the same picture.

BACKGROUND PIXELS ONLY. Rule 12 says no diffusion model is ever asked to render
brand text, and nothing here asks for any. The headline, the mark and the kicker
are composited over the result as vectors by `imagery.render_image`, which is
the real enforcement: a model that ignored the instruction still could not put
text on the finished creative, because the finished creative is drawn locally.

TWO TRANSPORTS, ONE MODEL
Ollama holds the weights and advertises `capabilities: ["image"]`, but as of
0.33.3 its HTTP API refuses image models outright. So this tries Ollama first
and falls through to mflux, the MLX port of the same model, run as a subprocess.
That is transport selection, not model substitution: an operator who asked for
FLUX.2 Klein gets FLUX.2 Klein either way, and the transport that served is
recorded. When Ollama ships REST support the first branch simply starts winning.

DEGRADE, NEVER FAIL. Every failure path returns a reason instead of raising.
The Image Agent renders the brand layer on its own when nothing painted, and
says which painter declined and why — a post that ships without a background is
better than a pipeline that stops, and a post that pretends it had one is worse
than both.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from core.models import DEFAULT_MFLUX_MODEL, DEFAULT_OLLAMA_IMAGE_MODEL, resolved

# Transport binding is environment, not operator settings — the same split
# `core/llm.py` makes. Which machine a model runs on is deployment; how the
# agent behaves once it has one is configuration, and that lives in the registry.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
OLLAMA_IMAGE_MODEL = resolved("OLLAMA_IMAGE_MODEL", DEFAULT_OLLAMA_IMAGE_MODEL)
OLLAMA_IMAGE_TIMEOUT_S = int(os.environ.get("OLLAMA_IMAGE_TIMEOUT_MS", "600000")) // 1000

MFLUX_PYTHON = os.environ.get("MFLUX_PYTHON", "").strip()
MFLUX_MODEL = resolved("MFLUX_MODEL", DEFAULT_MFLUX_MODEL)
MFLUX_STEPS = int(os.environ.get("MFLUX_STEPS", "4"))
MFLUX_SEED = int(os.environ.get("MFLUX_SEED", "42"))
MFLUX_QUANTIZE = int(os.environ.get("MFLUX_QUANTIZE", "8"))
MFLUX_TIMEOUT_S = int(os.environ.get("MFLUX_TIMEOUT_MS", "900000")) // 1000

PAINTER_ID = "flux2-klein"


def _mflux_cli() -> Path | None:
    """
    The CLI is resolved as a sibling of the configured interpreter, so one
    environment variable configures the whole thing and there is no way to point
    at a Python that lacks the tool.
    """
    if not MFLUX_PYTHON:
        return None
    candidate = Path(MFLUX_PYTHON).parent / "mflux-generate-flux2"
    if candidate.exists():
        return candidate
    found = shutil.which("mflux-generate-flux2")
    return Path(found) if found else None


def ollama_configured() -> bool:
    return bool(OLLAMA_BASE_URL)


def mflux_configured() -> bool:
    return _mflux_cli() is not None


def is_configured() -> bool:
    return ollama_configured() or mflux_configured()


def unavailable_reason() -> str:
    if is_configured():
        return ""
    return "neither OLLAMA_BASE_URL nor MFLUX_PYTHON is set, so FLUX.2 Klein has no transport"


def build_prompt(background_prompt: str) -> str:
    """
    Rule 12, stated positively.

    `mflux-generate-flux2` rejects `--negative-prompt` outright and exits before
    rendering, so "empty of text" has to be part of the description of what is
    wanted rather than a list of what is not.
    """
    return " ".join([
        "Abstract technical background artwork.",
        "Deep near-black ground, violet and purple accents, editorial and restrained.",
        "Generous negative space on the left third.",
        "A completely clean surface, empty of any text, lettering, numerals, logos or watermarks.",
        "No people.",
        background_prompt,
    ]).strip()


def snap(value: int) -> int:
    """Diffusion models want dimensions on a 16px grid; MLX is happier on 64."""
    return max(256, round(value / 64) * 64)


def seed_for(headline: str, concept: str, platform: str) -> int:
    """
    A stable seed per brief, so the same headline renders the same background
    twice. Replayability is a property the whole pipeline depends on, and a
    random seed would quietly remove it for images alone.
    """
    if MFLUX_SEED >= 0:
        return MFLUX_SEED
    hash_ = 2166136261
    for char in f"{headline}|{concept}|{platform}":
        hash_ = ((hash_ ^ ord(char)) * 16777619) & 0xFFFFFFFF
    return hash_ % 2_147_483_647


def _paint_with_ollama(prompt: str, width: int, height: int) -> dict[str, str]:
    """The preferred transport: the weights are already there, no second runtime."""
    body = json.dumps({
        "model": OLLAMA_IMAGE_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"width": width, "height": height},
    }).encode()
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=OLLAMA_IMAGE_TIMEOUT_S) as response:
        payload = json.loads(response.read().decode())

    images = payload.get("images") or []
    if not images:
        # This is the documented 0.33.3 behaviour, not an outage. Named exactly
        # so the operator does not go looking for a broken daemon.
        raise RuntimeError(
            payload.get("error")
            or "Ollama returned no image — its HTTP API still refuses image models"
        )
    return {"base64": images[0], "mime_type": "image/png"}


def _paint_with_mflux(prompt: str, width: int, height: int, seed: int) -> dict[str, str]:
    """
    Runs `mflux-generate-flux2` and reads the PNG it wrote.

    mflux is a library, not a service. Standing up an HTTP wrapper would add a
    process to supervise for no gain, so this spawns the CLI — the same
    process-boundary-as-interface arrangement the agent bridge already uses.
    """
    cli = _mflux_cli()
    if cli is None:
        raise RuntimeError("MFLUX_PYTHON is not set")

    with tempfile.TemporaryDirectory(prefix="ethara-flux-") as directory:
        out_path = Path(directory) / "background.png"
        args = [
            str(cli),
            "--model", MFLUX_MODEL,
            "--quantize", str(MFLUX_QUANTIZE),
            "--steps", str(MFLUX_STEPS),
            "--seed", str(seed),
            "--height", str(snap(height)),
            "--width", str(snap(width)),
            "--prompt", prompt,
            # No `--negative-prompt`: FLUX.2 does not accept one, and passing it
            # makes mflux exit 2 before it renders anything.
            "--no-metadata",
            "--output", str(out_path),
        ]
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                timeout=MFLUX_TIMEOUT_S,
                env={**os.environ, "HF_HUB_ENABLE_HF_TRANSFER": "1"},
                check=False,
            )
        except FileNotFoundError as error:
            raise RuntimeError(f"could not start mflux ({cli}) — {error}") from error
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"mflux exceeded {MFLUX_TIMEOUT_S}s — the first run also downloads weights, "
                "which can take a while"
            ) from error

        if result.returncode != 0:
            noise = (result.stderr or b"").decode(errors="replace")
            noise += (result.stdout or b"").decode(errors="replace")
            tail = " ".join(noise.split())[-400:]
            # The single most common first-run failure, named so the operator
            # does not have to read a Python traceback to find out what to do.
            if any(m in noise for m in ("GatedRepoError", "gated repo", "401 Client Error")):
                raise RuntimeError(
                    f'the weights for "{MFLUX_MODEL}" are gated on Hugging Face — accept the '
                    "licence and set HF_TOKEN, or use the Apache-2.0 flux2-klein-4b"
                )
            raise RuntimeError(f"mflux exited {result.returncode}{f' — {tail}' if tail else ''}")

        if not out_path.exists() or out_path.stat().st_size == 0:
            raise RuntimeError("mflux wrote an empty image")
        return {
            "base64": base64.b64encode(out_path.read_bytes()).decode(),
            "mime_type": "image/png",
        }


def paint_background(
    prompt: str,
    width: int,
    height: int,
    headline: str = "",
    concept: str = "",
    platform: str = "linkedin",
    painter: str = "flux2-klein",
) -> dict[str, Any]:
    """
    Paints the background, or says why it could not.

    Never raises. `brand-svg` means the operator asked for no painted background
    at all, which is a choice rather than a failure, and the two are reported
    differently — an operator who chose the local renderer should not be told
    something went wrong.
    """
    if painter in ("brand-svg", "", "none"):
        return {
            "painted": False,
            "painter": "brand-svg",
            "transport": "local",
            "reason": "brand-svg is the bound painter: the brand renderer draws the whole creative.",
        }

    if not is_configured():
        return {
            "painted": False, "painter": painter, "transport": "none",
            "reason": unavailable_reason(),
        }

    full_prompt = build_prompt(prompt)
    failures: list[str] = []

    if ollama_configured():
        try:
            image = _paint_with_ollama(full_prompt, snap(width), snap(height))
            return {
                "painted": True, "painter": PAINTER_ID, "transport": "ollama",
                "model": OLLAMA_IMAGE_MODEL,
                "data_uri": f"data:{image['mime_type']};base64,{image['base64']}",
                "prompt_used": full_prompt,
            }
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError) as error:
            failures.append(f"Ollama transport declined — {error}")

    if mflux_configured():
        try:
            image = _paint_with_mflux(
                full_prompt, width, height, seed_for(headline, concept, platform)
            )
            return {
                "painted": True, "painter": PAINTER_ID, "transport": "mflux",
                "model": MFLUX_MODEL,
                "data_uri": f"data:{image['mime_type']};base64,{image['base64']}",
                "prompt_used": full_prompt,
            }
        except (RuntimeError, OSError) as error:
            failures.append(f"mflux transport failed — {error}")

    # Both transports named, so the operator sees why each one declined rather
    # than a single collapsed "unavailable".
    return {
        "painted": False, "painter": painter, "transport": "none",
        "reason": f"no FLUX.2 Klein transport succeeded — {'; '.join(failures)}",
    }
