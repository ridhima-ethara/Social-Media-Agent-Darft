"""
THE AGENT ROSTER

One folder per agent. Each carries agent.py · prompt.md · instructions.md ·
tools.md · schema.py — the specification and the implementation in one place.

The order below is the hand-off order, derived from each agent's `hands_off_to`
and asserted by the workflow. There is no research agent: the Scraping Agent
does the research against the keywords it is given. There is no knowledge
agent either — the Knowledge Base is the brain, not a participant, and the
Learning Agent is what grows it.
"""

from .scraping_agent.agent import ScrapingAgent
from .validation_agent.agent import ValidationAgent
from .calendar_agent.agent import CalendarAgent
from .content_agent.agent import ContentAgent
from .image_agent.agent import ImageAgent
from .publishing_agent.agent import PublishingAgent
from .analytics_agent.agent import AnalyticsAgent
from .learning_agent.agent import LearningAgent

ROSTER = [
    ScrapingAgent,
    ValidationAgent,
    CalendarAgent,
    ContentAgent,
    ImageAgent,
    PublishingAgent,
    AnalyticsAgent,
    LearningAgent,
]

AGENT_BY_ID = {cls.agent_id: cls for cls in ROSTER}

__all__ = [
    "ROSTER", "AGENT_BY_ID",
    "ScrapingAgent", "ValidationAgent", "CalendarAgent", "ContentAgent",
    "ImageAgent", "PublishingAgent", "AnalyticsAgent", "LearningAgent",
]
