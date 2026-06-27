"""POST /describe returns a structured {label, description, tags}.

The agent boundary (``app.run_label``) is monkeypatched, so the suite runs
offline — no llama-server and no vision model required. The image bytes are
arbitrary since the stub never decodes them.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app as app_module


@pytest.fixture
def mock_agent(monkeypatch):
    captured: dict = {}

    def fake_run_label(data, fmt, prompt_hint=None):
        captured["fmt"] = fmt
        captured["prompt_hint"] = prompt_hint
        captured["len"] = len(data)
        return {
            "label": "abstract swatch",
            "description": "A solid purple square filling the frame.",
            "tags": ["purple", "square", "solid color"],
            "safety": "sfw",
        }

    monkeypatch.setattr(app_module, "run_label", fake_run_label)
    return captured


def test_describe_returns_structured_label(mock_agent):
    with TestClient(app_module.app) as client:
        r = client.post(
            "/describe",
            files={"file": ("img.png", b"\x89PNG\r\n\x1a\n-fake-bytes", "image/png")},
            data={"prompt_hint": "a purple square"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "abstract swatch"
    assert body["description"] == "A solid purple square filling the frame."
    assert body["tags"] == ["purple", "square", "solid color"]
    assert body["safety"] == "sfw"
    # The route decoded the upload format and forwarded the hint to the agent.
    assert mock_agent["fmt"] == "png"
    assert mock_agent["prompt_hint"] == "a purple square"
    assert mock_agent["len"] > 0


def test_describe_works_without_prompt_hint(mock_agent):
    with TestClient(app_module.app) as client:
        r = client.post(
            "/describe",
            files={"file": ("img.webp", b"RIFFfake-webp-bytes", "image/webp")},
        )
    assert r.status_code == 200
    assert r.json()["label"] == "abstract swatch"
    assert mock_agent["fmt"] == "webp"
    assert mock_agent["prompt_hint"] is None


# ---------------------------------------------------------------------------
# _coerce_label / _coerce_safety: the GGUF output normalizer. Ensures the label
# task always gets a valid safety class so it can't dead-letter on malformed
# model output (i.e. safety is reliably DETECTED on the label queue).
# ---------------------------------------------------------------------------
def test_coerce_label_passes_through_valid_dict():
    out = app_module._coerce_label(
        {"label": "x", "description": "d", "tags": ["a", "b"], "safety": "explicit"}
    )
    assert out == {"label": "x", "description": "d", "tags": ["a", "b"], "safety": "explicit"}


def test_coerce_label_normalizes_offenum_safety():
    # Odd casing / synonym -> mapped onto the contract enum, not rejected.
    assert app_module._coerce_label({"safety": "  Questionable "})["safety"] == "nsfw"
    assert app_module._coerce_label({"safety": "SFW"})["safety"] == "sfw"
    assert app_module._coerce_label({"safety": "hardcore"})["safety"] == "explicit"


def test_coerce_label_missing_safety_defaults_sfw():
    out = app_module._coerce_label({"description": "d"})
    assert out["safety"] == "sfw"


def test_coerce_label_salvages_json_string():
    out = app_module._coerce_label('{"label":"k","description":"d","tags":[],"safety":"EXPLICIT"}')
    assert out["label"] == "k"
    assert out["safety"] == "explicit"


def test_coerce_label_unparseable_string_keeps_prose_and_defaults_sfw():
    out = app_module._coerce_label("the model rambled without emitting json")
    assert out["safety"] == "sfw"
    assert "rambled" in out["description"]


def test_coerce_label_unknown_safety_defaults_sfw():
    assert app_module._coerce_label({"safety": "weird-value"})["safety"] == "sfw"
