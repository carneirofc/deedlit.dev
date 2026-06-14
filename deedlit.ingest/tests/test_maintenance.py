"""Tests for the deedlit.ingest maintenance job types (issue #10).

Maintenance jobs reuse the #9 in-memory Job model + async worker loop, so they
get progress + cooperative cancel for free. All outbound HTTP (metadata, vision,
the catalog/search/graph fan-out, the catalog read of original image bytes, and
the owning-service rebuild calls) is monkeypatched so the suite is deterministic
and offline.

Covered:
  (1) POST /jobs type=reindex-one-image (with sha256) runs and reports progress
  (2) POST /jobs type=rescan-files runs over a tmp library dir
  (3) a rebuild-* type starts and completes (driving the owning service directly)
  (4) a maintenance job is cancellable mid-run
  (5) invalid/missing required fields -> 4xx (reindex without sha256, bad type)
"""
from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app as app_module
import broker as broker_module
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
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    return store


@pytest.fixture
def mock_outbound(monkeypatch):
    """Mock metadata/vision + the worker-path fan-out AND the fast-path catalog
    write + broker publish so the pipeline runs offline (ADR 0001).

    ``fanout`` records worker-path (reindex) fan-outs; ``fast`` records fast-path
    catalog writes (folder-walk / rescan); ``published`` records index tasks.
    """
    calls: dict = {
        "fanout": [], "extract": 0, "image": 0, "sparse": 0,
        "fast": [], "published": [], "published_label": [],
    }

    def fake_extract(data, filename, mime):
        calls["extract"] += 1
        return {
            "sourceTool": "a1111",
            "prompt": "a red knight",
            "negative": None,
            "tags": ["red", "knight"],
            "params": {"seed": 1},
            "references": {"checkpoints": [], "loras": []},
            "workflow_json": None,
            "api_prompt_json": None,
        }

    def fake_ingest_fast(data, filename, source_path=None, on_stage=None):
        sha = pipeline.compute_sha256(data)
        calls["fast"].append(sha)
        return sha

    async def fake_publish(sha256, parent_op_id=None):
        calls["published"].append(sha256)

    async def fake_publish_label(sha256, parent_op_id=None):
        calls["published_label"].append(sha256)

    monkeypatch.setattr(pipeline, "extract_metadata", fake_extract)
    monkeypatch.setattr(pipeline, "embed_image", lambda d, f, m: [0.1, 0.2])
    monkeypatch.setattr(pipeline, "embed_sparse", lambda t: {"indices": [1], "values": [0.5]})
    monkeypatch.setattr(pipeline, "fan_out_writes", lambda rec, *args: calls["fanout"].append(rec))
    monkeypatch.setattr(pipeline, "ingest_fast", fake_ingest_fast)
    monkeypatch.setattr(broker_module, "publish_index_task", fake_publish)
    monkeypatch.setattr(broker_module, "publish_label_task", fake_publish_label)
    return calls


def _wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/jobs/{job_id}").json()
        if last["status"] in statuses:
            return last
        time.sleep(0.02)
    return last


# ---------------------------------------------------------------------------
# (1) reindex-one-image
# ---------------------------------------------------------------------------
def test_reindex_one_image_runs_and_reports_progress(fresh_store, mock_outbound, monkeypatch):
    sha = "a" * 64
    data = _png_bytes((10, 20, 30))

    fetched: list[str] = []

    def fake_fetch(sha256):
        fetched.append(sha256)
        return data, "image/png"

    monkeypatch.setattr(pipeline, "fetch_image_bytes", fake_fetch)

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "reindex-one-image", "sha256": sha})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == "reindex-one-image"
        assert body["status"] in ("queued", "running")
        job_id = body["id"]

        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 1
        assert final["progress"]["done"] == 1

    assert fetched == [sha]
    # The single image was re-run through the pipeline and fanned out.
    assert len(mock_outbound["fanout"]) == 1


# ---------------------------------------------------------------------------
# (2) rescan-files
# ---------------------------------------------------------------------------
def test_rescan_files_walks_library_root(tmp_path, fresh_store, mock_outbound, monkeypatch):
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0), (0, 0, 255)])
    # rescan-files walks the configured library root.
    monkeypatch.setattr(jobs_module, "LIBRARY_ROOT", str(tmp_path))

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "rescan-files"})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == "rescan-files"
        job_id = body["id"]

        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 3
        assert final["progress"]["done"] == 3
        assert final["progress"]["skipped"] == 0

    # rescan now runs the synchronous fast path per file (catalog write) and
    # publishes an index + label task each — projection/labelling happen async.
    assert len(mock_outbound["fast"]) == 3
    assert len(mock_outbound["published"]) == 3
    assert len(mock_outbound["published_label"]) == 3
    assert mock_outbound["fanout"] == []


def test_rescan_files_accepts_explicit_root(tmp_path, fresh_store, mock_outbound):
    _write_pngs(tmp_path, [(1, 2, 3), (4, 5, 6)])
    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "rescan-files", "folderPath": str(tmp_path)})
        assert r.status_code == 202
        job_id = r.json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["done"] == 2


# ---------------------------------------------------------------------------
# (3) rebuild-* types start and complete (driving the owning service directly)
# ---------------------------------------------------------------------------
def test_rebuild_thumbnails_drives_catalog_rebuild(fresh_store, monkeypatch):
    """rebuild-thumbnails stays a catalog-owned rebuild (thumbnails are catalog
    blobs, not a queue projection)."""
    triggered: list[str] = []
    monkeypatch.setattr(
        pipeline, "rebuild_thumbnails", lambda: triggered.append("thumbnails") or {"ok": True}
    )

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "rebuild-thumbnails"})
        assert r.status_code == 202
        job_id = r.json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 1
        assert final["progress"]["done"] == 1

    assert triggered == ["thumbnails"]


@pytest.mark.parametrize("rtype", ["rebuild-search", "rebuild-graph"])
def test_rebuild_search_graph_bulk_publish_index(fresh_store, monkeypatch, rtype):
    """rebuild-search / rebuild-graph are bulk PRODUCERS now (ADR 0001): they
    publish an index task per cataloged image (an index task re-projects both
    stores), instead of calling an owning-service /rebuild inline."""
    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: ["a" * 64, "b" * 64])
    published: list[str] = []

    async def fake_publish_index(sha256, parent_op_id=None):
        published.append(sha256)

    monkeypatch.setattr(broker_module, "publish_index_task", fake_publish_index)

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": rtype})
        assert r.status_code == 202
        job_id = r.json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 2
        assert final["progress"]["done"] == 2

    assert sorted(published) == ["a" * 64, "b" * 64]


# ---------------------------------------------------------------------------
# (4) maintenance job cancellable mid-run
# ---------------------------------------------------------------------------
def test_rescan_files_cancellable_mid_run(tmp_path, fresh_store, monkeypatch):
    _write_pngs(tmp_path, [(i, 0, 0) for i in range(0, 60, 6)])  # 10 distinct images

    def slow_fast(data, filename, source_path=None, on_stage=None):
        time.sleep(0.05)
        return pipeline.compute_sha256(data)

    async def noop_publish(sha256, parent_op_id=None):
        return None

    monkeypatch.setattr(pipeline, "ingest_fast", slow_fast)
    monkeypatch.setattr(broker_module, "publish_index_task", noop_publish)
    monkeypatch.setattr(broker_module, "publish_label_task", noop_publish)

    with TestClient(app_module.app) as client:
        job_id = client.post(
            "/jobs", json={"type": "rescan-files", "folderPath": str(tmp_path)}
        ).json()["id"]
        _wait_for(client, job_id, {"running"}, timeout=2.0)
        time.sleep(0.12)
        cancel = client.post(f"/jobs/{job_id}/cancel").json()
        assert cancel["status"] in ("running", "cancelled")
        final = _wait_for(client, job_id, {"cancelled", "completed"})
        assert final["status"] == "cancelled"
        assert final["progress"]["done"] < 10


# ---------------------------------------------------------------------------
# (5) invalid / missing required fields -> 4xx
# ---------------------------------------------------------------------------
def test_reindex_without_sha256_is_rejected(fresh_store):
    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "reindex-one-image"})
        assert r.status_code == 422


def test_reindex_with_bad_sha256_is_rejected(fresh_store):
    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "reindex-one-image", "sha256": "nothex"})
        assert r.status_code == 422


def test_unknown_type_is_rejected(fresh_store):
    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "not-a-real-type"})
        assert r.status_code == 422
