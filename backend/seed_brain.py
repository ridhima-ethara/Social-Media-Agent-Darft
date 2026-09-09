"""
SEEDING THE BRAIN

The brand definition and what the platform has already learned. These live in
the same store as every researched finding, which is what makes switching one
off genuinely change what the agents produce.

Brand entries are definitional, so they carry no citation floor. Learned and
researched entries do — an uncited claim never enters the store.

    python backend/seed_brain.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.brain import Brain  # noqa: E402
from core.schema import Citation, Confidence, MemoryEntry  # noqa: E402

BRAND: list[tuple[str, str, str]] = [
    ("Positioning",
     "Ethara is a frontier AI research lab, not a startup pitching a product. Write as a lab "
     "publishing its method, not a vendor announcing a feature.",
     "Brand Voice"),
    ("Voice words",
     "Research-credible, anti-hype, confident, declarative, plain natural English. Every claim "
     "carries the number it rests on.",
     "Brand Voice"),
    ("Emoji budget is zero",
     "No emoji on any platform. The budget is zero and no setting raises it. Enforcement strips "
     "rather than warns.",
     "Brand Guideline"),
    ("Hashtags are three to five",
     "Three to five topic-derived hashtags on every platform. Generic reach-bait tags are excluded "
     "by rule, not by score.",
     "Brand Guideline"),
    ("Caption structure",
     "Hook, Context, Problem, Reframe, Mechanism, Evidence, Implication, Ethara connection, Close. "
     "Which stages appear depends on platform depth; the order never changes.",
     "Brand Guideline"),
    ("No unannounced claims",
     "Never mention unannounced funding, partnerships, customers, hires, unpublished figures, legal "
     "positions or competitor comparisons. Any hit forces internal approval.",
     "Compliance Rule"),
    ("No silent correction",
     "The brand checker reports and offers; it never rewrites behind the operator's back. A human "
     "instruction always outranks a brand guideline — apply it and raise the finding alongside it.",
     "Compliance Rule"),
]

LEARNED: list[tuple[str, str, list[Citation]]] = [
    ("Open with the counter-intuitive claim",
     "Posts that open on what conventional practice gets wrong reach 22–31% above the trailing "
     "average. Posts that open on context sit at or below it. The correction is the hook.",
     [Citation(title="Q3 post performance review", url="https://ethara.ai/internal/q3-review"),
      Citation(title="Engagement analysis, 14 posts", url="https://analytics.ethara.ai/reports/hooks")]),
    ("Hard numbers belong in line two",
     "The three strongest posts of the last month all placed their strongest figure in the second "
     "line. Reshare quotes almost always contain that figure.",
     [Citation(title="Reshare quote analysis", url="https://analytics.ethara.ai/reports/reshares"),
      Citation(title="Top posts teardown", url="https://ethara.ai/internal/top-posts")]),
    ("Tuesday 10:30 is the strongest LinkedIn slot",
     "Median reach at Tuesday 10:30 over four weeks is 34% above the account average. Thursday "
     "09:00 is second. Two posts within six hours split reach rather than compounding it.",
     [Citation(title="Posting time study", url="https://analytics.ethara.ai/reports/timing"),
      Citation(title="LinkedIn platform analytics", url="https://linkedin.com/analytics/ethara")]),
    ("CTO segment responds to economics, not research",
     "The cost-per-solved-task post recorded the strongest CTO-segment engagement of the quarter. "
     "Research framings reach researchers; economics framings reach buyers.",
     [Citation(title="Audience segment breakdown", url="https://analytics.ethara.ai/reports/segments"),
      Citation(title="Buyer engagement study", url="https://ethara.ai/internal/buyers")]),
    ("Three-item lists complete; five-item lists do not",
     "On carousels, three-panel lists hold 71% of viewers to the final panel. Five-panel lists drop "
     "to 38%.",
     [Citation(title="Carousel completion rates", url="https://analytics.ethara.ai/reports/carousels"),
      Citation(title="Instagram insights export", url="https://instagram.com/insights/ethara")]),
]

RESEARCH: list[tuple[str, str, list[Citation]]] = [
    ("Process supervision generalises better than outcome reward",
     "Two independent replications report that step-level reward beats outcome-only reward on "
     "multi-step reasoning, at roughly 2.3x labelling cost. The gap widens with horizon length.",
     [Citation(title="Step-level reward modelling at scale", url="https://arxiv.org/abs/2501.04412"),
      Citation(title="Replication notes", url="https://www.interconnects.ai/p/process-supervision"),
      Citation(title="The Batch roundup", url="https://www.deeplearning.ai/the-batch/")]),
    ("Agent failures concentrate in the tool surface",
     "An analysis of 1,400 production agent traces attributes 62% of failures to tool contract "
     "issues — non-idempotent calls, unversioned schemas, unparseable errors — rather than to model "
     "reasoning.",
     [Citation(title="What breaks production agents", url="https://arxiv.org/abs/2502.11930"),
      Citation(title="Agent reliability field notes", url="https://importai.substack.com")]),
    ("Annotator disagreement predicts reward model error",
     "Preference pairs with low inter-annotator agreement are disproportionately the pairs on which "
     "the trained reward model later errs. Modelling the disagreement distribution improves "
     "robustness on ambiguous inputs.",
     [Citation(title="Disagreement-aware preference learning", url="https://arxiv.org/abs/2502.07741"),
      Citation(title="Annotation quality in RLHF", url="https://arxiv.org/abs/2501.12208")]),
    ("Model collapse requires an unverified loop",
     "Synthetic data degrades quality only under unverified self-sampling. With a verification "
     "signal in the loop, measured quality improves across at least six generations.",
     [Citation(title="Verification and synthetic data", url="https://arxiv.org/abs/2501.09877"),
      Citation(title="Revisiting model collapse", url="https://www.nature.com/articles/s41586-024-07566-y")]),
    ("Evaluation harnesses outlive the models they measure",
     "Organisations report evaluation suites surviving three or more model migrations, making them "
     "the longest-lived AI artefact in the stack. Contamination is now assumed, not tested for.",
     [Citation(title="Longevity of evaluation infrastructure", url="https://arxiv.org/abs/2502.01188"),
      Citation(title="Holdout rotation in practice", url="https://blog.eleuther.ai/holdout-rotation/")]),
]


def main() -> int:
    brain = Brain()
    counts = {"inserted": 0, "merged": 0, "discarded": 0}

    for title, content, category in BRAND:
        action, _, _ = brain.learn(MemoryEntry(
            title=title, category=category, content=content,
            origin="brand", confidence=Confidence.HIGH,
        ))
        counts[action] += 1

    for title, content, sources in LEARNED:
        action, _, reason = brain.learn(MemoryEntry(
            title=title, category="High Performer", content=content,
            origin="learned", sources=sources,
        ))
        counts[action] += 1
        if action == "discarded":
            print(f"  discarded: {reason}")

    for title, content, sources in RESEARCH:
        action, _, reason = brain.learn(MemoryEntry(
            title=title, category="Research", content=content,
            origin="research", sources=sources,
        ))
        counts[action] += 1
        if action == "discarded":
            print(f"  discarded: {reason}")

    stats = brain.stats()
    print(f"\n  Brain seeded — {counts['inserted']} inserted, {counts['merged']} merged, "
          f"{counts['discarded']} discarded")
    print(f"  {stats['total']} entries · {stats['active']} active · "
          f"{stats['high_confidence']} high-confidence · {stats['research']} researched\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
