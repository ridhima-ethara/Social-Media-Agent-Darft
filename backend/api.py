"""
THE BRIDGE

A line-delimited JSON interface, so the Node API can run the workflow and
stream its events without a second HTTP server or a shared runtime.

    python backend/api.py run --keywords "a,b,c"    # NDJSON events on stdout
    python backend/api.py brain                     # the Knowledge Base
    python backend/api.py agents                    # the roster and its contracts
    python backend/api.py last                      # the last run's summary

Every line on stdout is one JSON object. Errors go to stderr, so a caller can
always parse stdout without guarding for prose.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agents import ROSTER  # noqa: E402
from core.brain import Brain  # noqa: E402
from core.config import REGISTRY  # noqa: E402
from core.llm import is_configured, unavailable_reason  # noqa: E402
from workflows.social_media_workflow import hand_off_order, run_workflow  # noqa: E402


def emit(event: str, data: dict) -> None:
    print(json.dumps({"event": event, **data}, default=str), flush=True)


def cmd_run(args: argparse.Namespace) -> int:
    keywords = [k.strip() for k in (args.keywords or "").split(",") if k.strip()]
    if not keywords:
        emit("error", {"message": "No keywords supplied. Pass --keywords 'a,b,c'."})
        return 1

    overrides = json.loads(args.overrides) if args.overrides else {}
    run = run_workflow(
        keywords,
        brain=Brain(args.brain) if args.brain else None,
        overrides=overrides,
        on_event=emit,
        stop_after=args.stop_after,
    )
    return 0 if run.summary()["status"] == "completed" else 1


def cmd_brain(args: argparse.Namespace) -> int:
    brain = Brain(args.brain) if args.brain else Brain()
    entries = [e.model_dump() for e in brain._entries]  # noqa: SLF001 — the CLI is the store's own surface
    emit("brain", {"entries": entries, "stats": brain.stats()})
    return 0


def cmd_agents(_: argparse.Namespace) -> int:
    """The roster, its contracts, and every declared knob — the UI renders from this."""
    emit("agents", {
        "order": hand_off_order(),
        "model": {"configured": is_configured(), "reason": unavailable_reason()},
        "agents": [
            {
                "id": cls.agent_id,
                "name": cls.name,
                "stage": cls.stage,
                "hands_off_to": cls.hands_off_to,
                "folder": f"backend/agents/{cls.agent_id}/",
                "files": ["agent.py", "prompt.md", "instructions.md", "tools.md", "schema.py"],
                "knobs": [k.model_dump() for k in REGISTRY.get(cls.agent_id, [])],
            }
            for cls in ROSTER
        ],
    })
    return 0


def cmd_last(_: argparse.Namespace) -> int:
    path = Path("backend/data/last_run.json")
    if not path.exists():
        emit("error", {"message": "No run has been recorded yet."})
        return 1
    emit("last_run", json.loads(path.read_text(encoding="utf-8")))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Ethara SocialAI agent backend")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run the workflow, streaming NDJSON events")
    run.add_argument("--keywords", required=True)
    run.add_argument("--overrides", help="JSON: {agent_id: {knob: value}}")
    run.add_argument("--stop-after", dest="stop_after")
    run.add_argument("--brain")
    run.set_defaults(handler=cmd_run)

    brain = sub.add_parser("brain", help="Dump the Knowledge Base")
    brain.add_argument("--brain")
    brain.set_defaults(handler=cmd_brain)

    sub.add_parser("agents", help="The roster and its contracts").set_defaults(handler=cmd_agents)
    sub.add_parser("last", help="The last run's summary").set_defaults(handler=cmd_last)

    args = parser.parse_args()
    try:
        return args.handler(args)
    except Exception as error:  # noqa: BLE001 — reported as JSON, never as a traceback on stdout
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        emit("error", {"message": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
