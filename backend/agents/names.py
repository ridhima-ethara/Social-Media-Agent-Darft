"""Canonical display identities for the Python agent workflow.

Machine IDs, folder names, hand-off keys, and storage keys remain stable. Only
operator-facing labels come from this map, keeping the CLI/API roster and run
events aligned with the shared TypeScript registry.
"""

from __future__ import annotations

from typing import TypedDict


class AgentIdentity(TypedDict):
    name: str
    role: str
    icon: str


#: Names carry no emoji. The icon is a semantic id the UI resolves to a real
#: glyph, because the emoji budget is zero and a platform that strips emoji from
#: captions while labelling its own agents with them holds two standards at once.
AGENT_IDENTITIES: dict[str, AgentIdentity] = {
    "scraping_agent": {"name": "Sherlock", "role": "Scraping Agent", "icon": "search"},
    "validation_agent": {"name": "Dexter", "role": "Validation Agent", "icon": "flask"},
    "calendar_agent": {"name": "Dora", "role": "Calendar Agent", "icon": "calendar"},
    "content_agent": {"name": "SpongeBob", "role": "Content Agent", "icon": "pen"},
    "image_agent": {"name": "Minnie", "role": "Image Agent", "icon": "palette"},
    "publishing_agent": {"name": "Mickey", "role": "Publishing Agent", "icon": "send"},
    "analytics_agent": {"name": "Jerry", "role": "Analytics Agent", "icon": "bar-chart"},
    "learning_agent": {"name": "Velma", "role": "Learning Agent", "icon": "graduation"},
}


def identity_for(agent_id: str) -> AgentIdentity:
    """Return one declared identity; an unknown workflow agent is a defect."""
    try:
        return AGENT_IDENTITIES[agent_id]
    except KeyError as error:
        raise ValueError(f"No display identity declared for {agent_id}.") from error
