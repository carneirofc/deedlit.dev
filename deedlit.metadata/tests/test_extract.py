"""End-to-end tests for the /extract endpoint and the interpretation layer.

Fixtures are built programmatically with Pillow (see conftest.make_png).
Expected values are derived from the TS sources being ported.
"""
import json

from fastapi.testclient import TestClient

from app import app
from extract import EMPTY_REFERENCES, interpret_metadata

client = TestClient(app)


A1111_PARAMS = (
    "masterpiece, best quality, 1girl, <lora:foo:0.8>\n"
    "Negative prompt: lowres, bad anatomy\n"
    "Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7.5, Seed: 12345, "
    "Size: 512x768, Model: someModel"
)

COMFY_PROMPT = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 999,
            "steps": 20,
            "cfg": 8.0,
            "denoise": 1.0,
            "sampler_name": "euler",
            "scheduler": "karras",
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
        },
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat, sitting"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry, lowres"}},
}

COMFY_WORKFLOW = {"nodes": [{"id": 3, "type": "KSampler"}], "links": []}


# ---- interpret_metadata (A1111) -----------------------------------------

def test_interpret_a1111():
    md = {"source": "embedded-png", "fields": {"parameters": A1111_PARAMS}}
    r = interpret_metadata(md)
    assert r["sourceTool"] == "a1111"
    assert r["prompt"] == "masterpiece, best quality, 1girl, <lora:foo:0.8>"
    assert r["negative"] == "lowres, bad anatomy"
    assert r["params"]["seed"] == 12345
    assert r["params"]["steps"] == 28
    assert r["params"]["cfg"] == 7.5
    assert r["params"]["sampler"] == "DPM++ 2M Karras"
    assert r["params"]["width"] == 512
    assert r["params"]["height"] == 768
    # tags normalized, lora stripped
    assert r["tags"] == ["masterpiece", "best quality", "1girl"]
    assert r["references"] == EMPTY_REFERENCES


# ---- interpret_metadata (ComfyUI) ---------------------------------------

def test_interpret_comfy():
    md = {
        "source": "embedded-png",
        "fields": {"prompt": COMFY_PROMPT, "workflow": COMFY_WORKFLOW},
    }
    r = interpret_metadata(md)
    assert r["sourceTool"] == "comfyui"
    assert r["prompt"] == "a cat, sitting"
    assert r["negative"] == "blurry, lowres"
    assert r["params"]["seed"] == 999
    assert r["params"]["steps"] == 20
    assert r["params"]["cfg"] == 8.0
    assert r["params"]["sampler"] == "euler"
    assert r["params"]["scheduler"] == "karras"
    assert r["api_prompt_json"] == COMFY_PROMPT
    assert r["workflow_json"] == COMFY_WORKFLOW
    assert r["tags"] == ["a cat", "sitting"]


def test_interpret_unknown_when_no_metadata():
    r = interpret_metadata(None)
    assert r["sourceTool"] == "unknown"
    assert r["tags"] == []
    assert r["references"] == EMPTY_REFERENCES
    assert r["params"]["seed"] is None


# ---- endpoint ------------------------------------------------------------

def test_extract_endpoint_a1111(make_png_bytes):
    png = make_png_bytes({"parameters": A1111_PARAMS})
    r = client.post("/extract", files={"file": ("img.png", png, "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["sourceTool"] == "a1111"
    assert body["negative"] == "lowres, bad anatomy"
    assert body["params"]["seed"] == 12345
    assert set(body["references"].keys()) == {
        "checkpoints", "loras", "embeddings", "vae", "controlnets", "upscalers",
    }
    assert all(v == [] for v in body["references"].values())


def test_extract_endpoint_comfy(make_png_bytes):
    png = make_png_bytes(
        {"prompt": json.dumps(COMFY_PROMPT), "workflow": json.dumps(COMFY_WORKFLOW)}
    )
    r = client.post("/extract", files={"file": ("img.png", png, "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["sourceTool"] == "comfyui"
    assert body["prompt"] == "a cat, sitting"
    assert body["api_prompt_json"] == COMFY_PROMPT
    assert body["params"]["sampler"] == "euler"


def test_extract_endpoint_422_when_no_metadata(make_png_bytes):
    png = make_png_bytes({})  # no text chunks
    r = client.post("/extract", files={"file": ("img.png", png, "image/png")})
    assert r.status_code == 422
