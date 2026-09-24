"""
RUN THE EIGHT AGENTS LOCALLY, WITH THE LOCAL BINDINGS

The same workflow the API drives, run straight from the repo root so it can be
watched. Its whole reason to exist is that the Python tier reads `os.environ`
and nothing else: the server passes its own environment to the child it spawns,
so a standalone run has no environment at all unless something loads one.

That "something" is here rather than in `core/`, deliberately. An agent that
loaded a `.env` of its own would resolve config differently depending on who
started it, and `skill_runs.config_used` would stop being the whole truth about
a run. This is a developer entry point; the agents stay environment-pure.

    backend/.venv/bin/python -u scripts/run-agents-local.py "agentic AI" "AI evaluation"
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / "server" / ".env")

from core import llm  # noqa: E402
from tools import sources  # noqa: E402
from workflows.social_media_workflow import hand_off_order, run_workflow  # noqa: E402


def main(argv: list[str]) -> int:
    keywords = argv[1:] or ["agentic AI", "AI evaluation"]

    print("═" * 72)
    print(f"  model     : {llm.active_provider()} · {llm.active_model()}")
    print(f"  capture   : crawl4ai {'ready' if sources._crawl4ai_configured() else 'NOT INSTALLED'}")
    print(f"  order     : {' → '.join(hand_off_order())}")
    print(f"  keywords  : {', '.join(keywords)}")
    print("═" * 72, flush=True)

    started = time.time()

    # Each agent announces itself as it starts and reports what it produced as
    # it finishes — the same two frames the SSE stream carries, so watching this
    # and watching the Run Console show the same run.
    def on_event(event: str, frame: dict) -> None:
        if event == "agent.started":
            print(f"\n▶ {frame.get('name', frame.get('agent_id'))}", flush=True)
        elif event == "agent.finished":
            mark = "✗" if frame.get("status") == "failed" else "✓"
            elapsed = frame.get("duration_ms", 0) / 1000
            print(f"{mark} [{elapsed:5.1f}s] {frame.get('summary', '')}", flush=True)

    run = run_workflow(keywords, on_event=on_event)
    summary = run.summary()

    print("\n" + "═" * 72)
    print(f"  {summary['status'].upper()} in {time.time() - started:.0f}s · {summary['agents_run']} agents")
    print(f"  used a model    : {summary['used_model']}")
    print(f"  posts captured  : {summary['posts_captured']}")
    print(f"  keywords trending: {summary['keywords_trending']}")
    print(f"  hashtags        : {summary['hashtags_consolidated']}")
    print(f"  calendar        : {summary['ideas_on_calendar']} topics placed · {summary['ideas_not_placed']} not placed")
    print(f"  images rendered : {summary['images_rendered']}")
    print(f"  knowledge       : {summary['knowledge_learned']} learned · "
          f"{summary['knowledge_merged']} merged · {summary['knowledge_withheld']} withheld")
    print(f"  injection attempts: {summary['injection_attempts']}")
    print("═" * 72)

    return 1 if summary["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
