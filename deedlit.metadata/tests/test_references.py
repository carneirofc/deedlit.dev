"""Tests for #7: full asset-reference graph resolution.

References are resolved by WALKING THE COMFYUI NODE GRAPH (api-prompt JSON
``class_type`` + inputs), not by regex over the final prompt text. Fixtures are
built programmatically as ComfyUI api-prompt graphs containing the relevant
loader nodes; we assert ``resolve_references`` and the end-to-end ``/extract``
response return the expected ``{name, hash?}`` entries per category.
"""
import json

from fastapi.testclient import TestClient

from app import app
from extract import REFERENCE_CATEGORIES, interpret_metadata
from metadata_parsing import resolve_references

client = TestClient(app)


def _names(refs, category):
    return [r["name"] for r in refs[category]]


# ---- checkpoints + loras (tracer) ---------------------------------------

CHECKPOINT_LORA_GRAPH = {
    "3": {
        "class_type": "KSampler",
        "inputs": {"model": ["10", 0], "positive": ["6", 0], "negative": ["7", 0]},
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base.safetensors"}},
    "10": {
        "class_type": "LoraLoader",
        "inputs": {"lora_name": "detail_tweaker.safetensors", "model": ["4", 0], "clip": ["4", 1]},
    },
    "11": {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {"lora_name": "add_detail.safetensors", "model": ["10", 0]},
    },
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry"}},
}


def test_resolve_checkpoints():
    refs = resolve_references(CHECKPOINT_LORA_GRAPH)
    assert _names(refs, "checkpoints") == ["sd_xl_base.safetensors"]
    assert refs["checkpoints"][0]["hash"] is None


def test_resolve_loras():
    refs = resolve_references(CHECKPOINT_LORA_GRAPH)
    assert _names(refs, "loras") == ["detail_tweaker.safetensors", "add_detail.safetensors"]


def test_resolve_unet_loader_as_checkpoint():
    graph = {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux_dev.safetensors"}}}
    refs = resolve_references(graph)
    assert _names(refs, "checkpoints") == ["flux_dev.safetensors"]


# ---- vae -----------------------------------------------------------------

def test_resolve_vae():
    graph = {"1": {"class_type": "VAELoader", "inputs": {"vae_name": "sdxl_vae.safetensors"}}}
    refs = resolve_references(graph)
    assert _names(refs, "vae") == ["sdxl_vae.safetensors"]


# ---- controlnets ---------------------------------------------------------

def test_resolve_controlnets():
    graph = {
        "1": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "canny.pth"}},
        "2": {
            "class_type": "ControlNetApply",
            "inputs": {"control_net": ["1", 0], "conditioning": ["6", 0]},
        },
    }
    refs = resolve_references(graph)
    assert _names(refs, "controlnets") == ["canny.pth"]


# ---- upscalers -----------------------------------------------------------

def test_resolve_upscalers():
    graph = {"1": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x-UltraSharp.pth"}}}
    refs = resolve_references(graph)
    assert _names(refs, "upscalers") == ["4x-UltraSharp.pth"]


# ---- loras: community custom-node shapes (seen in real ComfyUI PNGs) -----

def test_resolve_loras_rgthree_power_lora_loader():
    # "Power Lora Loader (rgthree)" stores each lora under lora_N: {lora: name}
    graph = {
        "1": {
            "class_type": "Power Lora Loader (rgthree)",
            "inputs": {
                "PowerLoraLoaderHeaderWidget": {"type": "PowerLoraLoaderHeaderWidget"},
                "lora_1": {"on": True, "lora": "illustrious\\StyleA.safetensors", "strength": 0.8},
                "lora_2": {"on": False, "lora": "DetailB.safetensors", "strength": 0.5},
                "model": ["1166", 1],
            },
        },
    }
    refs = resolve_references(graph)
    assert _names(refs, "loras") == ["illustrious\\StyleA.safetensors", "DetailB.safetensors"]


def test_resolve_loras_loramanager_value_list():
    # "Lora Loader (LoraManager)" stores loras under loras.__value__[].name
    graph = {
        "1": {
            "class_type": "Lora Loader (LoraManager)",
            "inputs": {
                "text": "<lora:Armpit_Stubble:0.75> <lora:DeeperSkinV1:1.00>",
                "loras": {
                    "__value__": [
                        {"name": "Armpit_Stubble", "strength": "0.75", "active": True},
                        {"name": "DeeperSkinV1", "strength": "1.00", "active": False},
                    ]
                },
                "model": ["1184", 0],
            },
        },
    }
    refs = resolve_references(graph)
    assert _names(refs, "loras") == ["Armpit_Stubble", "DeeperSkinV1"]


# ---- embeddings (from CLIPTextEncode text, graph-sourced) ----------------

def test_resolve_embeddings_from_clip_text():
    graph = {
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "masterpiece, embedding:EasyNegative, (embedding:badhandv4:1.2)"},
        },
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "embedding:EasyNegative"}},
    }
    refs = resolve_references(graph)
    # deduped, order preserved, no .pt suffix assumptions
    assert _names(refs, "embeddings") == ["EasyNegative", "badhandv4"]


def test_resolve_embeddings_ignores_non_text_inputs():
    # text inputs that are node references (lists) must not be regex'd
    graph = {
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": ["99", 0], "clip": ["4", 1]}},
    }
    refs = resolve_references(graph)
    assert refs["embeddings"] == []


# ---- combined fixture: loras + embeddings + controlnets ------------------

COMBINED_GRAPH = {
    "3": {
        "class_type": "KSampler",
        "inputs": {"model": ["10", 0], "positive": ["6", 0], "negative": ["7", 0]},
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "base.safetensors"}},
    "10": {
        "class_type": "LoraLoader",
        "inputs": {"lora_name": "style.safetensors", "model": ["4", 0], "clip": ["4", 1]},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "1girl, embedding:myStyle", "clip": ["10", 1]},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "embedding:EasyNegative, lowres", "clip": ["10", 1]},
    },
    "12": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "openpose.pth"}},
    "13": {
        "class_type": "ControlNetApplyAdvanced",
        "inputs": {"control_net": ["12", 0], "positive": ["6", 0], "negative": ["7", 0]},
    },
}


def test_resolve_combined():
    refs = resolve_references(COMBINED_GRAPH)
    assert _names(refs, "checkpoints") == ["base.safetensors"]
    assert _names(refs, "loras") == ["style.safetensors"]
    assert _names(refs, "embeddings") == ["myStyle", "EasyNegative"]
    assert _names(refs, "controlnets") == ["openpose.pth"]
    assert refs["vae"] == []
    assert refs["upscalers"] == []
    # every entry has the {name, hash?} shape
    for cat in REFERENCE_CATEGORIES:
        for entry in refs[cat]:
            assert set(entry.keys()) <= {"name", "hash"}
            assert "name" in entry


# ---- integration through interpret_metadata / endpoint -------------------

def test_interpret_metadata_populates_references():
    md = {"source": "embedded-png", "fields": {"prompt": COMBINED_GRAPH}}
    r = interpret_metadata(md)
    assert r["sourceTool"] == "comfyui"
    assert [c["name"] for c in r["references"]["checkpoints"]] == ["base.safetensors"]
    assert [c["name"] for c in r["references"]["loras"]] == ["style.safetensors"]
    assert [c["name"] for c in r["references"]["embeddings"]] == ["myStyle", "EasyNegative"]
    assert [c["name"] for c in r["references"]["controlnets"]] == ["openpose.pth"]


def test_extract_endpoint_resolves_references(make_png_bytes):
    png = make_png_bytes({"prompt": json.dumps(COMBINED_GRAPH)})
    r = client.post("/extract", files={"file": ("img.png", png, "image/png")})
    assert r.status_code == 200
    refs = r.json()["references"]
    assert [c["name"] for c in refs["loras"]] == ["style.safetensors"]
    assert [c["name"] for c in refs["embeddings"]] == ["myStyle", "EasyNegative"]
    assert [c["name"] for c in refs["controlnets"]] == ["openpose.pth"]
    assert all(
        entry["hash"] is None
        for cat in refs.values()
        for entry in cat
        if "hash" in entry
    )


def test_a1111_image_has_empty_references():
    # references are graph-sourced; an A1111 parameters blob (even with <lora:..>)
    # yields no graph and therefore no resolved references.
    a1111 = (
        "masterpiece, <lora:foo:0.8>, embedding:bar\n"
        "Negative prompt: lowres\nSteps: 10, Seed: 1"
    )
    md = {"source": "embedded-png", "fields": {"parameters": a1111}}
    r = interpret_metadata(md)
    assert all(r["references"][cat] == [] for cat in REFERENCE_CATEGORIES)
