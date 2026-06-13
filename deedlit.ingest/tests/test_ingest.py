"""Tests for the deedlit.ingest job lifecycle + single-file pipeline + fan-out.

All outbound HTTP (metadata, vision, app fan-out) is monkeypatched so the suite
is deterministic and offline. Images are tiny PNGs built with Pillow.
"""
from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app as app_module
import jobs as jobs_module
import pipeline


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------
def _png_bytes(color: tuple[int, int, int], size: int = 16) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (size, size), color).save(out, format="PNG")
    return out.getvalue()


def _write_pngs(folder: Path, colors: list[tuple[int, int, int]]) -> list[Path]:
    paths = []
    for i, c in enumerate(colors):
        p = folder / f"img_{i}.png"
        p.write_bytes(_png_bytes(c))
        paths.append(p)
    return paths


@pytest.fixture
def fresh_store(monkeypatch):
    """Give each test a clean in-memory JobStore (fresh dedup set)."""
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    return store


@pytest.fixture
def mock_outbound(monkeypatch):
    """Mock metadata/vision/fan-out so the pipeline runs offline.

    Returns a dict recording the fan-out calls in order so tests can assert
    catalog-first ordering and retry behavior.
    """
    calls: dict = {"fanout": [], "extract": 0, "image": 0, "sparse": 0}

    def fake_extract(data, filename, mime):
        calls["extract"] += 1
        return {
            "sourceTool": "a1111",
            "prompt": "a red knight",
            "negative": None,
            "tags": ["red", "knight"],
            "params": {"seed": 1, "steps": 20},
            "references": {"checkpoints": [{"name": "sdxl", "hash": None}], "loras": []},
            "workflow_json": None,
            "api_prompt_json": None,
        }

    def fake_image(data, filename, mime):
        calls["image"] += 1
        return [0.1, 0.2, 0.3]

    def fake_sparse(text):
        calls["sparse"] += 1
        return {"indices": [1, 2], "values": [0.5, 0.7]}

    def fake_fanout(rec):
        calls["fanout"].append(rec)

    monkeypatch.setattr(pipeline, "extract_metadata", fake_extract)
    monkeypatch.setattr(pipeline, "embed_image", fake_image)
    monkeypatch.setattr(pipeline, "embed_sparse", fake_sparse)
    monkeypatch.setattr(pipeline, "fan_out_writes", fake_fanout)
    return calls


def _wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 5.0) -> dict:
    """Poll GET /jobs/{id} until status is in `statuses` (lets the worker run)."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/jobs/{job_id}").json()
        if last["status"] in statuses:
            return last
        time.sleep(0.02)
    return last


# ---------------------------------------------------------------------------
# (1) POST /ingest returns a job and processes files
# ---------------------------------------------------------------------------
def test_ingest_returns_job_and_processes_files(tmp_path, fresh_store, mock_outbound):
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0), (0, 0, 255)])
    with TestClient(app_module.app) as client:
        r = client.post("/ingest", json={"folderPath": str(tmp_path)})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == "ingest"
        assert body["status"] in ("queued", "running")
        job_id = body["id"]

        final = _wait_for(client, job_id, {"completed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 3
        assert final["progress"]["done"] == 3
        assert final["progress"]["skipped"] == 0
        assert final["progress"]["failed"] == 0
    assert len(mock_outbound["fanout"]) == 3


# ---------------------------------------------------------------------------
# (2) sha256 dedup — re-running the same folder skips unchanged
# ---------------------------------------------------------------------------
def test_dedup_skips_unchanged_on_rerun(tmp_path, fresh_store, mock_outbound):
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0)])
    with TestClient(app_module.app) as client:
        first = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()
        f1 = _wait_for(client, first["id"], {"completed"})
        assert f1["progress"]["done"] == 2
        assert f1["progress"]["skipped"] == 0

        second = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()
        f2 = _wait_for(client, second["id"], {"completed"})
        assert f2["progress"]["total"] == 2
        assert f2["progress"]["done"] == 0
        assert f2["progress"]["skipped"] == 2
    # Only the first run fanned out (2 files); the re-run skipped both.
    assert len(mock_outbound["fanout"]) == 2


# ---------------------------------------------------------------------------
# (3) cancel mid-run leaves status=cancelled
# ---------------------------------------------------------------------------
def test_cancel_mid_run(tmp_path, fresh_store, monkeypatch):
    _write_pngs(tmp_path, [(i, 0, 0) for i in range(0, 60, 6)])  # 10 distinct images

    processed = {"n": 0}

    # Slow, side-effecting pipeline so cancel can land mid-run.
    def slow_process(data, filename):
        processed["n"] += 1
        time.sleep(0.05)
        return pipeline.IngestRecord(
            sha256=pipeline.compute_sha256(data),
            record={}, point={}, edges={}, thumbnail=None,
        )

    monkeypatch.setattr(pipeline, "process_file", slow_process)
    monkeypatch.setattr(pipeline, "fan_out_writes", lambda rec: None)

    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        # Let a couple files process, then cancel.
        _wait_for(client, job_id, {"running"}, timeout=2.0)
        time.sleep(0.12)
        cancel = client.post(f"/jobs/{job_id}/cancel").json()
        assert cancel["status"] in ("running", "cancelled")
        final = _wait_for(client, job_id, {"cancelled", "completed"})
        assert final["status"] == "cancelled"
        # Did not process all 10 files.
        assert final["progress"]["done"] < 10


# ---------------------------------------------------------------------------
# (4) pipeline computes sha256/phash/dims and a WebP thumbnail
# ---------------------------------------------------------------------------
def test_pipeline_computes_hashes_dims_thumbnail(mock_outbound):
    data = _png_bytes((123, 50, 200), size=32)

    assert len(pipeline.compute_sha256(data)) == 64
    assert pipeline.compute_sha256(data) == pipeline.compute_sha256(data)

    phash = pipeline.compute_phash(data)
    assert isinstance(phash, str) and len(phash) == 16

    w, h = pipeline.compute_dims(data)
    assert (w, h) == (32, 32)

    thumb = pipeline.make_webp_thumbnail(data)
    assert thumb is not None
    with Image.open(io.BytesIO(thumb)) as im:
        assert im.format == "WEBP"

    rec = pipeline.process_file(data, "img.png")
    assert rec.sha256 == pipeline.compute_sha256(data)
    assert rec.record["phash"] == phash
    assert rec.record["width"] == 32 and rec.record["height"] == 32
    assert rec.record["sha256"] == rec.sha256
    assert rec.point["dense"] == [0.1, 0.2, 0.3]
    assert rec.point["sparse"] == {"indices": [1, 2], "values": [0.5, 0.7]}
    assert rec.point["id"] == pipeline.point_id_for_sha256(rec.sha256)
    # references flattened to {kind,name,hash}
    assert {"kind": "checkpoint", "name": "sdxl", "hash": None} in rec.record["references"]
    assert rec.thumbnail is not None


# ---------------------------------------------------------------------------
# (5) fan-out calls catalog-first with retry on transient failure
# ---------------------------------------------------------------------------
def test_fanout_catalog_first_with_retry(monkeypatch):
    posted: list[str] = []
    attempts = {"n": 0}

    class FakeResp:
        def __init__(self, status_code):
            self.status_code = status_code
            self.request = None
            self.response = None

        def raise_for_status(self):
            if self.status_code >= 400:
                raise pipeline.httpx.HTTPStatusError("err", request=None, response=None)

    def fake_post(url, json=None, timeout=None):
        posted.append(url)
        # First call to the catalog endpoint fails transiently (500), then 200.
        if url.endswith("/api/library/images"):
            attempts["n"] += 1
            if attempts["n"] == 1:
                return FakeResp(500)
        return FakeResp(200)

    monkeypatch.setattr(pipeline.httpx, "post", fake_post)

    rec = pipeline.IngestRecord(
        sha256="a" * 64,
        record={"sha256": "a" * 64},
        point={"sha256": "a" * 64, "dense": [0.0]},
        edges={"sha256": "a" * 64},
        thumbnail=None,
    )
    pipeline.fan_out_writes(rec)

    # Catalog retried (2 posts to images) and succeeded BEFORE search/graph ran.
    images_idx = [i for i, u in enumerate(posted) if u.endswith("/api/library/images")]
    points_idx = posted.index(f"{pipeline.APP_WRITE_URL}/api/library/points")
    edges_idx = posted.index(f"{pipeline.APP_WRITE_URL}/api/library/edges")
    assert len(images_idx) == 2  # one failed + one retry success
    assert max(images_idx) < points_idx < edges_idx  # catalog-first ordering


def test_fanout_raises_after_exhausting_retries(monkeypatch):
    class FakeResp:
        status_code = 503
        request = None
        response = None

        def raise_for_status(self):
            raise pipeline.httpx.HTTPStatusError("err", request=None, response=None)

    monkeypatch.setattr(pipeline.httpx, "post", lambda url, json=None, timeout=None: FakeResp())
    rec = pipeline.IngestRecord(
        sha256="b" * 64, record={}, point={}, edges={}, thumbnail=None
    )
    with pytest.raises(pipeline.httpx.HTTPStatusError):
        pipeline.fan_out_writes(rec)
