"""Tests for the SPLADE sparse text-embedding endpoint (`POST /embed/sparse`).

These exercise the real fastembed SPLADE model, which downloads on first use
(small). The endpoint lazy-loads the model exactly like the CLIP towers, so
`/health` should report `sparse_ready=true` only after a sparse call.
"""
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_sparse_embed_returns_aligned_indices_and_values():
    resp = client.post("/embed/sparse", json={"text": "a red sports car"})
    assert resp.status_code == 200, resp.text

    body = resp.json()
    indices = body["indices"]
    values = body["values"]

    # Non-empty and aligned.
    assert len(indices) > 0
    assert len(values) > 0
    assert len(indices) == len(values)

    # Correct element types: plain ints / floats (JSON-serializable, not numpy).
    assert all(isinstance(i, int) for i in indices)
    assert all(isinstance(v, float) for v in values)


def test_health_reports_sparse_ready_after_sparse_call():
    # A sparse call must have happened (run a fresh one to be order-independent).
    client.post("/embed/sparse", json={"text": "warm up the sparse model"})

    resp = client.get("/health")
    assert resp.status_code == 200, resp.text
    assert resp.json()["sparse_ready"] is True


def test_models_includes_sparse_section():
    resp = client.get("/models")
    assert resp.status_code == 200, resp.text
    assert "sparse" in resp.json()


def test_sparse_embed_rejects_empty_text():
    resp = client.post("/embed/sparse", json={"text": "   "})
    assert resp.status_code == 400
