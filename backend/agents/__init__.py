"""
THE AGENT ROSTER

One folder per agent. Each carries agent.py · prompt.md · instructions.md ·
tools.md · schema.py — the specification and the implementation in one place.

The order below is the hand-off order, derived from each agent's `hands_off_to`
and asserted by the workflow.
"""

from .research_agent.agent import ResearchAgent
from .validation_agent.agent import ValidationAgent
from .calendar_agent.agent import CalendarAgent
from .content_agent.agent import ContentAgent
from .publishing_agent.agent import PublishingAgent
from .analytics_agent.agent import AnalyticsAgent

ROSTER = [
    ResearchAgent,
    ValidationAgent,
    CalendarAgent,
    ContentAgent,
    PublishingAgent,
    AnalyticsAgent,
]

AGENT_BY_ID = {cls.agent_id: cls for cls in ROSTER}

__all__ = [
    "ROSTER", "AGENT_BY_ID",
    "ResearchAgent", "ValidationAgent", "CalendarAgent",
    "ContentAgent", "PublishingAgent", "AnalyticsAgent",
]
