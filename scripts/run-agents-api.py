"""
DRIVE THE PIPELINE THROUGH THE API, AND HOLD THE CONNECTION

`POST /api/agents/run` answers with an SSE stream and kills the agent process
when the client disconnects — deliberately, so closing the Run Console does not
leave an orphaned run writing to the database. That makes the client's lifetime
the run's lifetime, which a shell backgrounding a `curl` does not reliably
provide: the curl dies with its shell and takes the run with it.

So this holds the socket open in a process of its own and prints each frame as
it arrives. It is the same request the web app makes; the difference is only
that nothing here hangs up early.

    backend/.venv/bin/python -u scripts/run-agents-api.py "agentic AI"
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request

API = "http://127.0.0.1:4001/api/agents/run"


def main(argv: list[str]) -> int:
    keywords = argv[1:] or ["agentic AI"]
    body = json.dumps({"keywords": keywords}).encode()
    request = urllib.request.Request(
        API, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )

    print(f"POST {API}  keywords={keywords}", flush=True)
    started = time.time()
    stamp = lambda: f"t+{time.time() - started:6.1f}s"  # noqa: E731

    # No read timeout: an agent that thinks for four minutes is working, not
    # hung, and a timeout here would disconnect the client and kill the run.
    with urllib.request.urlopen(request, timeout=None) as stream:
        event = ""
        for raw in stream:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith("event: "):
                event = line[7:]
                continue
            if not line.startswith("data: "):
                continue
            try:
                frame = json.loads(line[6:])
            except json.JSONDecodeError:
                continue

            if event == "stderr":
                continue
            name = frame.get("name") or frame.get("agent_id") or ""
            if event == "workflow.started":
                print(f"{stamp()}  order: {' → '.join(frame.get('agents', []))}", flush=True)
            elif event == "agent.started":
                print(f"{stamp()}  ▶ {name}", flush=True)
            elif event == "agent.finished":
                mark = "✗" if frame.get("status") == "failed" else "✓"
                secs = frame.get("duration_ms", 0) / 1000
                summary = " ".join(str(frame.get("summary", "")).split())[:150]
                print(f"{stamp()}  {mark} [{secs:6.1f}s] {name}: {summary}", flush=True)
            elif event == "agents.persisted":
                print(f"{stamp()}  ⤓ persisted: {json.dumps(frame)[:180]}", flush=True)
            elif event == "workflow.finished":
                print(
                    f"{stamp()}  ══ {frame.get('status')} · {frame.get('agents_run')} agents · "
                    f"model={frame.get('used_model')} · posts={frame.get('posts_captured')} · "
                    f"ideas={frame.get('ideas_on_calendar')} · images={frame.get('images_rendered')}",
                    flush=True,
                )
            elif event in {"workflow.failed", "error", "agents.persist_failed"}:
                print(f"{stamp()}  !! {event}: {json.dumps(frame)[:300]}", flush=True)
            elif event == "end":
                print(f"{stamp()}  stream closed (exit {frame.get('code')})", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
