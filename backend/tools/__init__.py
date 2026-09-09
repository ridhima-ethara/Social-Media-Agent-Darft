"""
THE TOOL SURFACE

Deterministic functions the agents call. The model decides *which* and *when*;
these decide *what the answer is* — so reasoning stays flexible while
arithmetic stays reproducible and auditable.

No tool reasons. No tool calls a model. Every scoring tool returns its inputs
alongside its output, so a verdict can always be re-derived.
"""

from .scoring import (
    consolidate_hashtags,
    rank_hashtags,
    route_verdict,
    score_keywords,
    similarity_check,
)
from .sources import (
    available_sources,
    fetch_posts,
    harvest_hashtags,
)
from .content import (
    check_brand_voice,
    derive_hashtags,
    draft_caption,
)
from .planning import (
    place_ideas,
    rank_ideas,
)

__all__ = [
    "available_sources", "fetch_posts", "harvest_hashtags",
    "score_keywords", "rank_hashtags", "route_verdict", "consolidate_hashtags", "similarity_check",
    "draft_caption", "check_brand_voice", "derive_hashtags",
    "place_ideas", "rank_ideas",
]
