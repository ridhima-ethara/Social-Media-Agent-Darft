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
    post_ready_dates,
    rank_ideas,
)
from .imagery import (
    check_forbidden_imagery,
    check_logo_clear_space,
    check_option_distinctness,
    check_palette,
    check_visual_compliance,
    check_visual_similarity,
    compose_prompt,
    derive_concept,
    derive_options,
    has_quantitative_evidence,
    render_image,
    resolve_placement,
    write_alt_text,
)
from .painter import (
    is_configured as painter_configured,
    paint_background,
    unavailable_reason as painter_unavailable_reason,
)
from .learning import (
    consolidate,
    detect_patterns,
    distil_requests,
)

__all__ = [
    "available_sources", "fetch_posts", "harvest_hashtags",
    "score_keywords", "rank_hashtags", "route_verdict", "consolidate_hashtags", "similarity_check",
    "draft_caption", "check_brand_voice", "derive_hashtags",
    "place_ideas", "rank_ideas", "post_ready_dates",
    "derive_concept", "derive_options", "compose_prompt", "render_image", "write_alt_text",
    "check_visual_compliance", "check_visual_similarity", "check_option_distinctness",
    "check_forbidden_imagery", "check_palette", "check_logo_clear_space",
    "resolve_placement", "has_quantitative_evidence",
    "distil_requests", "detect_patterns", "consolidate",
    "paint_background", "painter_configured", "painter_unavailable_reason",
]
