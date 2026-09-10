"""Typed input and output for the Image Creation Agent."""

from __future__ import annotations

from pydantic import BaseModel, Field

from core.schema import Platform, SourceMode


class ImageInput(BaseModel):
    title: str = Field(description="The idea's title, used only when the caption has no hook.")
    topic: str = Field(default="", description="The subject the caption is grounded in.")
    platform: Platform = Platform.LINKEDIN
    caption: str = Field(default="", description="The caption body. Its hook becomes the headline.")
    evidence: str = Field(
        default="",
        description="What the caption is grounded in. Read only to decide whether a chart "
                    "treatment is available at all — rule 2 forbids charting absent data.",
    )
    placement: str = Field(
        default="auto",
        description="A key from the skill's rule 15 table, or `auto` for the platform default.",
    )
    locked: list[str] = Field(
        default_factory=list,
        description="Rule 13. Brief elements the operator asked to keep unchanged during "
                    "iteration. Held from `previous_brief`, never re-derived.",
    )
    previous_brief: dict = Field(
        default_factory=dict,
        description="The brief a locked element is held from. Without it a lock cannot apply, "
                    "and the run says so rather than pretending it held.",
    )
    published_concepts: list[str] = Field(
        default_factory=list,
        description="Concepts already shipped, for the similarity check. Computed, never judged.",
    )


class ImageBrief(BaseModel):
    """
    One image option, in the shape `packages/skills/image-brief/SKILL.md` specifies.

    Two of these are produced per request — A and B — because the skill sends
    the choice to the human gate rather than making it here.
    """

    option: str = Field(description="`A` or `B`.")
    subject: str = Field(description="The visual subject, derived from the same context as the caption.")
    visual_type: str = Field(description="`chart`, `diagram` or `conceptual`. Rule 2.")
    composition: str = ""
    focal_subject: str = Field(default="", description="The one focal visual system. Rule 3.")
    palette: str = Field(default="", description="Which weighting of the Ethara Purple family leads.")
    typography: str = Field(default="", description="Roboto for display, DM Sans for body. Rule 10.")
    viewpoint: str = ""
    alt_text: str = Field(default="", description="Required to publish. Rule 11.")
    platform: Platform = Platform.LINKEDIN
    placement: str = ""
    dimensions: str = Field(default="", description="`W×H`, from the configured placement.")
    aspect_ratio: str = ""


class MediaAsset(BaseModel):
    data_uri: str
    canvas: str = Field(description="`WxH`, checked against the placement by rule 15.")
    platform: Platform = Platform.LINKEDIN
    placement: str = ""
    aspect_ratio: str = ""
    concept: str = ""
    composition: str = ""
    palette: str = ""
    viewpoint: str = ""
    headline: str = ""
    kicker: str = ""
    layers: list[str] = Field(default_factory=list, description="`background` when a model painted one.")
    brand_layer: str = Field(default="local-vector", description="Always local. No model draws brand text.")
    palette_used: list[str] = Field(
        default_factory=list,
        description="Every colour the brand layer emitted, so rule 9 is checked against what "
                    "was drawn rather than what was intended.",
    )
    logo: dict = Field(default_factory=dict, description="Mark geometry, for the rule 14 clear-space check.")
    bytes: int = 0


class VisualFinding(BaseModel):
    rule: str
    area: str
    detail: str


class ImageOutput(BaseModel):
    options: list[ImageBrief] = Field(
        default_factory=list, description="The two distinct briefs. Rule 7."
    )
    selected_option: str = Field(
        default="A",
        description="Which brief the returned asset was rendered from. The human gate may "
                    "choose the other; nothing here decides for it.",
    )
    asset: MediaAsset | None = None
    alt_text: str = Field(default="", description="Describes the content, not the styling. Required to publish.")
    concept_choice: dict = Field(default_factory=dict)
    option_distinctness: dict = Field(
        default_factory=dict, description="Rules 7 and 8, both measured across the two briefs."
    )
    visual_compliance: dict = Field(default_factory=dict)
    visual_similarity: dict = Field(default_factory=dict)
    visual_grounded_in: list[str] = Field(
        default_factory=list, description="Knowledge entry ids that shaped the treatment."
    )
    locked_held: list[dict] = Field(
        default_factory=list, description="Rule 13: which locked elements were carried across."
    )
    has_media: bool = False
    background_painted: bool = False
    source: SourceMode = SourceMode.FIXTURE
    fallback_reason: str | None = None
