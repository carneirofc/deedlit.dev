"""Tests for the power-user image patch fields (#30): prompt / negative.

Uses the throwaway migrated-Postgres ``client`` fixture (conftest.py).
"""
from __future__ import annotations

SHA = "a" * 64


def test_patch_image_prompt_negative_and_safety(client):
    client.post("/images", json={"sha256": SHA, "prompt": "old prompt", "tags": []})

    r = client.patch(
        f"/images/{SHA}",
        json={"prompt": "corrected prompt", "negative": "blurry", "safety": "nsfw"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["prompt"] == "corrected prompt"
    assert body["negative"] == "blurry"
    assert body["safety"] == "nsfw"

    # Persisted (re-read).
    got = client.get(f"/images/{SHA}").json()
    assert got["prompt"] == "corrected prompt"
    assert got["negative"] == "blurry"


def test_patch_image_unknown_is_404(client):
    assert client.patch(f"/images/{'b' * 64}", json={"prompt": "x"}).status_code == 404
