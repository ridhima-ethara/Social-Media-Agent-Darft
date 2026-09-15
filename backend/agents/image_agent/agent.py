"""
THE IMAGE CREATION AGENT

Authors the image brief the caption has already decided on — twice.

It runs *after* the Content Agent and before Publishing, because the caption is
its brief: the headline on the creative restates the caption's hook, and a
visual that says something the caption does not is a defect (rule 1).

`packages/skills/image-brief/SKILL.md` asks for **two distinct briefs**, options
A and B, so that a human gate has something to choose between. This agent
authors both, measures how far apart they actually are, and renders the selected
one. It does not pick the winner — that is the gate's job, and a machine that
quietly chose would make the second option decoration.

The render itself is two layers — an optional model-painted background, and the
brand layer always drawn locally as vectors. No diffusion model is ever asked to
draw brand text, so a post is never shipped with a hallucinated headline.
"""

from __future__ import annotations

from typing import Any

from agents.names import identity_for
from core.agent import Agent
from core.llm import Reasoning, ToolSpec
from tools import (
    check_forbidden_imagery,
    check_option_distinctness,
    check_visual_compliance,
    check_visual_similarity,
    compose_prompt,
    derive_options,
    paint_background,
    render_image,
    resolve_placement,
    write_alt_text,
)


def _caption_body(caption: Any) -> str:
    """The Content Agent hands over a caption object; older callers hand a string."""
    if isinstance(caption, dict):
        return str(caption.get("body", ""))
    return str(caption or "")


class ImageAgent(Agent):
    agent_id = "image_agent"
    identity = identity_for(agent_id)
    name = identity["name"]
    role = identity["role"]
    icon = identity["icon"]
    stage = "create"
    hands_off_to = ["publishing_agent"]
    # `image-brief` specifies the two distinct briefs this agent derives — the
    # file its own docstring and schema already cite. `visual-rendering`
    # specifies what happens to a brief once it is painted, which this agent
    # also owns (`render_image`, `check_visual_compliance`). Both, in that order.
    skills = ["image-brief", "visual-rendering"]

    #: Entries that can legitimately change how a picture looks. A research
    #: finding does not belong here — it grounds the caption, not the canvas.
    #: `Human Directive` is here for the same reason it is on the Content
    #: Agent: an operator who said "stop using photographs" in the assistant
    #: was instructing the picture, and the instruction has to reach it.
    VISUAL_CATEGORIES = [
        "Visual Preference", "Brand Guideline", "High Performer",
        "Platform Preference", "Human Directive",
    ]

    _visual_knowledge: list[dict[str, Any]] = []
    _briefs: dict[str, Any] = {}
    _concept: dict[str, Any] = {}
    _background: dict[str, Any] = {}

    def prepare(self, payload: dict[str, Any]) -> None:
        """
        The brain is read first, always — before any tool closes over it.

        This is the join the Learning Agent feeds: an operator who said "never
        use a stock photo" in the assistant changed what this agent draws, and
        it changed here, without anyone editing this file.
        """
        topic = payload.get("topic", "")
        self._visual_knowledge = [
            {"id": e.id, "title": e.title, "content": e.content, "confidence": e.confidence.value}
            for e in self.brain.recall(
                f"{topic} image visual", limit=6, categories=self.VISUAL_CATEGORIES
            )
        ]

        caption = _caption_body(payload.get("caption"))
        platform = payload.get("platform", "linkedin")

        # Both briefs are authored here, before the tool loop, for the same
        # reason the recall is: the tools close over them, and briefs derived
        # inside the loop would be missing on the deterministic path — every
        # run would silently ship one option and call it a choice.
        self._briefs = derive_options(
            caption,
            payload.get("title", ""),
            topic,
            platform,
            self._visual_knowledge,
            self.config["headline_max_words"],
            placement=self.config["placement"],
            evidence=self._evidence(payload),
            locked=payload.get("locked", []),
            previous=payload.get("previous_brief") or None,
        )
        self._concept = self._selected()

        # The painter runs here too, and for the same reason: `render_image`
        # closes over the result, and a background painted inside the loop
        # would be missing on the deterministic path.
        self._background = self._paint(payload, platform)

    def tools(self, payload: dict[str, Any]) -> list[ToolSpec]:
        cfg = self.config
        platform = payload.get("platform", "linkedin")
        topic = payload.get("topic", "")
        caption = _caption_body(payload.get("caption"))

        return [
            ToolSpec(
                name="recall_visual_knowledge",
                description="What the store has learned about how our pictures should look. Call first.",
                input_schema={
                    "type": "object",
                    "properties": {"topic": {"type": "string"}, "limit": {"type": "integer"}},
                },
                handler=lambda topic=topic, limit=6: {"visual_knowledge": self._visual_knowledge},
            ),
            ToolSpec(
                name="derive_options",
                description=(
                    "Author the two distinct briefs, A and B. The visual type is chosen from the "
                    "evidence, so a chart is not offered when there is nothing to chart."
                ),
                input_schema={
                    "type": "object",
                    "properties": {"caption": {"type": "string"}, "platform": {"type": "string"}},
                },
                handler=lambda caption=caption, platform=platform: self._briefs,
            ),
            ToolSpec(
                name="check_option_distinctness",
                description=(
                    "How many visual dimensions the two briefs actually differ on, and how "
                    "similar they score. Computed, never estimated."
                ),
                input_schema={"type": "object", "properties": {}},
                handler=lambda: check_option_distinctness(
                    self._briefs.get("options", []),
                    cfg["similarity_cap"],
                    cfg["min_differing_dimensions"],
                ),
            ),
            ToolSpec(
                name="compose_background_prompt",
                description="The prompt for whichever painter is bound. Never asks for text or figures.",
                input_schema={
                    "type": "object",
                    "properties": {"concept": {"type": "string"}, "platform": {"type": "string"}},
                },
                handler=lambda concept=None, platform=platform: compose_prompt(
                    concept or self._concept.get("focal_subject", "gradient-field"),
                    topic, platform, cfg["placement"],
                ),
            ),
            ToolSpec(
                name="render_image",
                description="Draw the brand layer locally and return the asset. Cannot fail.",
                input_schema={
                    "type": "object",
                    "properties": {"option": {"type": "string", "description": "`A` or `B`."}},
                },
                handler=lambda option=None: self._render(option, platform),
            ),
            ToolSpec(
                name="write_alt_text",
                description="Alt text describing the content, not the styling. Required to publish.",
                input_schema={
                    "type": "object",
                    "properties": {"headline": {"type": "string"}, "concept": {"type": "string"}},
                },
                handler=lambda headline=None, concept=None: write_alt_text(
                    headline or self._concept.get("headline", ""),
                    concept or self._concept.get("focal_subject", "gradient-field"),
                    platform, topic,
                ),
            ),
            ToolSpec(
                name="check_forbidden_imagery",
                description="Whether the brief names any cliché AI stock category. Reports; never edits.",
                input_schema={"type": "object", "properties": {"text": {"type": "string"}}},
                handler=lambda text=None: check_forbidden_imagery(text or self._brief_text()),
            ),
            ToolSpec(
                name="check_visual_compliance",
                description=(
                    "Canvas, alt text, palette, typography, logo clear space and caption "
                    "agreement, all at once."
                ),
                input_schema={
                    "type": "object",
                    "properties": {"asset": {"type": "object"}, "alt_text": {"type": "string"}},
                },
                handler=lambda asset=None, alt_text="": check_visual_compliance(
                    asset or {}, alt_text, self._hook(caption), platform,
                    cfg["placement"], cfg["logo_clear_space_ratio"], self._brief_text(),
                ),
            ),
            ToolSpec(
                name="check_visual_similarity",
                description="Similarity against shipped concepts. Computed, never estimated.",
                input_schema={
                    "type": "object",
                    "properties": {"concept_text": {"type": "string"}},
                },
                handler=lambda concept_text=None: check_visual_similarity(
                    concept_text or self._concept_text(),
                    payload.get("published_concepts", []),
                    cfg["similarity_cap"],
                ),
            ),
        ]

    # ── Helpers ────────────────────────────────────────────────────────────

    def _options(self) -> list[dict[str, Any]]:
        return self._briefs.get("options", [])

    def _selected(self) -> dict[str, Any]:
        """
        The brief the asset is rendered from.

        Option A unless a human already chose otherwise. This is a default, not
        a judgement — the gate owns the choice, and both briefs travel intact.
        """
        options = self._options()
        if not options:
            return {}
        wanted = self._briefs.get("selected", "A")
        return next((o for o in options if o["option"] == wanted), options[0])

    def _evidence(self, payload: dict[str, Any]) -> str:
        """
        What rule 2 is tested against: the caption and the evidence behind it.

        Recalled visual knowledge is deliberately **not** here. Those entries
        carry figures about how posts perform — "three-item lists complete 71%
        of the time" — and a figure about engagement is not data about the
        subject. Letting them in unlocked a benchmark chart for a caption that
        named no benchmark, which is precisely the fabrication rule 2 exists to
        prevent. They shape how the picture looks, never whether there is
        something to chart.
        """
        parts = [str(payload.get("evidence", "")), _caption_body(payload.get("caption"))]
        return " ".join(p for p in parts if p)

    def _hook(self, caption: str) -> str:
        return next((line.strip() for line in caption.splitlines() if line.strip()), "")

    def _concept_text(self) -> str:
        return f"{self._concept.get('focal_subject', '')} {self._concept.get('headline', '')}"

    def _brief_text(self) -> str:
        """Both briefs as one string, for the rule 5 scan."""
        return " ".join(
            f"{o.get('subject', '')} {o.get('focal_subject_label', '')} "
            f"{o.get('composition_label', '')}"
            for o in self._options()
        )

    def _render(self, option: str | None, platform: str) -> dict[str, Any]:
        """Renders whichever brief was asked for, defaulting to the selected one."""
        brief = self._concept
        if option:
            brief = next((o for o in self._options() if o["option"] == option), self._concept)

        return render_image(
            brief.get("headline", ""),
            brief.get("kicker", "AI RESEARCH"),
            brief.get("focal_subject", "gradient-field"),
            platform,
            self._background_uri(),
            self._background_reason(),
            placement=self.config["placement"],
            composition=brief.get("composition", "left-weighted"),
            palette_variant=brief.get("palette", "deep"),
            viewpoint=brief.get("viewpoint", "head-on"),
            clear_space_ratio=self.config["logo_clear_space_ratio"],
        )

    def _paint(self, payload: dict[str, Any], platform: str) -> dict[str, Any]:
        """
        Asks the bound painter for a background, and accepts a refusal.

        A caller may hand one in directly — a re-render of an approved creative
        must not repaint, or the picture the reviewer approved is not the
        picture that ships.
        """
        supplied = payload.get("background_data_uri")
        if supplied:
            return {"painted": True, "painter": "supplied", "transport": "payload",
                    "data_uri": supplied}

        canvas, _ = resolve_placement(platform, self.config["placement"])
        prompt = compose_prompt(
            self._concept.get("focal_subject", "gradient-field"),
            payload.get("topic", ""), platform, self.config["placement"],
        )
        return paint_background(
            prompt.get("prompt", "") if isinstance(prompt, dict) else str(prompt),
            canvas["width"], canvas["height"],
            headline=self._concept.get("headline", ""),
            concept=self._concept.get("focal_subject", "gradient-field"),
            platform=platform,
            painter=self.config["background_model"],
        )

    def _background_uri(self) -> str | None:
        return self._background.get("data_uri") if self._background.get("painted") else None

    def _background_reason(self) -> str | None:
        """
        Named honestly. A picture that shipped without its background says which
        painter declined and why, rather than pretending it was a choice.
        """
        if self._background.get("painted"):
            return None
        return self._background.get("reason") or None

    def task(self, payload: dict[str, Any]) -> str:
        return (
            f"Create the {payload.get('platform', 'linkedin')} image for "
            f"\"{payload.get('title', '')}\".\n\n"
            "Recall what we know about how our pictures look, author the two briefs from the "
            "caption the Content Agent already wrote, check that they are genuinely distinct, "
            "render the selected one, write its alt text, and check every visual rule before "
            "returning it."
        )

    def finalise(self, reasoning: Reasoning, payload: dict[str, Any]) -> dict[str, Any]:
        """Enforcement runs here too, so the deterministic path cannot skip it."""
        cfg = self.config
        platform = payload.get("platform", "linkedin")
        caption = _caption_body(payload.get("caption"))
        output = dict(reasoning.payload)

        output["visual_knowledge"] = self._visual_knowledge
        output["options"] = self._options()
        output["selected_option"] = self._concept.get("option", "A")
        output["concept_choice"] = self._concept
        output["placement_reason"] = self._briefs.get("placement_reason", "")
        output["visual_type_reason"] = self._briefs.get("visual_type_reason", "")
        output["chart_declined"] = self._briefs.get("chart_declined", False)
        output["locked_held"] = self._briefs.get("locked_held", [])

        # Rules 7 and 8. Measured across the briefs that were actually authored,
        # not asserted by whoever authored them.
        output["option_distinctness"] = check_option_distinctness(
            self._options(), cfg["similarity_cap"], cfg["min_differing_dimensions"]
        )

        if not output.get("asset"):
            output.update(self._render(output["selected_option"], platform))

        if not output.get("alt_text"):
            output["alt_text"] = self._concept.get("alt_text", "") or write_alt_text(
                self._concept.get("headline", ""),
                self._concept.get("focal_subject", "gradient-field"),
                platform, payload.get("topic", ""),
            )["alt_text"]

        asset = output.get("asset", {})
        output["visual_compliance"] = check_visual_compliance(
            asset, output.get("alt_text", ""), self._hook(caption), platform,
            cfg["placement"], cfg["logo_clear_space_ratio"], self._brief_text(),
        )
        output["visual_similarity"] = check_visual_similarity(
            self._concept_text(), payload.get("published_concepts", []), cfg["similarity_cap"]
        )
        # Which painter served, and over which transport. An operator looking at
        # a flat-looking creative should be able to see whether the model ran,
        # declined, or was never asked, without reading the logs.
        output["background"] = {
            "painted": self._background.get("painted", False),
            "painter": self._background.get("painter", "brand-svg"),
            "transport": self._background.get("transport", "local"),
            "model": self._background.get("model"),
            "reason": self._background.get("reason"),
        }

        # What Publishing reads to satisfy a platform that requires media.
        output["has_media"] = bool(asset.get("data_uri"))
        output["visual_grounded_in"] = [k["id"] for k in self._visual_knowledge]
        return output

    def summarise(self, result: dict[str, Any]) -> str:
        asset = result.get("asset", {})
        compliance = result.get("visual_compliance", {})
        similarity = result.get("visual_similarity", {})
        distinct = result.get("option_distinctness", {})
        options = result.get("options", [])
        grounded = len(result.get("visual_grounded_in", []))

        painted = (
            "with a model-painted background" if result.get("background", {}).get("painted")
            else "on the local brand renderer alone"
        )
        grounding = (
            f"informed by {grounded} visual entr{'y' if grounded == 1 else 'ies'} in the Knowledge Base"
            if grounded else "with no stored visual preference to draw on"
        )
        declined = (
            " A chart was not offered: no figure appears in the evidence."
            if result.get("chart_declined") else ""
        )

        return (
            f"Authored {len(options)} briefs on the "
            f"{asset.get('placement_label', asset.get('canvas', 'unknown'))} canvas and rendered "
            f"option {result.get('selected_option', 'A')} "
            f"({result.get('concept_choice', {}).get('focal_subject_label', 'image')}) "
            f"{painted}, {grounding}. They differ on {len(distinct.get('differs_on', []))} of "
            f"{len(distinct.get('dimensions_checked', []))} dimensions at "
            f"{distinct.get('similarity', 0)} similarity. Visual rules: "
            f"{compliance.get('verdict', 'unchecked')} — {compliance.get('reason', '')}"
            f"{declined} Concept similarity {similarity.get('highest', 0)}, "
            f"{'above' if similarity.get('exceeds') else 'below'} the cap."
        )
