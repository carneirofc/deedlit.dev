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

import asyncio
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
    """Record every broker publish the producer makes (queue-driven, offline).

    ``pub_ingest`` records ``ingest`` task enqueues (folder-walk / rescan);
    ``pub_dense``/``pub_sparse``/``pub_graph``/``pub_label`` record the per-stage
    DAG publishes (reindex reproject + any direct stage publish).
    """
    calls: dict = {
        "pub_ingest": [],
        "pub_dense": [], "pub_sparse": [], "pub_graph": [], "pub_label": [],
    }

    async def fake_publish_ingest(path, source_folder_id=None, parent_op_id=None):
        calls["pub_ingest"].append(path)

    def _record(key):
        async def pub(sha256, parent_op_id=None, **kwargs):
            calls[key].append(sha256)
        return pub

    monkeypatch.setattr(broker_module, "publish_ingest_task", fake_publish_ingest)
    monkeypatch.setattr(broker_module, "publish_embed_dense_task", _record("pub_dense"))
    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", _record("pub_sparse"))
    monkeypatch.setattr(broker_module, "publish_index_graph_task", _record("pub_graph"))
    monkeypatch.setattr(broker_module, "publish_label_task", _record("pub_label"))
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
def test_reindex_one_image_republishes_projection_stages(fresh_store, mock_outbound):
    sha = "a" * 64

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

    # The image is re-projected via the queue: embed.dense + embed.sparse (which
    # fan into index.search) + index.graph — from catalog truth, no inline pipeline.
    assert mock_outbound["pub_dense"] == [sha]
    assert mock_outbound["pub_sparse"] == [sha]
    assert mock_outbound["pub_graph"] == [sha]
    # reindex does NOT re-label (that is the separate label task / label-backfill).
    assert mock_outbound["pub_label"] == []


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

    # rescan walks the root and PUBLISHES one ingest task per file — the worker
    # pool catalogs + projects them; the producer does no inline work.
    assert len(mock_outbound["pub_ingest"]) == 3
    assert all(str(tmp_path) in p for p in mock_outbound["pub_ingest"])


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
def test_rebuild_search_graph_bulk_reproject(fresh_store, monkeypatch, rtype):
    """rebuild-search / rebuild-graph are bulk PRODUCERS (ADR 0002): they
    re-publish the projection stages (embed.dense + embed.sparse -> index.search,
    plus index.graph) per cataloged image, instead of calling an owning-service
    /rebuild inline."""
    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: ["a" * 64, "b" * 64])
    pub: dict[str, list[str]] = {"embed.dense": [], "embed.sparse": [], "index.graph": []}

    def _record(key):
        async def fake(sha256, parent_op_id=None):
            pub[key].append(sha256)
        return fake

    monkeypatch.setattr(broker_module, "publish_embed_dense_task", _record("embed.dense"))
    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", _record("embed.sparse"))
    monkeypatch.setattr(broker_module, "publish_index_graph_task", _record("index.graph"))

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": rtype})
        assert r.status_code == 202
        job_id = r.json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 2
        assert final["progress"]["done"] == 2

    for key in pub:
        assert sorted(pub[key]) == ["a" * 64, "b" * 64], key


# ---------------------------------------------------------------------------
# (4) maintenance job cancellable mid-run
# ---------------------------------------------------------------------------
def test_rescan_files_cancellable_mid_run(tmp_path, fresh_store, monkeypatch):
    _write_pngs(tmp_path, [(i, 0, 0) for i in range(0, 60, 6)])  # 10 distinct images

    # Slow publish so cancel can land mid-run. Pin to serial so the cancel point
    # is deterministic (this test is about cancellation, not concurrency).
    async def slow_publish(path, source_folder_id=None, parent_op_id=None):
        await asyncio.sleep(0.05)

    monkeypatch.setenv("INGEST_CONCURRENCY", "1")
    monkeypatch.setattr(broker_module, "publish_ingest_task", slow_publish)

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
