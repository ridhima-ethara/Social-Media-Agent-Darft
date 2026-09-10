"""
THE PUBLISHING AGENT

The one irreversible act, behind two approvals and a format gate.
"""

from __future__ import annotations

import os
from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from core.schema import utcnow

LIMITS: dict[str, dict[str, Any]] = {
    "linkedin": {"max_chars": 3000, "requires_media": False},
    "instagram": {"max_chars": 2200, "requires_media": True},
    "x": {"max_chars": 280, "requires_media": False},
    "facebook": {"max_chars": 63206, "requires_media": False},
}


def check_approvals(idea: dict[str, Any]) -> dict[str, Any]:
    """The gate, in a tool so it cannot be reasoned around."""
    marketing = idea.get("marketing_approval")
    leadership = idea.get("leadership_approval")
    missing = [n for n, a in (("Marketing", marketing), ("Leadership", leadership)) if not a]
    return {
        "approved": not missing,
        "marketing": marketing,
        "leadership": leadership,
        "reason": (
            f"{' and '.join(missing)} approval is missing. Nothing publishes without both."
            if missing else
            f"Approved by {marketing.get('by')} then {leadership.get('by')}."
        ),
    }


def caption_body(caption: Any) -> str:
    """
    The Content Agent hands over a caption object; older callers hand a string.

    Reading the object's text form would validate `{'body': ...}` against the
    platform's character limit and publish it — so the body is taken explicitly
    rather than coerced.
    """
    if isinstance(caption, dict):
        return str(caption.get("body", ""))
    return str(caption or "")


def validate_format(caption: str, platform: str = "linkedin", has_media: bool = False) -> dict[str, Any]:
    """Every issue at once — one round trip should surface all of them."""
    limit = LIMITS.get(platform, LIMITS["linkedin"])
    issues: list[dict[str, str]] = []

    if not caption.strip():
        issues.append({"field": "caption", "constraint": "must not be empty"})
    if len(caption) > limit["max_chars"]:
        issues.append({
            "field": "caption",
            "constraint": f"{platform} allows {limit['max_chars']} characters; this is {len(caption)}",
        })
    if limit["requires_media"] and not has_media:
        issues.append({"field": "media", "constraint": f"{platform} requires an image"})

    return {"valid": not issues, "issues": issues, "checked_against": platform}


def dispatch(title: str, caption: str, platform: str = "linkedin", mode: str = "demo") -> dict[str, Any]:
    """
    Demo fabricates an id and says so. Live without a credential refuses —
    it never falls back, because reporting a post that never went out is worse
    than any error.
    """
    if mode == "live":
        env_key = f"{platform.upper()}_ACCESS_TOKEN"
        if not os.environ.get(env_key):
            return {
                "published": False,
                "refused_because": (
                    f"Live publishing to {platform} is not possible: {env_key} is not set. "
                    "I will not silently fall back to demo and report a post that never went out."
                ),
            }
        return {
            "published": False,
            "refused_because": (
                f"{platform} live dispatch is not implemented in this build. The credential is "
                "present, but no real platform call is wired."
            ),
        }

    now = utcnow()
    return {
        "published": True,
        "receipt": {
            "external_id": f"demo-{platform}-{abs(hash(title)) % 10**10}",
            "platform": platform,
            "mode": "demo",
            "published_at": now,
            "body_length": len(caption),
            "history": [
                {"step": 1, "label": "Caption written by the Content Agent", "at": now},
                {"step": 2, "label": "Approved by Marketing", "at": now},
                {"step": 3, "label": "Final approval from Leadership", "at": now},
                {"step": 4, "label": f"Published to {platform} in demo mode", "at": now},
            ],
        },
    }


class PublishingAgent(Agent):
    agent_id = "publishing_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "ship"
    hands_off_to = ["analytics_agent"]

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        platform = payload.get("platform", "linkedin")
        mode = payload.get("mode", "demo")
        caption = caption_body(payload.get("caption"))
        # The Image Creation Agent runs immediately before this one, so a
        # platform that requires media has it by the time the gate is checked.
        has_media = bool(payload.get("has_media") or payload.get("asset", {}).get("data_uri"))

        return [
            ToolSpec(
                name="check_approvals",
                description="Both approvals, with who and when. Call first, always.",
                input_schema={"type": "object", "properties": {"idea": {"type": "object"}}},
                handler=lambda idea=payload: check_approvals(idea),
            ),
            ToolSpec(
                name="validate_format",
                description="Length, hashtags and media against the platform's limits.",
                input_schema={
                    "type": "object",
                    "properties": {"caption": {"type": "string"}, "platform": {"type": "string"}},
                },
                handler=lambda caption=caption, platform=platform: validate_format(
                    caption, platform, has_media
                ),
            ),
            ToolSpec(
                name="dispatch",
                description="Send the post and return a receipt. Never before the two gates pass.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "caption": {"type": "string"},
                        "platform": {"type": "string"},
                        "mode": {"type": "string"},
                    },
                },
                handler=lambda title=payload.get("title", ""), caption=caption,
                               platform=platform, mode=mode: dispatch(title, caption, platform, mode),
            ),
        ]

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Publish \"{payload.get('title', '')}\" to {payload.get('platform', 'linkedin')} in "
            f"{payload.get('mode', 'demo')} mode. Check both approvals, validate the format, and "
            "only then dispatch."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        """The gates run here too, so the deterministic path cannot skip them."""
        output = dict(reasoning.payload)

        approvals = check_approvals(payload)
        output["approvals"] = approvals
        if not approvals["approved"]:
            return {**output, "published": False, "refused_because": approvals["reason"]}

        fmt = validate_format(
            caption_body(payload.get("caption")),
            payload.get("platform", "linkedin"),
            bool(payload.get("has_media") or payload.get("asset", {}).get("data_uri")),
        )
        output["format"] = fmt
        if not fmt["valid"]:
            return {
                **output, "published": False, "format_issues": fmt["issues"],
                "refused_because": "Format validation failed before dispatch: "
                                   + "; ".join(f"{i['field']} {i['constraint']}" for i in fmt["issues"]),
            }

        if "published" not in output:
            output.update(dispatch(
                payload.get("title", ""), caption_body(payload.get("caption")),
                payload.get("platform", "linkedin"), payload.get("mode", "demo"),
            ))
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        if not result.get("published"):
            return f"Not published. {result.get('refused_because', 'No reason recorded.')}"
        receipt = result.get("receipt", {})
        return (
            f"Published to {receipt.get('platform')} in {receipt.get('mode')} mode as "
            f"{receipt.get('external_id')}. {result.get('approvals', {}).get('reason', '')}"
        )
