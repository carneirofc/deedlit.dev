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
    """Mock metadata/vision/fan-out so the pipeline runs offline."""
    calls: dict = {"fanout": [], "extract": 0, "image": 0, "sparse": 0}

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

    monkeypatch.setattr(pipeline, "extract_metadata", fake_extract)
    monkeypatch.setattr(pipeline, "embed_image", lambda d, f, m: [0.1, 0.2])
    monkeypatch.setattr(pipeline, "embed_sparse", lambda t: {"indices": [1], "values": [0.5]})
    monkeypatch.setattr(pipeline, "fan_out_writes", lambda rec, *args: calls["fanout"].append(rec))
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

    assert len(mock_outbound["fanout"]) == 3


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
@pytest.mark.parametrize(
    "rtype,func_name",
    [
        ("rebuild-search", "rebuild_search"),       # search POST /rebuild
        ("rebuild-graph", "rebuild_graph"),         # graph  POST /rebuild
        ("rebuild-thumbnails", "rebuild_thumbnails"),  # catalog-owned rebuild
    ],
)
def test_rebuild_types_drive_owning_service(fresh_store, monkeypatch, rtype, func_name):
    triggered: list[str] = []

    def make_fake(name):
        def fake():
            triggered.append(name)
            return {"ok": True}

        return fake

    # Mock every owning-service rebuild so we can assert exactly one fired.
    monkeypatch.setattr(pipeline, "rebuild_search", make_fake("rebuild_search"))
    monkeypatch.setattr(pipeline, "rebuild_graph", make_fake("rebuild_graph"))
    monkeypatch.setattr(pipeline, "rebuild_thumbnails", make_fake("rebuild_thumbnails"))

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": rtype})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == rtype
        job_id = body["id"]

        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        # A rebuild is a single unit of work.
        assert final["progress"]["total"] == 1
        assert final["progress"]["done"] == 1

    assert triggered == [func_name]


# ---------------------------------------------------------------------------
# (4) maintenance job cancellable mid-run
# ---------------------------------------------------------------------------
def test_rescan_files_cancellable_mid_run(tmp_path, fresh_store, monkeypatch):
    _write_pngs(tmp_path, [(i, 0, 0) for i in range(0, 60, 6)])  # 10 distinct images

    def slow_process(data, filename, *args):
        time.sleep(0.05)
        return pipeline.IngestRecord(
            sha256=pipeline.compute_sha256(data),
            record={}, point={}, edges={}, thumbnail=None,
        )

    monkeypatch.setattr(pipeline, "process_file", slow_process)
    monkeypatch.setattr(pipeline, "fan_out_writes", lambda rec, *args: None)

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
