"""
THE BASE AGENT

Every agent is a folder. This class is what makes the folder runnable:

    agents/<name>_agent/
      agent.py          the subclass — declares its tools, shapes its result
      prompt.md         the system prompt: identity, objective, output contract
      instructions.md   the behavioural specification: Rules and Boundaries
      tools.md          what each tool does, and what it must never be used for
      schema.py         the typed input and output for this agent

The markdown is loaded at run time and sent to the model. It is never restated
in code, and code never restates it — a rule that lives in two places drifts.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .brain import Brain
from .config import Config
from .llm import Reasoning, ToolSpec, run_loop
from .schema import AgentResult, InjectionAttempt, SourceMode


class Agent:
    """Subclasses declare `agent_id`, `stage`, `hands_off_to`, and `tools()`."""

    agent_id: str = ""
    name: str = ""
    stage: str = ""
    hands_off_to: list[str] = []
    max_turns: int = 8

    def __init__(self, brain: Brain, overrides: dict[str, Any] | None = None) -> None:
        if not self.agent_id:
            raise ValueError(f"{type(self).__name__} must declare an agent_id.")
        self.brain = brain
        self.config = Config(self.agent_id, overrides)
        self.folder = Path(__file__).resolve().parent.parent / "agents" / self.agent_id
        self._injection: list[InjectionAttempt] = []

    # ── The folder's markdown ──────────────────────────────────────────────

    def _read(self, filename: str) -> str:
        path = self.folder / filename
        if not path.exists():
            raise FileNotFoundError(
                f"{self.agent_id} is missing {filename}. Every agent folder carries "
                "prompt.md, instructions.md and tools.md — the specification is the file."
            )
        return path.read_text(encoding="utf-8").strip()

    def system_prompt(self) -> str:
        """
        Assembled from the folder, every run. The instructions and the tool
        contract travel with the prompt, so the model cannot act on a stale
        copy of either.
        """
        settings = "\n".join(f"  {k} = {v}" for k, v in self.config.used().items())
        return (
            f"{self._read('prompt.md')}\n\n"
            f"---\n\n# Instructions\n\n{self._read('instructions.md')}\n\n"
            f"---\n\n# Tools\n\n{self._read('tools.md')}\n\n"
            f"---\n\n# Resolved settings for this run\n\n{settings or '  (none declared)'}\n\n"
            "Every number you need is above. Never invent one, and never use a "
            "number that is not listed here."
        )

    # ── What subclasses implement ──────────────────────────────────────────

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        raise NotImplementedError

    def task(self, payload: dict[str, Any]) -> str:
        raise NotImplementedError

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        Runs before the loop, in both paths.

        Anything the tools close over — the Knowledge Base read above all — must
        be populated here. A tool that reads agent state set in `finalise` would
        see it empty on the deterministic path, because the handlers run first.
        """
        return None

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        """Shapes the tool output into this agent's declared result."""
        return reasoning.payload

    def summarise(self, result: dict[str, Any]) -> str:
        """One sentence naming the evidence. 'Done' alone is a defect."""
        return ""

    # ── The run ────────────────────────────────────────────────────────────

    def run(self, payload: dict[str, Any] | None = None) -> AgentResult:
        """
        One path, whether a model reasons or the deterministic pipeline runs.
        The result shape is identical, and the source is stamped either way.
        """
        started = time.monotonic()
        payload = dict(payload or {})

        try:
            self.prepare(payload)
            tools = self.tools(payload)
            reasoning = run_loop(
                system=self.system_prompt(),
                task=self.task(payload),
                tools=tools,
                max_turns=self.max_turns,
            )
            output = self.finalise(reasoning, payload)

            result = AgentResult(
                agent_id=self.agent_id,
                status="completed",
                payload=output,
                summary=reasoning.text.strip() or self.summarise(output),
                tool_calls=[turn.tool for turn in reasoning.turns],
                injection_attempts=self._injection,
                source=SourceMode.LIVE if reasoning.used_model else SourceMode.FIXTURE,
                fallback_reason=reasoning.fallback_reason,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            if self.config.rejected:
                result.reason = "Settings rejected: " + "; ".join(self.config.rejected)
            return result

        except Exception as error:  # noqa: BLE001 — recorded, never swallowed
            return AgentResult(
                agent_id=self.agent_id,
                status="failed",
                summary=f"{self.name or self.agent_id} failed: {error}",
                duration_ms=int((time.monotonic() - started) * 1000),
                error=str(error),
            )

    # ── Shared helpers ─────────────────────────────────────────────────────

    def recall(self, topic: str, limit: int = 6) -> list[dict[str, Any]]:
        """The brain's read path. Every agent grounds through this, not a query."""
        return [
            {"id": e.id, "title": e.title, "content": e.content, "confidence": e.confidence.value}
            for e in self.brain.recall(topic, limit=limit)
        ]

    def note_injection(self, attempts: list[InjectionAttempt]) -> None:
        self._injection.extend(attempts)
