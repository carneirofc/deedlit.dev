"""Metadata interpretation helpers.

Ported faithfully from ``lib/metadata-parsing.ts``:
- recursive key search (``findFirstValueByKeys``) with key normalization
- JSON-string coercion (``maybeParseJsonString``)
- A1111 ``parameters`` string parsing (``parseAutomatic1111Parameters``)
- ComfyUI prompt-graph walk (``extractFromComfyPromptGraph``)

The ComfyUI walk is intentionally structured so #7 (references) can extend the
node-graph traversal here to resolve checkpoints/loras/embeddings/etc. without
reworking the prompt/param extraction.
"""
from __future__ import annotations

import json
import re
from typing import Any

__all__ = [
    "is_record",
    "maybe_parse_json_string",
    "to_display_value",
    "get_searchable_metadata",
    "find_first_value_by_keys",
    "extract_prompt_text_from_metadata",
    "parse_automatic1111_parameters",
    "extract_from_comfy_prompt_graph",
    "resolve_references",
    "REFERENCE_CATEGORIES",
]

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]")


def is_record(value: Any) -> bool:
    """TS ``isRecord``: plain object (dict), not a list."""
    return isinstance(value, dict)


def _normalize_key(key: str) -> str:
    return _NON_ALNUM_RE.sub("", key.lower())


def maybe_parse_json_string(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    trimmed = value.strip()
    if not trimmed or not (trimmed.startswith("{") or trimmed.startswith("[")):
        return value
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        return value


def to_display_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed if trimmed else None
    # NOTE: bool is a subclass of int in Python; check it explicitly. TS renders
    # booleans as "true"/"false"; Python's str(True) is "True". This only ever
    # affects boolean inputs (none of the params we read are booleans).
    if isinstance(value, (int, float)):
        return str(value)
    return None


def get_searchable_metadata(metadata: Any) -> Any:
    if is_record(metadata) and is_record(metadata.get("fields")):
        return metadata["fields"]
    return metadata


def find_first_value_by_keys(root: Any, keys: list[str]) -> Any:
    """Recursive first-match search over the metadata tree.

    Mirrors the TS DFS: at each record, return the value of the first own key
    whose normalized form is in ``keys``; otherwise descend into values. JSON
    strings are coerced on the way down. Cycles are guarded by identity.
    """
    if not root:
        return None

    key_set = {_normalize_key(k) for k in keys}
    seen: set[int] = set()

    def visit(value: Any) -> Any:
        parsed = maybe_parse_json_string(value)

        if isinstance(parsed, list):
            for item in parsed:
                found = visit(item)
                if found is not None:
                    return found
            return None

        if not is_record(parsed):
            return None

        ident = id(parsed)
        if ident in seen:
            return None
        seen.add(ident)

        for key, nested in parsed.items():
            if _normalize_key(key) in key_set:
                return nested

        for nested in parsed.values():
            found = visit(nested)
            if found is not None:
                return found

        return None

    return visit(root)


def extract_prompt_text_from_metadata(metadata: Any, keys: list[str]) -> str | None:
    return to_display_value(find_first_value_by_keys(metadata, keys))


# ---------------------------------------------------------------------------
# A1111 `parameters`
# ---------------------------------------------------------------------------

_SETTINGS_START_RE = re.compile(r"\n(?:Steps|Sampler|CFG scale|Seed|Size|Model):", re.IGNORECASE)


def _capture(text: str, pattern: re.Pattern[str]) -> str | None:
    m = pattern.search(text)
    if not m:
        return None
    return m.group(1).strip()


_STEPS_RE = re.compile(r"Steps:\s*([^,\n]+)", re.IGNORECASE)
_SAMPLER_RE = re.compile(r"Sampler:\s*([^,\n]+)", re.IGNORECASE)
_CFG_RE = re.compile(r"CFG scale:\s*([^,\n]+)", re.IGNORECASE)
_SEED_RE = re.compile(r"Seed:\s*([^,\n]+)", re.IGNORECASE)
_SIZE_RE = re.compile(r"Size:\s*([^,\n]+)", re.IGNORECASE)
_MODEL_RE = re.compile(r"Model:\s*([^,\n]+)", re.IGNORECASE)


def parse_automatic1111_parameters(
    parameters: str, *, include_first_line_as_positive: bool = False
) -> dict[str, str]:
    """Port of ``parseAutomatic1111Parameters``.

    Returns only the keys that were found (matching the TS ``Partial`` shape):
    ``positivePrompt``, ``negativePrompt``, ``steps``, ``sampler``,
    ``cfgScale``, ``seed``, ``size``, ``model``.
    """
    result: dict[str, str] = {}
    text = parameters.strip()
    if not text:
        return result

    negative_label = "Negative prompt:"
    negative_index = text.find(negative_label)
    if negative_index >= 0:
        positive_part = text[:negative_index].strip()
        if positive_part:
            result["positivePrompt"] = positive_part

        after_negative = text[negative_index + len(negative_label) :]
        m = _SETTINGS_START_RE.search(after_negative)
        settings_start = m.start() if m else -1
        negative_part = (
            after_negative[:settings_start].strip()
            if settings_start >= 0
            else after_negative.strip()
        )
        if negative_part:
            result["negativePrompt"] = negative_part
    elif include_first_line_as_positive:
        first_line = text.split("\n")[0].strip()
        if first_line:
            result["positivePrompt"] = first_line

    for name, pattern in (
        ("steps", _STEPS_RE),
        ("sampler", _SAMPLER_RE),
        ("cfgScale", _CFG_RE),
        ("seed", _SEED_RE),
        ("size", _SIZE_RE),
        ("model", _MODEL_RE),
    ):
        captured = _capture(text, pattern)
        if captured is not None:
            result[name] = captured

    return result


# ---------------------------------------------------------------------------
# ComfyUI graph walk
# ---------------------------------------------------------------------------


def _resolve_node_reference(value: Any) -> str | None:
    if isinstance(value, list) and len(value) > 0:
        first = value[0]
        if isinstance(first, (str, int, float)) and not isinstance(first, bool):
            return str(first)
        if isinstance(first, str):
            return first
    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _extract_text_from_prompt_node(node_id: str | None, nodes: dict[str, dict]) -> str | None:
    if not node_id:
        return None
    node = nodes.get(node_id)
    if not node or not node.get("inputs"):
        return None
    inputs = node["inputs"]
    parts = [
        to_display_value(inputs.get("text")),
        to_display_value(inputs.get("text_g")),
        to_display_value(inputs.get("text_l")),
    ]
    parts = [p for p in parts if p]
    if not parts:
        return None
    return "\n".join(parts)


def extract_from_comfy_prompt_graph(prompt_value: Any) -> dict[str, str | None]:
    """Port of ``extractFromComfyPromptGraph``.

    Walks the ComfyUI api-prompt node graph: find the first KSampler-like node
    and a checkpoint/unet loader, then resolve positive/negative prompt text,
    model name, and sampler params. Returns a dict of the keys that were found
    (TS ``Partial`` shape).
    """
    parsed_prompt = maybe_parse_json_string(prompt_value)
    if not is_record(parsed_prompt):
        return {}

    nodes: dict[str, dict] = {}
    for node_id, node_value in parsed_prompt.items():
        if not is_record(node_value):
            continue
        class_type = to_display_value(node_value.get("class_type"))
        inputs = node_value.get("inputs") if is_record(node_value.get("inputs")) else None
        if not class_type or inputs is None:
            continue
        nodes[node_id] = {"classType": class_type, "inputs": inputs}

    ksampler_entry: tuple[str, dict] | None = None
    loader_node: dict | None = None

    for node_id, node in nodes.items():
        class_type = (node.get("classType") or "").lower()
        if ksampler_entry is None and "ksampler" in class_type:
            ksampler_entry = (node_id, node)
        if loader_node is None and (
            "checkpointloader" in class_type or "unetloader" in class_type
        ):
            loader_node = node
        if ksampler_entry and loader_node:
            break

    if ksampler_entry is None:
        return {}

    _, sampler_node = ksampler_entry
    inputs = sampler_node.get("inputs") or {}
    positive_ref = _resolve_node_reference(inputs.get("positive"))
    negative_ref = _resolve_node_reference(inputs.get("negative"))
    model_ref = _resolve_node_reference(inputs.get("model"))

    model_name: str | None = None
    if model_ref and nodes.get(model_ref, {}).get("inputs"):
        model_inputs = nodes[model_ref]["inputs"] or {}
        model_name = (
            to_display_value(model_inputs.get("ckpt_name"))
            or to_display_value(model_inputs.get("model_name"))
            or to_display_value(model_inputs.get("unet_name"))
        )

    if not model_name and not loader_node:
        for node in nodes.values():
            class_type = (node.get("classType") or "").lower()
            if "checkpointloader" in class_type or "unetloader" in class_type:
                loader_node = node
                break

    if not model_name and loader_node and loader_node.get("inputs"):
        loader_inputs = loader_node["inputs"]
        model_name = (
            to_display_value(loader_inputs.get("ckpt_name"))
            or to_display_value(loader_inputs.get("model_name"))
            or to_display_value(loader_inputs.get("unet_name"))
        )

    return {
        "positivePrompt": _extract_text_from_prompt_node(positive_ref, nodes),
        "negativePrompt": _extract_text_from_prompt_node(negative_ref, nodes),
        "model": model_name,
        "sampler": to_display_value(inputs.get("sampler_name")),
        "cfgScale": to_display_value(inputs.get("cfg")),
        "steps": to_display_value(inputs.get("steps")),
        "seed": to_display_value(inputs.get("seed")),
        "scheduler": to_display_value(inputs.get("scheduler")),
    }


# ---------------------------------------------------------------------------
# #7: full asset-reference graph resolution
# ---------------------------------------------------------------------------

# The six contract categories (AssetRef[]). Kept here so callers can build the
# empty-references skeleton from a single source of truth.
REFERENCE_CATEGORIES = (
    "checkpoints",
    "loras",
    "embeddings",
    "vae",
    "controlnets",
    "upscalers",
)

# Map a normalized (lowercased, alnum-only) ComfyUI ``class_type`` substring to
# (category, [input keys that may carry the asset name]). Matching is substring
# based so custom-node variants ("Checkpoint Loader with Name (Image Saver)",
# "Power Lora Loader (rgthree)", ...) still resolve as long as they expose the
# canonical input key. Order matters: more specific keys are tried first.
#
# Note: ``loraloadermodelonly`` is a superset-substring of ``loraloader`` so a
# single ``loraloader`` rule covers both. ``unetloader`` is treated as a
# checkpoint (the base model). Embeddings are NOT loader-based in stock ComfyUI;
# they are resolved separately from CLIPTextEncode ``text`` tokens below.
_LOADER_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("checkpointloader", "checkpoints", ("ckpt_name", "model_name", "unet_name")),
    ("unetloader", "checkpoints", ("unet_name", "model_name", "ckpt_name")),
    ("loraloader", "loras", ("lora_name",)),
    ("vaeloader", "vae", ("vae_name",)),
    ("controlnetloader", "controlnets", ("control_net_name", "controlnet_name", "control_net")),
    ("upscalemodelloader", "upscalers", ("model_name", "upscale_model")),
)

# ``embedding:NAME`` tokens inside CLIPTextEncode text. Name runs until a
# weight/closing-paren/comma/whitespace boundary, so "(embedding:foo:1.2)" and
# "embedding:bar," both resolve to the bare name.
_EMBEDDING_TOKEN_RE = re.compile(r"embedding:([^\s,:()<>]+)", re.IGNORECASE)


def _empty_references() -> dict[str, list[dict[str, Any]]]:
    return {category: [] for category in REFERENCE_CATEGORIES}


def _append_unique(bucket: list[dict[str, Any]], name: str | None) -> None:
    """Append a ``{name, hash: None}`` ref, deduped by name (order preserved).

    Hashes are virtually never present in ComfyUI graphs, so ``hash`` is always
    ``None`` here. The field is kept to match the ``AssetRef`` contract shape.
    """
    if not name:
        return
    if any(existing["name"] == name for existing in bucket):
        return
    bucket.append({"name": name, "hash": None})


def _node_iter(parsed_prompt: dict) -> Any:
    """Yield ``(class_type_lower_normalized, inputs)`` for graph nodes."""
    for node_value in parsed_prompt.values():
        if not is_record(node_value):
            continue
        class_type = to_display_value(node_value.get("class_type"))
        inputs = node_value.get("inputs")
        if not class_type or not is_record(inputs):
            continue
        normalized = _NON_ALNUM_RE.sub("", class_type.lower())
        yield normalized, inputs


def _resolve_lora_loader_inputs(inputs: dict, bucket: list[dict[str, Any]]) -> None:
    """Resolve lora names from community lora-loader node input shapes.

    Handles two widespread custom-node layouts (observed in real ComfyUI PNGs):
      - rgthree "Power Lora Loader": ``lora_1``, ``lora_2``, ... each a record
        ``{"on": bool, "lora": "<name>", "strength": float}``.
      - ComfyUI-Lora-Manager "Lora Loader": ``loras = {"__value__": [{"name": ...}]}``.
    """
    # rgthree-style: lora_N records carrying a "lora" field.
    for key, value in inputs.items():
        if key.lower().startswith("lora_") and is_record(value):
            _append_unique(bucket, to_display_value(value.get("lora")))

    # LoraManager-style: loras.__value__ list of {name: ...}.
    loras_field = inputs.get("loras")
    if is_record(loras_field):
        entries = loras_field.get("__value__")
        if isinstance(entries, list):
            for entry in entries:
                if is_record(entry):
                    _append_unique(bucket, to_display_value(entry.get("name")))


def resolve_references(prompt_value: Any) -> dict[str, list[dict[str, Any]]]:
    """Resolve the full asset-reference graph from a ComfyUI api-prompt graph.

    Walks every node's ``class_type`` + ``inputs`` (NOT a regex over the final
    prompt string) and resolves each of the six categories:

      - checkpoints: CheckpointLoader* / CheckpointLoaderSimple / UNETLoader
      - loras:       LoraLoader / LoraLoaderModelOnly
      - vae:         VAELoader
      - controlnets: ControlNetLoader (+ *Apply consumes its output)
      - upscalers:   UpscaleModelLoader
      - embeddings:  ``embedding:NAME`` tokens found in CLIPTextEncode ``text``
                     inputs (graph-sourced — only literal string inputs, never
                     node-reference lists).

    Each entry matches the ``AssetRef`` contract shape ``{name, hash}`` with
    ``hash`` always ``None`` (ComfyUI graphs carry names, not hashes). Returns a
    dict with all six categories present (possibly empty). A non-graph value
    (e.g. an A1111 ``parameters`` blob) yields the all-empty skeleton.
    """
    refs = _empty_references()
    parsed_prompt = maybe_parse_json_string(prompt_value)
    if not is_record(parsed_prompt):
        return refs

    for normalized, inputs in _node_iter(parsed_prompt):
        for needle, category, keys in _LOADER_RULES:
            if needle not in normalized:
                continue
            matched = False
            for key in keys:
                name = to_display_value(inputs.get(key))
                if name:
                    _append_unique(refs[category], name)
                    matched = True
                    break
            # Community lora nodes don't use the canonical ``lora_name`` scalar:
            # rgthree's "Power Lora Loader" nests ``lora_N: {lora: name}`` and
            # ComfyUI-Lora-Manager nests ``loras.__value__: [{name: ...}]``.
            if category == "loras" and not matched:
                _resolve_lora_loader_inputs(inputs, refs["loras"])

        # Embeddings: scan literal CLIPTextEncode text inputs for tokens. Only
        # plain string inputs are scanned; node-reference lists (["6", 0]) are
        # skipped so we never regex over a wired-in value we can't see here.
        if "cliptextencode" in normalized:
            for key in ("text", "text_g", "text_l"):
                raw = inputs.get(key)
                if not isinstance(raw, str):
                    continue
                for match in _EMBEDDING_TOKEN_RE.finditer(raw):
                    _append_unique(refs["embeddings"], match.group(1))

    return refs
