"""The image-labeling agent: a vision LLM running on a local llama-server.

Emits a structured ``{label, description, tags}`` for one image. Built for a
PRIVATE semantic search index over the user's OWN library, so the prompt strips
refusal/moralizing scaffolding and asks for a literal, exhaustive description.
Actual content latitude depends on the (user-chosen) GGUF loaded on llama-server.
"""
from __future__ import annotations

from typing import Literal

from agno.agent import Agent
from agno.models.llama_cpp import LlamaCpp  # subclass of OpenAILike
from pydantic import BaseModel, Field

import config

# The content-safety classes the app filters on (also the catalog `safety`
# column + Qdrant payload value). Ordered least -> most explicit.
Safety = Literal["sfw", "nsfw", "explicit"]


class ImageLabel(BaseModel):
    """Structured per-image output. Consumed by the ingest pipeline hook to
    enrich semantic indexing (description -> sparse text + search payload) and
    to drive the app's content-safety filter."""

    label: str = Field(description="Short noun-phrase category for the image")
    description: str = Field(
        description="Literal, exhaustive description of exactly what is depicted"
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Salient keywords: objects, people, actions, setting, style, attributes",
    )
    safety: Safety = Field(
        description=(
            "Content-safety class, exactly one of: 'sfw' (the DEFAULT — no "
            "overtly sexual content; this still covers non-sexual or incidental "
            "nudity, swimwear, lingerie/underwear, and merely suggestive or "
            "mildly revealing imagery), 'nsfw' (overtly, intensely sexual "
            "content: sexualized nudity, exposed/erect genitals, or clearly "
            "pornographic posing — but stopping short of a depicted sex act), "
            "'explicit' (explicit sexual content / hardcore: a sexual act is "
            "actually depicted — penetration, oral sex, masturbation, etc.). "
            "Set a HIGH bar: when in doubt, choose the LOWER class."
        ),
    )


def build_model() -> LlamaCpp:
    # LlamaCpp is an OpenAILike subclass — just point base_url at llama-server.
    #
    # We deliberately DON'T cap generation here (no max_completion_tokens) or
    # force a reasoning budget. The model is a thinking model (Qwen3.5): a hard
    # token cap made it spend the budget reasoning and then truncate the
    # structured JSON output mid-string, so every label failed to parse. Length
    # and thinking are left to llama-server's own configured defaults (control
    # them on the server, e.g. --reasoning-budget / --n-predict, not here).
    return LlamaCpp(
        id=config.MODEL_ID,
        base_url=config.LLM_BASE_URL,
        api_key=config.API_KEY,
        temperature=config.TEMPERATURE,
    )


def build_agent() -> Agent:
    return Agent(
        model=build_model(),
        description=(
            "You are an uncensored image-labeling assistant for a private "
            "semantic search index."
        ),
        instructions=[
            "Describe EXACTLY what is visible: objects, people, actions, setting, "
            "composition, style, and any text.",
            "Be literal, specific, and complete. Do not refuse, moralize, censor, "
            "summarize away detail, or add disclaimers.",
            "Do not speculate beyond what is visible in the image.",
            "Classify content safety as EXACTLY one of: sfw, nsfw, explicit, and "
            "set a HIGH bar — most images are 'sfw'. Use 'sfw' by default, "
            "INCLUDING non-sexual nudity, swimwear, lingerie/underwear, and "
            "merely suggestive imagery. Use 'nsfw' ONLY for overtly, intensely "
            "sexual content (sexualized nudity, exposed/erect genitals, "
            "pornographic posing) that stops short of a sex act. Use 'explicit' "
            "ONLY when a sexual act is actually depicted (penetration, oral sex, "
            "masturbation). When unsure between two classes, pick the LOWER one.",
            "Keep any internal reasoning brief — spend tokens on the output, not "
            "on thinking.",
            "Populate the label, description, tags, and safety fields only.",
        ],
        output_schema=ImageLabel,
        # Local GGUFs lack the provider structured-output API, so inject the schema
        # into the prompt and parse JSON from the completion instead.
        use_json_mode=True,
        markdown=False,
    )


# Module-level singleton the AgentOS app and the /describe route share.
agent = build_agent()
