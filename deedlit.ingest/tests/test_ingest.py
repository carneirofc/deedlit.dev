"""Tests for the deedlit.ingest job lifecycle + the ``ingest`` queue stage.

Ingest is FULLY QUEUE-DRIVEN (ADR 0001/0002): a folder scan only PUBLISHES one
``ingest`` task per file — the worker pool reads the bytes, catalogs them, and
fans out the per-stage DAG. The producer does no processing and has no inline
fallback, so RabbitMQ is the durability boundary. All broker publishes are
monkeypatched so the suite is deterministic and offline; images are tiny PNGs.
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
    """Give each test a clean in-memory JobStore."""
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    return store


@pytest.fixture
def mock_publish(monkeypatch):
    """Record the ``ingest`` task publishes — the producer's only outbound call.

    Returns a dict whose ``pub_ingest`` list holds every published file path so a
    folder-scan test can assert one enqueue per file.
    """
    calls: dict = {"pub_ingest": []}

    async def fake_publish_ingest(path, source_folder_id=None, parent_op_id=None):
        calls["pub_ingest"].append(path)

    monkeypatch.setattr(broker_module, "publish_ingest_task", fake_publish_ingest)
    # No catalog in tests: "nothing cataloged" so a folder scan enqueues every
    # file. The incremental dedup-skip path has its own test below.
    monkeypatch.setattr(pipeline, "list_catalog_filepaths_under", lambda folder: set())
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
# (1) POST /ingest enqueues one ingest task per file
# ---------------------------------------------------------------------------
def test_ingest_returns_job_and_enqueues_each_file(tmp_path, fresh_store, mock_publish):
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
        assert final["progress"]["done"] == 3  # done counts files ENQUEUED
        assert final["progress"]["skipped"] == 0
        assert final["progress"]["failed"] == 0
    # One ingest task per file, each carrying the real on-disk path so the worker
    # can read the bytes off the shared disk.
    assert len(mock_publish["pub_ingest"]) == 3
    assert all(str(tmp_path) in p for p in mock_publish["pub_ingest"])


# ---------------------------------------------------------------------------
# (2c) incremental scan: files already cataloged (by path) are skipped, so a
# scheduled re-walk / re-ingest of an unchanged library enqueues nothing — the
# fix for the re-enqueue storm that re-embedded + re-labelled everything per scan.
# ---------------------------------------------------------------------------
def test_already_cataloged_files_are_skipped(tmp_path, fresh_store, monkeypatch):
    paths = _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0), (0, 0, 255)])
    # Catalog already holds the first two (forward-slash normalized, as the real
    # boundary returns); the third is new.
    cataloged = {str(paths[0]).replace("\\", "/"), str(paths[1]).replace("\\", "/")}
    monkeypatch.setattr(pipeline, "list_catalog_filepaths_under", lambda folder: cataloged)
    published: list[str] = []

    async def fake_publish_ingest(path, source_folder_id=None, parent_op_id=None):
        published.append(path)

    monkeypatch.setattr(broker_module, "publish_ingest_task", fake_publish_ingest)

    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        final = _wait_for(client, job_id, {"completed"})
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 3
        assert final["progress"]["skipped"] == 2  # the two already-cataloged
        assert final["progress"]["done"] == 1  # only the new file enqueued
    assert len(published) == 1
    assert published[0].replace("\\", "/") == str(paths[2]).replace("\\", "/")


# ---------------------------------------------------------------------------
# (2b) broker down -> files fail (no inline fallback; RabbitMQ is required)
# ---------------------------------------------------------------------------
def test_broker_down_marks_files_failed(tmp_path, fresh_store, monkeypatch):
    async def boom(path, source_folder_id=None, parent_op_id=None):
        raise RuntimeError("broker down")

    monkeypatch.setattr(broker_module, "publish_ingest_task", boom)
    monkeypatch.setattr(pipeline, "list_catalog_filepaths_under", lambda folder: set())
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0)])
    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        final = _wait_for(client, job_id, {"completed"})
        # The job still settles; every file is counted failed (nothing cataloged).
        assert final["status"] == "completed"
        assert final["progress"]["total"] == 2
        assert final["progress"]["failed"] == 2
        assert final["progress"]["done"] == 0


# ---------------------------------------------------------------------------
# (2c) GET /jobs lists jobs (newest first) with UI-shaped flat fields
# ---------------------------------------------------------------------------
def test_list_jobs_returns_jobs_with_flat_fields(tmp_path, fresh_store, mock_publish):
    # Without this list endpoint the gateway GET /jobs 405s -> [] and the UI's
    # job poller never sees progress/completion. The flat *_files aliases are
    # what the UI dashboard/dock normalize on.
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0)])
    with TestClient(app_module.app) as client:
        first = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()
        final = _wait_for(client, first["id"], {"completed"})
        assert final["status"] == "completed"

        listed = client.get("/jobs")
        assert listed.status_code == 200
        jobs = listed.json()
        assert isinstance(jobs, list) and len(jobs) == 1
        job = jobs[0]
        assert job["total_files"] == 2
        assert job["processed_files"] == 2
        assert job["failed_files"] == 0
        assert job["folder_path"] == str(tmp_path)
        assert job["progress"]["done"] == 2


def test_list_jobs_newest_first(fresh_store, mock_publish):
    with TestClient(app_module.app) as client:
        a = client.post("/jobs", json={"type": "rebuild-search"}).json()["id"]
        b = client.post("/jobs", json={"type": "rebuild-graph"}).json()["id"]
        ids = [j["id"] for j in client.get("/jobs").json()]
        # Most recently created job appears first.
        assert ids[0] == b and ids[1] == a


# ---------------------------------------------------------------------------
# (3) cancel mid-run leaves status=cancelled
# ---------------------------------------------------------------------------
def test_cancel_mid_run(tmp_path, fresh_store, monkeypatch):
    _write_pngs(tmp_path, [(i, 0, 0) for i in range(0, 60, 6)])  # 10 distinct images

    # Slow publish so cancel can land mid-run. Pin concurrency to 1 so the cancel
    # point is deterministic (this test is about cancellation, not concurrency).
    async def slow_publish(path, source_folder_id=None, parent_op_id=None):
        await asyncio.sleep(0.05)

    monkeypatch.setenv("INGEST_CONCURRENCY", "1")
    monkeypatch.setattr(broker_module, "publish_ingest_task", slow_publish)
    monkeypatch.setattr(pipeline, "list_catalog_filepaths_under", lambda folder: set())

    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        _wait_for(client, job_id, {"running"}, timeout=2.0)
        time.sleep(0.12)
        cancel = client.post(f"/jobs/{job_id}/cancel").json()
        assert cancel["status"] in ("running", "cancelled")
        final = _wait_for(client, job_id, {"cancelled", "completed"})
        assert final["status"] == "cancelled"
        # Did not enqueue all 10 files.
        assert final["progress"]["done"] < 10


# ---------------------------------------------------------------------------
# (4) local pixel work: sha256/phash/dims + a WebP thumbnail (downscale-only)
# ---------------------------------------------------------------------------
def test_pixel_work_hashes_dims_thumbnail():
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
        # 32px source is below the 1080 short-edge floor -> kept at native size.
        assert im.size == (32, 32)

    # A source larger than the floor is downscaled so its SHORTER edge == floor.
    big = _png_bytes((10, 20, 30), size=400)  # 400x400 square
    big_thumb = pipeline.make_webp_thumbnail(big, min_edge=100)
    assert big_thumb is not None
    with Image.open(io.BytesIO(big_thumb)) as im:
        assert min(im.size) == 100


# ---------------------------------------------------------------------------
# (5) per-store retry on a transient 5xx, then fail after exhausting retries.
# The retry helper backs every stage's catalog/search/graph write (ingest_fast +
# the DAG stages), so it is exercised directly.
# ---------------------------------------------------------------------------
class _FakeResp:
    def __init__(self, status_code):
        self.status_code = status_code
        self.request = None
        self.response = None

    def raise_for_status(self):
        if self.status_code >= 400:
            raise pipeline.httpx.HTTPStatusError("err", request=None, response=None)


class _FakeClient:
    """Async stand-in for the pooled httpx.AsyncClient used by the retry helper."""

    def __init__(self, *, post=None):
        self._post = post

    async def post(self, url, json=None, **kw):
        return self._post(url, json=json)


def test_post_with_retry_retries_5xx_then_succeeds(monkeypatch):
    attempts = {"n": 0}

    def fake_post(url, json=None):
        attempts["n"] += 1
        return _FakeResp(500 if attempts["n"] == 1 else 200)

    monkeypatch.setattr(pipeline, "get_client", lambda: _FakeClient(post=fake_post))
    asyncio.run(pipeline._post_with_retry(f"{pipeline.CATALOG_URL}/images", {"sha256": "a" * 64}))
    assert attempts["n"] == 2  # one transient failure, then a retry success


def test_post_with_retry_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(
        pipeline, "get_client", lambda: _FakeClient(post=lambda url, json=None: _FakeResp(503))
    )
    with pytest.raises(pipeline.httpx.HTTPStatusError):
        asyncio.run(pipeline._post_with_retry(f"{pipeline.CATALOG_URL}/images", {}))
