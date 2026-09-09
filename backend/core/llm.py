"""
THE MODEL CLIENT

One reasoning path, two bindings: Claude when `ANTHROPIC_API_KEY` is set, and a
deterministic fallback when it is not. Falling back changes which
implementation is bound, never which code path runs — so nothing downstream
branches on which one answered.

The fallback is not a stub. It runs the agent's tools in their declared order
and returns the same shape, which is what keeps the product fully explorable
with an empty environment.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "4096"))


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


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def unavailable_reason() -> str:
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
    """
    if not is_configured():
        return _deterministic(tools, unavailable_reason())

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
