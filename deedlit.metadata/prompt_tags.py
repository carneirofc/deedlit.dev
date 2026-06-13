"""Prompt-tag normalization.

Ported faithfully from the TypeScript monolith:
- ``lib/prompt-tags.ts`` (``normalizeTag``)
- ``lib/library/services/metadata-service.ts`` (``cleanPromptTag``,
  ``normalizePromptTags``, ``parseLorasFromPrompt``)

#7 (references) does not depend on this module; it only normalizes the prompt
into booru-style tags for the ``tags[]`` field of the ExtractResult.
"""
from __future__ import annotations

import re

__all__ = ["normalize_tag", "normalize_prompt_tags", "parse_loras_from_prompt"]


def normalize_tag(tag: str) -> str:
    """TS ``normalizeTag``: trim + lowercase."""
    return tag.strip().lower()


# TS: /<(?:lora|lyco):[^>]*>/gi
_LORA_STRIP_RE = re.compile(r"<(?:lora|lyco):[^>]*>", re.IGNORECASE)
# TS: /:\s*\d+(?:\.\d+)?/g  (emphasis weight, e.g. `tag:0.65`)
_WEIGHT_RE = re.compile(r":\s*\d+(?:\.\d+)?")
# TS char classes for bracket balance bookkeeping
_OPEN_RE = re.compile(r"[([{]")
_CLOSE_RE = re.compile(r"[)\]}]")
_LEAD_BRACKET_RE = re.compile(r"^[([{<]+")
_TRAIL_BRACKET_RE = re.compile(r"[)\]}>]+$")
_WS_RE = re.compile(r"\s+")
# TS: /<(?:lora|lyco):([^:>]+)(?::([0-9.]+))?[^>]*>/gi
_LORA_PARSE_RE = re.compile(r"<(?:lora|lyco):([^:>]+)(?::([0-9.]+))?[^>]*>", re.IGNORECASE)

_STOP_TOKENS = {"break", "and", "", "lora", "embedding"}


def _clean_prompt_tag(raw: str) -> str:
    """Port of ``cleanPromptTag`` in metadata-service.ts.

    - drop A1111 emphasis weights (``tag:0.65``) and backslash escapes
    - unwrap balanced emphasis brackets (``(tag)``, ``((tag))``, ``[tag]``)
    - trim stray unbalanced brackets left over from weighted groups
    - collapse whitespace
    """
    t = _WEIGHT_RE.sub("", raw.replace("\\", "")).strip()

    # while /^[([{<]/.test(t) && /[)\]}>]$/.test(t)
    while t and t[0] in "([{<" and t[-1] in ")]}>":
        t = t[1:-1].strip()

    opens = len(_OPEN_RE.findall(t))
    closes = len(_CLOSE_RE.findall(t))
    if opens != closes:
        t = _TRAIL_BRACKET_RE.sub("", _LEAD_BRACKET_RE.sub("", t)).strip()

    return _WS_RE.sub(" ", t).strip()


def normalize_prompt_tags(prompt: str | None) -> list[str]:
    """Port of ``normalizePromptTags`` in metadata-service.ts.

    Strip lora/lyco tags and extract comma/newline/BREAK-separated booru-style
    tags, lowercased and de-duplicated, preserving first-seen order.
    """
    if not prompt:
        return []

    without_loras = _LORA_STRIP_RE.sub(" ", prompt)
    # A1111 prompts mix commas and newlines as separators; treat both, plus BREAK.
    normalized_separators = re.sub(r"[\r\n]+", ",", without_loras)
    normalized_separators = re.sub(r"\bBREAK\b", ",", normalized_separators)

    seen: set[str] = set()
    tags: list[str] = []
    for piece in normalized_separators.split(","):
        cleaned = normalize_tag(_clean_prompt_tag(piece))
        if not cleaned or cleaned in _STOP_TOKENS or len(cleaned) > 80:
            continue
        if cleaned not in seen:
            seen.add(cleaned)
            tags.append(cleaned)
    return tags


def parse_loras_from_prompt(prompt: str | None) -> list[dict]:
    """Port of ``parseLorasFromPrompt``: ``<lora:name:0.8>`` / ``<lyco:...>``.

    Not part of the #6 ExtractResult contract, but ported for completeness and
    reuse by later issues. Returns ``[{"name": str, "weight": float | None}]``.
    """
    if not prompt:
        return []
    out: list[dict] = []
    for match in _LORA_PARSE_RE.finditer(prompt):
        weight = float(match.group(2)) if match.group(2) else None
        out.append({"name": match.group(1).strip(), "weight": weight})
    return out
