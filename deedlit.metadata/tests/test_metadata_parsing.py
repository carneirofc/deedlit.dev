"""Tests for the parsing helpers ported from lib/metadata-parsing.ts."""
from metadata_parsing import (
    extract_from_comfy_prompt_graph,
    find_first_value_by_keys,
    get_searchable_metadata,
    maybe_parse_json_string,
    parse_automatic1111_parameters,
    to_display_value,
)


# ---- helpers -------------------------------------------------------------

def test_to_display_value():
    assert to_display_value("  hi  ") == "hi"
    assert to_display_value("   ") is None
    assert to_display_value(5) == "5"
    assert to_display_value(1.5) == "1.5"
    assert to_display_value(True) == "True"  # parity note: TS would give "true"
    assert to_display_value(None) is None
    assert to_display_value({"a": 1}) is None


def test_maybe_parse_json_string():
    assert maybe_parse_json_string('{"a": 1}') == {"a": 1}
    assert maybe_parse_json_string("[1, 2]") == [1, 2]
    assert maybe_parse_json_string("plain") == "plain"
    assert maybe_parse_json_string("{bad") == "{bad"
    assert maybe_parse_json_string(5) == 5


def test_get_searchable_metadata_unwraps_fields():
    md = {"source": "embedded-png", "fields": {"parameters": "x"}}
    assert get_searchable_metadata(md) == {"parameters": "x"}
    assert get_searchable_metadata("plain") == "plain"


def test_find_first_value_by_keys_normalizes_keys():
    root = {"fields": {"CFG scale": "7"}}
    # normalized key match ignores case & non-alphanumerics
    assert find_first_value_by_keys(root, ["cfgscale"]) == "7"


def test_find_first_value_descends_and_parses_json_strings():
    root = {"prompt": '{"deep": {"seed": 42}}'}
    assert find_first_value_by_keys(root, ["seed"]) == 42


# ---- A1111 ---------------------------------------------------------------

A1111 = (
    "masterpiece, best quality, 1girl\n"
    "Negative prompt: lowres, bad anatomy\n"
    "Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, "
    "Size: 512x768, Model: someModel"
)


def test_a1111_positive_negative():
    r = parse_automatic1111_parameters(A1111)
    assert r["positivePrompt"] == "masterpiece, best quality, 1girl"
    assert r["negativePrompt"] == "lowres, bad anatomy"


def test_a1111_params():
    r = parse_automatic1111_parameters(A1111)
    assert r["steps"] == "28"
    assert r["sampler"] == "DPM++ 2M Karras"
    assert r["cfgScale"] == "7"
    assert r["seed"] == "12345"
    assert r["size"] == "512x768"
    assert r["model"] == "someModel"


def test_a1111_no_negative_with_first_line_option():
    r = parse_automatic1111_parameters(
        "just a prompt\nSteps: 10", include_first_line_as_positive=True
    )
    assert r["positivePrompt"] == "just a prompt"
    assert r["steps"] == "10"


# ---- ComfyUI graph -------------------------------------------------------

COMFY = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 999,
            "steps": 20,
            "cfg": 8,
            "sampler_name": "euler",
            "scheduler": "normal",
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
        },
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry"}},
}


def test_comfy_graph_walk():
    r = extract_from_comfy_prompt_graph(COMFY)
    assert r["positivePrompt"] == "a cat"
    assert r["negativePrompt"] == "blurry"
    assert r["model"] == "model.safetensors"
    assert r["sampler"] == "euler"
    assert r["cfgScale"] == "8"
    assert r["steps"] == "20"
    assert r["seed"] == "999"
    assert r["scheduler"] == "normal"


def test_comfy_sdxl_text_g_l_joined():
    graph = {
        "3": {"class_type": "KSampler", "inputs": {"positive": ["6", 0]}},
        "6": {"class_type": "CLIPTextEncodeSDXL", "inputs": {"text_g": "g part", "text_l": "l part"}},
    }
    r = extract_from_comfy_prompt_graph(graph)
    assert r["positivePrompt"] == "g part\nl part"


def test_comfy_no_ksampler_returns_empty():
    assert extract_from_comfy_prompt_graph({"1": {"class_type": "LoadImage", "inputs": {}}}) == {}
