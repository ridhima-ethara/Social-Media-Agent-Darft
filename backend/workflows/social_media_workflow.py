"""
THE SOCIAL MEDIA WORKFLOW

Runs the agents in hand-off order, threading one payload through them. The
order is **derived** from each agent's `hands_off_to`, never written down as a
list — if the order is wrong, the graph is wrong, and that is where to fix it.

    Scraping → Validation → Calendar → Content → Image → Publishing
                    │                                          │
                    │                                     Analytics
                    │                                          │
                    │                                     Learning
                    │                                          │
                    └───────────── the Brain ──────────────────┘
                       read before every act, grown after every outcome

The Brain is not an agent. It is the shared memory every agent reads from,
which is what makes the next run better than the last.

Two ends of the loop are worth naming, because the value of the whole thing
sits in the fact that they meet:

    Scraping  is also the research. There is no separate research agent — the
              keywords are the question and the sources are the answer.

    Learning  is what closes the circle. It reads what the operator asked for
              in the assistant and what the audience did with what shipped,
              and writes both into the Brain. Everything upstream then reads
              it: the Calendar Agent places on it, the Content Agent writes
              under it, the Image Agent draws under it.

So the pipeline is not a line that runs once. What comes out of the end
changes what happens at the start of the next run, with no code edited in
between — that is the entire point of the Brain sitting where it does.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents import ROSTER, AGENT_BY_ID  # noqa: E402
from core.agent import Agent  # noqa: E402
from core.brain import Brain  # noqa: E402
from core.schema import AgentResult, utcnow  # noqa: E402


def hand_off_order(roster: list[type[Agent]] | None = None) -> list[str]:
    """
    Topological sort over `hands_off_to`.

    Derived, so adding an agent means declaring who it hands to — not editing a
    sequence in two places and hoping they agree.
    """
    roster = roster or ROSTER
    ids = [cls.agent_id for cls in roster]
    indegree = {agent_id: 0 for agent_id in ids}

    for cls in roster:
        for target in cls.hands_off_to:
            if target in indegree:
                indegree[target] += 1

    ready = [agent_id for agent_id in ids if indegree[agent_id] == 0]
    order: list[str] = []

    while ready:
        agent_id = ready.pop(0)
        order.append(agent_id)
        for target in AGENT_BY_ID[agent_id].hands_off_to:
            if target not in indegree:
                continue
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)

    if len(order) != len(ids):
        unresolved = [a for a in ids if a not in order]
        raise ValueError(
            f"The hand-off graph has a cycle: {', '.join(unresolved)} cannot be ordered. "
            "Fix `hands_off_to`, not the workflow."
        )
    return order


class WorkflowRun:
    """One execution. Carries the payload, the results, and the running narrative."""

    def __init__(self) -> None:
        self.started_at = utcnow()
        self.payload: dict[str, Any] = {}
        self.results: list[AgentResult] = []
        self.narrative: list[str] = []

    @property
    def failed(self) -> AgentResult | None:
        return next((r for r in self.results if r.status == "failed"), None)

    def summary(self) -> dict[str, Any]:
        injections = sum(len(r.injection_attempts) for r in self.results)
        return {
            "started_at": self.started_at,
            "finished_at": utcnow(),
            "agents_run": len(self.results),
            "status": "failed" if self.failed else "completed",
            "duration_ms": sum(r.duration_ms for r in self.results),
            "used_model": any(r.source.value == "live" for r in self.results),
            "injection_attempts": injections,
            "narrative": self.narrative,
            "posts_captured": self.payload.get("post_count", 0),
            "keywords_trending": len(self.payload.get("trending", [])),
            "hashtags_consolidated": len(self.payload.get("top_hashtags", [])),
            "ideas_on_calendar": self.payload.get("primary_count", 0),
            "ideas_in_suggestions": self.payload.get("suggestion_count", 0),
            "images_rendered": 1 if self.payload.get("asset", {}).get("data_uri") else 0,
            "published": bool(self.payload.get("published")),
            # What the run added to what the platform knows. `learned` counts
            # entries actually written; `merged` folded into an existing entry;
            # `withheld` is what did not clear the evidence floor and was kept
            # out rather than padded into place.
            "knowledge_learned": len(self.payload.get("written", [])),
            "knowledge_merged": len(self.payload.get("merged", [])),
            "knowledge_withheld": len(self.payload.get("discarded", [])),
        }

    def artefacts(self) -> dict[str, Any]:
        """
        The things themselves, not the count of them.

        `summary()` says four ideas took a calendar slot. This carries the four
        ideas. The API tier writes them to Postgres, and the UI renders from
        Postgres — never from the event stream — so anything missing from here
        is something an operator will never see, however loudly the run
        reported it.

        A halted run still returns what the agents that did run produced.
        Partial and labelled beats complete and invented.
        """
        return {
            "keywords": self.payload.get("keywords", []),
            "keywords_scored": self.payload.get("keywords_scored", []),
            "trending": self.payload.get("trending", []),
            "ranked_hashtags": self.payload.get("ranked_hashtags", []),
            "top_hashtags": self.payload.get("top_hashtags", []),
            "ranked_ideas": self.payload.get("ranked_ideas", []),
            "review_queue": self.payload.get("review_queue", []),
            "status": "failed" if self.failed else "completed",
        }


def run_workflow(
    keywords: list[str],
    brain: Brain | None = None,
    overrides: dict[str, dict[str, Any]] | None = None,
    on_event: Callable[[str, dict[str, Any]], None] | None = None,
    stop_after: str | None = None,
    seed: dict[str, Any] | None = None,
) -> WorkflowRun:
    """
    Runs the pipeline end to end.

    Each agent receives the accumulated payload and contributes to it — which is
    how a hand-off works: the Validation Agent sees exactly what the Scraping
    Agent captured, and nothing is passed around out of band.

    `seed` is what the run cannot discover for itself: the assistant transcript
    and the published posts with their measured engagement. Both are inputs to
    the Learning Agent, and neither is produced anywhere in this pipeline — the
    operator typed one and the platforms reported the other. Without a way in,
    the Learning Agent would read an empty transcript on every run and correctly
    report that it had learned nothing, forever.

    Seeded keys never overwrite what an agent produces; agents run after the
    seed is laid down and update over it.

    A failed agent halts the run. What ran before it stands and is reported;
    nothing is rolled back, because a partial run that lies about being complete
    is worse than one that stops and says so.
    """
    brain = brain or Brain()
    overrides = overrides or {}
    run = WorkflowRun()
    run.payload = {"keywords": keywords, **(seed or {})}

    order = hand_off_order()
    if stop_after and stop_after in order:
        order = order[: order.index(stop_after) + 1]

    emit = on_event or (lambda event, data: None)
    emit("workflow.started", {
        "agents": order,
        "keywords": keywords,
        "seeded": sorted(seed or {}),
    })

    for agent_id in order:
        agent_class = AGENT_BY_ID[agent_id]
        agent = agent_class(brain=brain, overrides=overrides.get(agent_id))

        emit("agent.started", {"agent_id": agent_id, "name": agent.name, "stage": agent.stage})
        started = time.monotonic()
        result = agent.run(run.payload)
        result.duration_ms = result.duration_ms or int((time.monotonic() - started) * 1000)

        run.results.append(result)
        run.payload.update(result.payload)

        line = f"{agent.name}: {result.summary}"
        run.narrative.append(line)
        emit("agent.finished", {
            "agent_id": agent_id,
            "status": result.status,
            "summary": result.summary,
            "tool_calls": result.tool_calls,
            "source": result.source.value,
            "duration_ms": result.duration_ms,
            "injection_attempts": len(result.injection_attempts),
        })

        if result.status == "failed":
            emit("workflow.failed", {"agent_id": agent_id, "error": result.error})
            break

    # Output before finished: the API tier persists what is in this frame, and
    # `workflow.finished` should mean the run is over — including the writing.
    emit("workflow.output", run.artefacts())
    emit("workflow.finished", run.summary())
    return run


def main() -> int:
    """`python backend/workflows/social_media_workflow.py [keyword ...]`"""
    import json

    keywords = sys.argv[1:] or [
        "reinforcement learning", "RLHF", "reward modeling", "agentic AI", "AI evaluation",
    ]

    def log(event: str, data: dict[str, Any]) -> None:
        if event == "agent.started":
            print(f"\n  ▸ {data['name']}  ({data['stage']})")
        elif event == "agent.finished":
            mark = "✓" if data["status"] == "completed" else "✗"
            tools = ", ".join(data["tool_calls"]) or "none"
            print(f"    {mark} {data['summary']}")
            print(f"      tools: {tools}  ·  {data['source']}  ·  {data['duration_ms']}ms")
            if data["injection_attempts"]:
                print(f"      ⚠ {data['injection_attempts']} injection attempt(s) reported, not followed")

    print("\nEthara SocialAI · agentic workflow")
    print(f"  keywords: {', '.join(keywords)}")

    run = run_workflow(keywords, on_event=log)
    summary = run.summary()

    print("\n  ── summary ──")
    for key in ("status", "agents_run", "posts_captured", "keywords_trending",
                "hashtags_consolidated", "ideas_on_calendar", "ideas_in_suggestions",
                "images_rendered", "knowledge_learned", "knowledge_merged",
                "knowledge_withheld", "used_model", "injection_attempts", "duration_ms"):
        print(f"    {key:24} {summary[key]}")

    Path("backend/data").mkdir(parents=True, exist_ok=True)
    Path("backend/data/last_run.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("\n  wrote backend/data/last_run.json\n")
    return 0 if summary["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
