"""
THE MODEL CLIENT

One reasoning path, two bindings:

  · Claude              when `ANTHROPIC_API_KEY` is set
  · the deterministic pipeline when it is not

Falling back changes which implementation is bound, never which code path runs
— so nothing downstream branches on which one answered. `run_loop` and
`Reasoning` are the contract, and both bindings honour it exactly.

The deterministic path is not a stub. It runs the agent's tools in their
declared order and returns the same shape, which is what keeps the product
fully explorable with an empty environment.

(An earlier version also offered a local Ollama / Qwen3 binding. Ollama has
been removed from the product; the Python tier now runs on Claude, with
`AGENT_MODEL_PROVIDER` naming `anthropic` or `deterministic`.)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable

from .models import DEFAULT_ANTHROPIC_MODEL, resolved

MODEL = resolved("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
MAX_TOKENS = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "4096"))

#: `auto` and `anthropic` both use Claude. `deterministic` disables it.
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

    Ollama has been removed, so there is one model binding: Claude, when it is
    configured. `AGENT_MODEL_PROVIDER=deterministic` returns an empty chain — a
    positive choice for the deterministic pipeline, not a failure to reach a
    model, so nothing is attempted.
    """
    if PROVIDER == "deterministic":
        return []
    return ["anthropic"] if _anthropic_configured() else []


def active_model() -> str:
    """The model id of the active binding, for the artefact stamp."""
    return model_for(active_provider())


def model_for(provider: str) -> str:
    """The model id behind a named binding, for stamping a chained result."""
    if provider == "anthropic":
        return MODEL
    return "ethara-deterministic-pipeline"


def is_configured() -> bool:
    return active_provider() != "deterministic"


def unavailable_reason() -> str:
    if PROVIDER == "deterministic":
        return "AGENT_MODEL_PROVIDER is deterministic"
    return "ANTHROPIC_API_KEY is not set"


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
