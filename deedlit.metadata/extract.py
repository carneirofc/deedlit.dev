"""Interpret embedded PNG metadata into the typed ExtractResult payload.

Ported from ``interpretMetadata`` + ``extractImageMetadata`` in
``lib/library/services/metadata-service.ts`` — minus all pixel-derived work
(sha256/phash/dims/thumbnail), which is the ingest service's job (#6 scope note).

The ``references{}`` field is OUT OF SCOPE for #6 and deferred to #7: this
module always returns ``EMPTY_REFERENCES`` (all six categories present, empty).
#7 will resolve checkpoints/loras/embeddings/vae/controlnets/upscalers from the
ComfyUI node graph (extend ``metadata_parsing.extract_from_comfy_prompt_graph``
and populate references here from the same ``workflow_json``/``api_prompt_json``).
"""
from __future__ import annotations

import re
from typing import Any

from metadata_parsing import (
    extract_from_comfy_prompt_graph,
    find_first_value_by_keys,
    get_searchable_metadata,
    is_record,
    maybe_parse_json_string,
    parse_automatic1111_parameters,
    to_display_value,
)
from prompt_tags import normalize_prompt_tags

__all__ = ["interpret_metadata", "EMPTY_REFERENCES", "REFERENCE_CATEGORIES"]

# References are deferred to #7. Keep all six categories present but empty so the
# ExtractResult contract is satisfied today and #7 only has to fill the lists.
REFERENCE_CATEGORIES = ("checkpoints", "loras", "embeddings", "vae", "controlnets", "upscalers")


def _empty_references() -> dict[str, list]:
    return {category: [] for category in REFERENCE_CATEGORIES}


EMPTY_REFERENCES = _empty_references()

_SIZE_RE = re.compile(r"(\d+)\s*[x×]\s*(\d+)")


def _to_number(value: Any) -> float | None:
    """Port of ``toNumber``: tolerant float parse (commas -> dots)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        n = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return n


def _to_int(value: Any) -> int | None:
    """Coerce a tolerant number to int for integer-typed params (seed/steps/...).

    The contract types seed/steps/width/height/clipskip as integers; the TS
    ``toNumber`` produced floats. We narrow integral floats to int and drop the
    fractional part otherwise (matching how these fields are always integers in
    practice for A1111/ComfyUI output).
    """
    n = _to_number(value)
    if n is None:
        return None
    return int(n)


def _parse_size(size: str | None) -> tuple[int | None, int | None]:
    if not size:
        return None, None
    m = _SIZE_RE.search(size)
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2))


def _empty_params() -> dict[str, Any]:
    return {
        "seed": None,
        "steps": None,
        "cfg": None,
        "sampler": None,
        "scheduler": None,
        "denoise": None,
        "clipskip": None,
        "width": None,
        "height": None,
    }


def interpret_metadata(metadata: Any) -> dict[str, Any]:
    """Produce the typed ExtractResult dict from embedded PNG metadata.

    ``sourceTool`` is one of ``a1111`` / ``comfyui`` / ``unknown`` (contract
    enum). Returns ``None`` for unknown prompt/negative and ``None``-filled
    params when nothing recognizable is present.
    """
    searchable = get_searchable_metadata(metadata)

    source_tool: str | None = None
    prompt: str | None = None
    negative: str | None = None
    params = _empty_params()

    # --- Automatic1111 / Forge: a `parameters` text blob ------------------
    parameters_raw = to_display_value(find_first_value_by_keys(searchable, ["parameters"]))
    if parameters_raw:
        a1111 = parse_automatic1111_parameters(parameters_raw, include_first_line_as_positive=True)
        source_tool = "a1111"
        prompt = a1111.get("positivePrompt")
        negative = a1111.get("negativePrompt")
        params["seed"] = _to_int(a1111.get("seed"))
        params["steps"] = _to_int(a1111.get("steps"))
        params["cfg"] = _to_number(a1111.get("cfgScale"))
        params["sampler"] = a1111.get("sampler")
        params["scheduler"] = a1111.get("scheduler")
        width, height = _parse_size(a1111.get("size"))
        params["width"] = width
        params["height"] = height

    # --- ComfyUI: a `prompt` field containing a node graph ----------------
    comfy_prompt = find_first_value_by_keys(searchable, ["prompt"])
    workflow = find_first_value_by_keys(searchable, ["workflow"])

    api_prompt_json: Any = None
    workflow_json: Any = None

    if comfy_prompt is not None:
        parsed_comfy_prompt = maybe_parse_json_string(comfy_prompt)
        if is_record(parsed_comfy_prompt):
            comfy = extract_from_comfy_prompt_graph(comfy_prompt)
            if comfy.get("positivePrompt") or comfy.get("model"):
                source_tool = source_tool or "comfyui"
                prompt = prompt if prompt is not None else comfy.get("positivePrompt")
                negative = negative if negative is not None else comfy.get("negativePrompt")
                if params["seed"] is None:
                    params["seed"] = _to_int(comfy.get("seed"))
                if params["steps"] is None:
                    params["steps"] = _to_int(comfy.get("steps"))
                if params["cfg"] is None:
                    params["cfg"] = _to_number(comfy.get("cfgScale"))
                if params["sampler"] is None:
                    params["sampler"] = comfy.get("sampler")
                if params["scheduler"] is None:
                    params["scheduler"] = comfy.get("scheduler")
                api_prompt_json = parsed_comfy_prompt

    if workflow is not None:
        workflow_json = maybe_parse_json_string(workflow)

    tags = normalize_prompt_tags(prompt)

    return {
        "sourceTool": source_tool or "unknown",
        "prompt": prompt,
        "negative": negative,
        "tags": tags,
        "params": params,
        "references": _empty_references(),
        "workflow_json": workflow_json,
        "api_prompt_json": api_prompt_json,
    }
