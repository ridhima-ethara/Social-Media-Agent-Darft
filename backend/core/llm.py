"""
THE MODEL CLIENT

One reasoning path, three bindings:

  · Ollama / Qwen3      when `OLLAMA_BASE_URL` is set — local, no key, no egress
  · Claude              when `ANTHROPIC_API_KEY` is set
  · the deterministic pipeline when neither is

Falling back changes which implementation is bound, never which code path runs
— so nothing downstream branches on which one answered. `run_loop` and
`Reasoning` are the contract, and all three bindings honour it exactly.

The deterministic path is not a stub. It runs the agent's tools in their
declared order and returns the same shape, which is what keeps the product
fully explorable with an empty environment.

WHY OLLAMA FIRST WHEN BOTH ARE AVAILABLE
A local model costs nothing per call and keeps scraped evidence on the machine
that scraped it. `AGENT_MODEL_PROVIDER` overrides the preference explicitly for
anyone who wants the hosted model.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

from .models import DEFAULT_ANTHROPIC_MODEL, DEFAULT_OLLAMA_TEXT_MODEL, resolved

MODEL = resolved("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
MAX_TOKENS = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "4096"))

# ── Ollama ──────────────────────────────────────────────────────────────────
# No default for the base URL, deliberately: a default would make
# `_ollama_configured()` answer True on a machine with no daemon, and the agent
# would report a live model while silently running the fallback.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
OLLAMA_MODEL = resolved("OLLAMA_TEXT_MODEL", DEFAULT_OLLAMA_TEXT_MODEL)
OLLAMA_TIMEOUT_S = int(os.environ.get("OLLAMA_TIMEOUT_MS", "180000")) // 1000
OLLAMA_CONTEXT_TOKENS = int(os.environ.get("OLLAMA_CONTEXT_TOKENS", "16384"))

#: `auto` prefers the local model. `ollama` / `anthropic` pin one.
#: `deterministic` disables both.
PROVIDER = os.environ.get("AGENT_MODEL_PROVIDER", "auto").strip().lower()

#: What the loop says when it runs out of turns. Named because `run` has to be
#: able to tell it apart from a real answer: it is a fact about the loop, not a
#: report on the work, and it must never stand in for one.
TURN_CAP_TEXT = "Reached the turn cap before finishing."


@dataclass
class ToolSpec:
    """A tool an agent may call. The allowlist is the first line of defence."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., Any]

    def to_anthropic(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}

    def to_ollama(self) -> dict[str, Any]:
        """Ollama follows the OpenAI function-calling envelope."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


@dataclass
class Turn:
    """One reasoning turn: what was called, and what came back."""

    tool: str
    arguments: dict[str, Any] = field(default_factory=dict)
    result_summary: str = ""


@dataclass
class Reasoning:
    """The outcome of a model loop, or of the deterministic fallback."""

    text: str = ""
    turns: list[Turn] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)
    used_model: bool = False
    fallback_reason: str | None = None

    #: Which binding actually answered, and its model id. Set by `run_loop`
    #: rather than inferred by callers: on a chained run the binding that
    #: answered is not necessarily the preferred one, and an artefact stamped
    #: with the preference would name a model that did not write it.
    provider: str = "deterministic"
    model: str = "ethara-deterministic-pipeline"

    #: The primary's failure, when a backup answered instead. `None` when the
    #: preferred binding served — the ordinary case, which needs no explanation.
    degraded_from: str | None = None


def _anthropic_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _ollama_configured() -> bool:
    return bool(OLLAMA_BASE_URL)


def active_provider() -> str:
    """
    Which binding will actually serve, resolved the same way every time.

    Returned rather than inferred by callers, because "which model produced
    this" is the first question asked about any agent output.
    """
    chain = provider_chain()
    return chain[0] if chain else "deterministic"


def provider_chain() -> list[str]:
    """
    THE ORDERED BINDINGS, PRIMARY FIRST.

    `active_provider()` answers "which binding owns reasoning", which is the
    right question when one is configured and the wrong one when the primary is
    configured but failing. A hosted endpoint gets rate-limited, has its
    credential rotated or returns a 500; a local daemon gets stopped. On any of
    those days a run that the other binding could have served instead collapsed
    to the deterministic pipeline, because the binding had already been decided.

    So reasoning is a chain, mirroring `captureChainFor()` on the Node side and
    `textChain()` in `server/src/integrations/ollama.ts`: try the preferred
    binding, then the other one behind it, then the deterministic pipeline.

    `AGENT_MODEL_PROVIDER=deterministic` returns an empty chain — it is a
    positive choice for the deterministic pipeline, not a failure to reach a
    model, so nothing is attempted.
    """
    if PROVIDER == "deterministic":
        return []

    if PROVIDER == "ollama":
        preferred, backup = "ollama", "anthropic"
    elif PROVIDER == "anthropic":
        preferred, backup = "anthropic", "ollama"
    else:
        # `auto` prefers the local model: it costs nothing per call and keeps
        # scraped evidence on the machine that scraped it.
        preferred, backup = "ollama", "anthropic"

    configured = {"ollama": _ollama_configured(), "anthropic": _anthropic_configured()}

    chain = [name for name in (preferred, backup) if configured[name]]
    return chain


def active_model() -> str:
    """The model id of the active binding, for the artefact stamp."""
    return model_for(active_provider())


def model_for(provider: str) -> str:
    """The model id behind a named binding, for stamping a chained result."""
    if provider == "ollama":
        return OLLAMA_MODEL
    if provider == "anthropic":
        return MODEL
    return "ethara-deterministic-pipeline"


def is_configured() -> bool:
    return active_provider() != "deterministic"


def unavailable_reason() -> str:
    if PROVIDER == "deterministic":
        return "AGENT_MODEL_PROVIDER is deterministic"
    if PROVIDER == "ollama":
        return "OLLAMA_BASE_URL is not set"
    if PROVIDER == "anthropic":
        return "ANTHROPIC_API_KEY is not set"
    return "neither OLLAMA_BASE_URL nor ANTHROPIC_API_KEY is set"


def run_loop(
    system: str,
    task: str,
    tools: list[ToolSpec],
    max_turns: int = 8,
) -> Reasoning:
    """
    Runs the agent loop: the model chooses tools, sees results, and continues
    until it answers or the turn cap is reached.

    Every tool result is fed back verbatim. The model never sees a tool it does
    not hold — the allowlist is enforced here, not merely described in a prompt.

    Each configured binding is tried in turn. A binding that raises is a
    degradation, not the end of the run: the reason is recorded on the Reasoning
    that finally answers, so an operator learns the primary is broken even
    though the output is fine. Hiding that behind a working backup would let a
    rotated credential go unnoticed for as long as the backup held.
    """
    chain = provider_chain()
    if not chain:
        return _deterministic(tools, unavailable_reason())

    failures: list[str] = []
    last_fallback: Reasoning | None = None

    for provider in chain:
        try:
            if provider == "ollama":
                reasoning = _run_ollama(system, task, tools, max_turns)
            else:
                reasoning = _run_anthropic(system, task, tools, max_turns)
        except Exception as error:  # noqa: BLE001 — every binding failure is a degradation
            failures.append(f"{provider} ({model_for(provider)}) failed — {error}")
            continue

        # Each binding catches its own transport failure and returns the
        # deterministic shape rather than raising. That is NOT an answer from
        # this provider, and treating it as one is how a chain silently stops
        # being a chain — the backup would never be reached because the primary
        # always "succeeded". `used_model` is the discriminator.
        if not reasoning.used_model:
            failures.append(
                f"{provider} ({model_for(provider)}) did not serve — {reasoning.fallback_reason}"
            )
            last_fallback = reasoning
            continue

        reasoning.provider = provider
        reasoning.model = model_for(provider)
        if failures:
            # The backup answered. Name what it stood in for, on the artefact.
            reasoning.degraded_from = "; ".join(failures)
        return reasoning

    # No binding served. The deterministic pipeline is the answer, carrying
    # every reason it took — one per link that could not.
    result = last_fallback if last_fallback is not None else _deterministic(tools, "; ".join(failures))
    result.provider = "deterministic"
    result.model = "ethara-deterministic-pipeline"
    if failures:
        result.fallback_reason = "; ".join(failures)
    return result


# ── Binding 1 · Ollama (local) ───────────────────────────────────────────────


def _ollama_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """
    One HTTP path for this binding, on the standard library.

    urllib rather than requests because the backend declares as few
    dependencies as it can get away with, and this is one POST.
    """
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=OLLAMA_TIMEOUT_S) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:240]
        raise RuntimeError(f"Ollama returned HTTP {error.code} — {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"no Ollama daemon answered at {OLLAMA_BASE_URL} — is `ollama serve` running? ({error.reason})"
        ) from error


def _strip_reasoning(text: str) -> str:
    """
    Removes a leading reasoning block if one is emitted despite `think: false`.
    Only a block that OPENS the response is stripped, so prose that happens to
    contain the word is untouched.
    """
    import re

    return re.sub(r"^\s*<(think|thinking)>.*?</\1>\s*", "", text, flags=re.S | re.I).strip()


def _run_ollama(system: str, task: str, tools: list[ToolSpec], max_turns: int) -> Reasoning:
    """
    The same loop as the Claude binding, in Ollama's envelope.

    Qwen3 is a hybrid-reasoning model; thinking is disabled because the agent
    wants the answer and the tool calls, not the deliberation.
    """
    by_name = {tool.name: tool for tool in tools}
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": task},
    ]
    turns: list[Turn] = []
    payload: dict[str, Any] = {}

    try:
        for _ in range(max_turns):
            response = _ollama_post(
                "/api/chat",
                {
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "tools": [t.to_ollama() for t in tools],
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0.4, "num_ctx": OLLAMA_CONTEXT_TOKENS},
                },
            )

            message = response.get("message") or {}
            calls = message.get("tool_calls") or []

            if not calls:
                return Reasoning(
                    text=_strip_reasoning(message.get("content") or ""),
                    turns=turns,
                    payload=payload,
                    used_model=True,
                )

            messages.append(message)

            for call in calls:
                function = call.get("function") or {}
                name = function.get("name", "")
                arguments = function.get("arguments") or {}
                # Ollama sometimes hands arguments back as a JSON string.
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except json.JSONDecodeError:
                        arguments = {}
                if not isinstance(arguments, dict):
                    arguments = {}

                tool = by_name.get(name)
                if tool is None:
                    # Refused, and the refusal is reported rather than hidden.
                    messages.append({
                        "role": "tool",
                        "tool_name": name,
                        "content": f"{name} is not a tool you hold. Your Boundaries forbid it.",
                    })
                    continue

                try:
                    output = tool.handler(**arguments)
                except Exception as error:  # noqa: BLE001 — reported, never swallowed
                    messages.append({
                        "role": "tool",
                        "tool_name": name,
                        "content": f"{name} failed: {error}",
                    })
                    continue

                if isinstance(output, dict):
                    payload.update(output)
                turns.append(Turn(tool=name, arguments=dict(arguments), result_summary=_summarise(output)))
                messages.append({
                    "role": "tool",
                    "tool_name": name,
                    "content": json.dumps(output, default=str)[:8000],
                })

        return Reasoning(
            text=TURN_CAP_TEXT,
            turns=turns,
            payload=payload,
            used_model=True,
            fallback_reason=f"stopped after {max_turns} turns",
        )

    except Exception as error:  # noqa: BLE001 — fail in the open, stamped
        fallback = _deterministic(tools, f"the local model call failed: {error}")
        fallback.turns = turns + fallback.turns
        return fallback


# ── Binding 2 · Anthropic ────────────────────────────────────────────────────


def _run_anthropic(system: str, task: str, tools: list[ToolSpec], max_turns: int) -> Reasoning:
    try:
        import anthropic
    except ImportError:
        return _deterministic(tools, "the anthropic package is not installed")

    client = anthropic.Anthropic()
    by_name = {tool.name: tool for tool in tools}
    messages: list[dict[str, Any]] = [{"role": "user", "content": task}]
    turns: list[Turn] = []
    payload: dict[str, Any] = {}

    try:
        for _ in range(max_turns):
            response = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=[t.to_anthropic() for t in tools],
                messages=messages,
            )

            calls = [block for block in response.content if getattr(block, "type", "") == "tool_use"]
            if not calls:
                text = "".join(getattr(b, "text", "") for b in response.content)
                return Reasoning(text=text, turns=turns, payload=payload, used_model=True)

            messages.append({"role": "assistant", "content": response.content})
            results: list[dict[str, Any]] = []

            for call in calls:
                tool = by_name.get(call.name)
                if tool is None:
                    # Refused, and the refusal is reported rather than hidden.
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "is_error": True,
                        "content": f"{call.name} is not a tool you hold. Your Boundaries forbid it.",
                    })
                    continue
                try:
                    output = tool.handler(**call.input)
                except Exception as error:  # noqa: BLE001 — reported, never swallowed
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "is_error": True,
                        "content": f"{call.name} failed: {error}",
                    })
                    continue

                if isinstance(output, dict):
                    payload.update(output)
                turns.append(Turn(tool=call.name, arguments=dict(call.input), result_summary=_summarise(output)))
                results.append({
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": json.dumps(output, default=str)[:8000],
                })

            messages.append({"role": "user", "content": results})

        return Reasoning(
            text="Reached the turn cap before finishing.",
            turns=turns,
            payload=payload,
            used_model=True,
            fallback_reason=f"stopped after {max_turns} turns",
        )

    except Exception as error:  # noqa: BLE001 — fail in the open, stamped
        fallback = _deterministic(tools, f"the model call failed: {error}")
        fallback.turns = turns + fallback.turns
        return fallback


def _deterministic(tools: list[ToolSpec], reason: str) -> Reasoning:
    """
    Runs every tool in declared order with no arguments.

    This is the pipeline the product shipped with: reproducible, explainable,
    and blunter than a model. It is a supported configuration, not a stub.
    """
    turns: list[Turn] = []
    payload: dict[str, Any] = {}
    for tool in tools:
        try:
            output = tool.handler()
        except TypeError:
            continue  # needs arguments only a model would choose
        except Exception as error:  # noqa: BLE001
            turns.append(Turn(tool=tool.name, result_summary=f"failed: {error}"))
            continue
        if isinstance(output, dict):
            payload.update(output)
        turns.append(Turn(tool=tool.name, result_summary=_summarise(output)))
    return Reasoning(
        text="",
        turns=turns,
        payload=payload,
        used_model=False,
        fallback_reason=f"Ran the deterministic pipeline because {reason}.",
    )


def _summarise(output: Any) -> str:
    if isinstance(output, dict):
        return ", ".join(f"{k}={_short(v)}" for k, v in list(output.items())[:4])
    if isinstance(output, list):
        return f"{len(output)} item(s)"
    return _short(output)


def _short(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        return f"[{len(value)}]"
    text = str(value)
    return text if len(text) <= 60 else f"{text[:57]}…"
