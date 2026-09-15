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
from .llm import TURN_CAP_TEXT, Reasoning, ToolSpec, run_loop
from .schema import AgentResult, InjectionAttempt, SourceMode


class Agent:
    """Subclasses declare `agent_id`, `stage`, `hands_off_to`, `skills`, and `tools()`."""

    agent_id: str = ""
    name: str = ""
    role: str = ""
    icon: str = ""
    stage: str = ""
    hands_off_to: list[str] = []
    max_turns: int = 8

    #: The skills under `packages/skills/` that specify this agent's behaviour,
    #: in the order they are presented to the model. CLAUDE.md: "Skills are the
    #: specification. Code implements them. Prompts point at them." Pointing at
    #: a file the model was never given is not pointing at it, so the Rules and
    #: Boundaries of every skill named here travel with the system prompt.
    #:
    #: More than one is allowed because some agents genuinely implement more
    #: than one specification — the Image Agent writes the brief AND renders it.
    #: Forcing a single choice there would leave half its behaviour unspecified.
    skills: list[str] = []

    def __init__(self, brain: Brain, overrides: dict[str, Any] | None = None) -> None:
        if not self.agent_id:
            raise ValueError(f"{type(self).__name__} must declare an agent_id.")
        self.brain = brain
        self.config = Config(self.agent_id, overrides)
        self.folder = Path(__file__).resolve().parent.parent / "agents" / self.agent_id
        # Resolved from this file rather than the working directory: the agents
        # are spawned as a subprocess from the Node tier, and a cwd-relative
        # path would bind whichever directory the API happened to be started in.
        self.skills_dir = Path(__file__).resolve().parent.parent.parent / "packages" / "skills"
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

    # ── The skill specification ────────────────────────────────────────────

    @staticmethod
    def _section(body: str, heading: str) -> str:
        """
        One `## <heading>` section of a SKILL.md, without its heading line.

        Returns an empty string when the section is absent, which the caller
        reports rather than silently accepting — a skill whose Rules cannot be
        found would otherwise reach the model as an agent with no rules at all.
        """
        lines = body.splitlines()
        target = f"## {heading}".lower()
        out: list[str] = []
        collecting = False
        for line in lines:
            if line.strip().lower() == target:
                collecting = True
                continue
            if collecting and line.startswith("## "):
                break
            if collecting:
                out.append(line)
        return "\n".join(out).strip()

    def skill_specification(self) -> str:
        """
        The Rules and Boundaries of every declared skill, as one block.

        Only those two sections: CLAUDE.md names them the requirements document.
        Purpose, Inputs and Outputs describe the contract the code already
        implements, and sending them too would spend context restating what the
        tool signatures state exactly.
        """
        blocks: list[str] = []
        for skill in self.skills:
            path = self.skills_dir / skill / "SKILL.md"
            if not path.exists():
                raise FileNotFoundError(
                    f"{self.agent_id} declares the skill '{skill}', but "
                    f"{path} does not exist. The skill is the specification, so a "
                    "missing one means this agent has no stated rules. Add the file "
                    "or correct the `skills` declaration."
                )
            body = path.read_text(encoding="utf-8")
            rules = self._section(body, "Rules")
            boundaries = self._section(body, "Boundaries")
            if not rules and not boundaries:
                raise ValueError(
                    f"{path} carries neither a `## Rules` nor a `## Boundaries` "
                    "section. Those two sections are the requirements document; "
                    "without them the file specifies nothing."
                )
            parts = [f"## Skill · {skill}"]
            if rules:
                parts.append(f"### Rules\n\n{rules}")
            if boundaries:
                parts.append(f"### Boundaries\n\n{boundaries}")
            blocks.append("\n\n".join(parts))
        return "\n\n".join(blocks)

    def system_prompt(self) -> str:
        """
        Assembled from the folder, every run. The instructions and the tool
        contract travel with the prompt, so the model cannot act on a stale
        copy of either.

        The skill comes FIRST and says so, because CLAUDE.md makes it the
        authority: "Any conflict between a skill and anything else — this file
        included — the skill wins." Ordering the prompt the other way round
        would state the opposite precedence to the model.
        """
        settings = "\n".join(f"  {k} = {v}" for k, v in self.config.used().items())
        specification = self.skill_specification()
        skill_block = (
            f"---\n\n# Specification\n\n"
            "The following is the behavioural specification for your work, taken "
            "from the skill files that define this role. Where anything below in "
            "this prompt appears to conflict with it, the specification wins.\n\n"
            f"{specification}\n\n"
            if specification
            else ""
        )
        return (
            f"{self._read('prompt.md')}\n\n"
            f"{skill_block}"
            f"---\n\n# Instructions\n\n{self._read('instructions.md')}\n\n"
            f"---\n\n# Tools\n\n{self._read('tools.md')}\n\n"
            f"---\n\n# Resolved settings for this run\n\n{settings or '  (none declared)'}\n\n"
            "Every number you need is above. Never invent one, and never use a "
            "number that is not listed here.\n\n"
            "---\n\n# How this run reaches you\n\n"
            "You are running inside a pipeline, not a conversation. Nobody is "
            "reading this and nobody will answer a question, so a reply that "
            "asks for input ends your turn having produced nothing.\n\n"
            "The evidence is already captured and already loaded. Your tools "
            "read it directly: they operate on this run's real data, and the "
            "ones that need the corpus already hold it. That is why they do not "
            "ask you to pass it — you could only pass your memory of it, and "
            "your memory of evidence is not evidence.\n\n"
            "So call your tools. The task below states what was captured in "
            "counts, not contents; the contents are behind the tools. If a tool "
            "comes back empty, say so plainly and name what was missing — an "
            "honest empty result is a correct answer, and asking for the data "
            "again is not."
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
            # An agent must be able to call each tool it holds at least once,
            # plus a few turns to read the results and answer. A flat cap did
            # not survive contact with the roster: the Image Agent carries nine
            # tools against a cap of eight, so its instructions asked for a
            # sequence it could not finish, and it reported a turn cap instead
            # of a creative. The declared `max_turns` stays a floor an agent
            # may raise, never a ceiling below its own toolset.
            turns = max(self.max_turns, len(tools) + 3)
            reasoning = run_loop(
                system=self.system_prompt(),
                task=self.task(payload),
                tools=tools,
                max_turns=turns,
            )
            output = self.finalise(reasoning, payload)

            result = AgentResult(
                agent_id=self.agent_id,
                status="completed",
                payload=output,
                summary=self._summary_for(reasoning, output),
                tool_calls=[turn.tool for turn in reasoning.turns],
                injection_attempts=self._injection,
                source=SourceMode.LIVE if reasoning.used_model else SourceMode.FIXTURE,
                fallback_reason=reasoning.fallback_reason,
                duration_ms=int((time.monotonic() - started) * 1000),
                # Recorded so the run stays replayable: `agent_runs.config_used`
                # is written from this, and it is what lets a past run be
                # explained after the knobs have moved on.
                config_used=self.config.used(),
                provider=reasoning.provider,
                model=reasoning.model,
                degraded_from=reasoning.degraded_from,
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
                # A failed agent still records what it was configured to do. That
                # is often the most useful thing about it.
                config_used=self.config.used(),
            )

    def _summary_for(self, reasoning: Reasoning, output: dict[str, Any]) -> str:
        """
        What the run produced, in one sentence.

        The model's own words are preferred — they name the evidence it saw.
        But running out of turns is a fact about the loop, not a report on the
        work: the deterministic path still filled the payload, and answering
        "reached the turn cap" would hide a complete result behind a message
        about the machinery. So the cap is appended to the real summary rather
        than substituted for it.
        """
        text = reasoning.text.strip()
        if text and text != TURN_CAP_TEXT:
            return text
        settled = self.summarise(output)
        if text == TURN_CAP_TEXT and settled:
            return f"{settled} (The model reached its turn cap; this is the settled result.)"
        return settled or text

    # ── Shared helpers ─────────────────────────────────────────────────────

    def recall(self, topic: str, limit: int = 6) -> list[dict[str, Any]]:
        """The brain's read path. Every agent grounds through this, not a query."""
        return [
            {"id": e.id, "title": e.title, "content": e.content, "confidence": e.confidence.value}
            for e in self.brain.recall(topic, limit=limit)
        ]

    def note_injection(self, attempts: list[InjectionAttempt]) -> None:
        self._injection.extend(attempts)
