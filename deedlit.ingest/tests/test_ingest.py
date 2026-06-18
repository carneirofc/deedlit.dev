"""Tests for the deedlit.ingest job lifecycle + single-file pipeline + fan-out.

All outbound HTTP (metadata, vision, and the catalog/search/graph fan-out) is
monkeypatched so the suite is deterministic and offline. Images are tiny PNGs
built with Pillow.
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
    calls: dict = {
        "fanout": [], "extract": 0, "image": 0, "sparse": 0,
        "fast": [], "pub_ingest": [],
        "pub_dense": [], "pub_sparse": [], "pub_graph": [], "pub_label": [],
    }

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
        calls["sparse_text"] = text
        return {"indices": [1, 2], "values": [0.5, 0.7]}

    def fake_text(text):
        # CLIP-text embedding of the AI description (the `description` named vector).
        calls["text"] = calls.get("text", 0) + 1
        calls["description_text"] = text
        return [0.4, 0.5, 0.6]

    def fake_describe(data, filename, mime, prompt_hint=None):
        # Default: labelagent disabled (mirrors LABELAGENT_URL unset). Individual
        # tests monkeypatch this when they want AI enrichment.
        calls["describe"] = calls.get("describe", 0) + 1
        return {}

    def fake_fanout(rec, *args):
        calls["fanout"].append(rec)

    # Fast path (folder-walk ingest): catalog write + per-stage task publish, with
    # the heavy projection deferred to the DAG worker (ADR 0002). Record both so the
    # folder-walk tests can assert per-file fast-path + enqueue.
    def fake_ingest_fast(data, filename, source_path=None, on_stage=None):
        sha = pipeline.compute_sha256(data)
        calls["fast"].append({"sha256": sha, "filename": filename, "source_path": source_path})
        return sha

    # The fast path now fans out the per-stage DAG (ADR 0002): embed.dense +
    # embed.sparse + index.graph + label. Record each so the folder-walk tests can
    # assert per-file enqueue of every stage.
    def _record(key):
        async def pub(sha256, parent_op_id=None, **kwargs):
            calls[key].append(sha256)
        return pub

    monkeypatch.setattr(pipeline, "extract_metadata", fake_extract)
    monkeypatch.setattr(pipeline, "embed_image", fake_image)
    monkeypatch.setattr(pipeline, "embed_sparse_text", fake_sparse)
    monkeypatch.setattr(pipeline, "embed_text", fake_text)
    monkeypatch.setattr(pipeline, "describe_image", fake_describe)
    monkeypatch.setattr(pipeline, "fan_out_writes", fake_fanout)
    monkeypatch.setattr(pipeline, "ingest_fast", fake_ingest_fast)
    async def fake_publish_ingest(path, source_folder_id=None, parent_op_id=None):
        calls["pub_ingest"].append(path)

    monkeypatch.setattr(broker_module, "publish_ingest_task", fake_publish_ingest)
    monkeypatch.setattr(broker_module, "publish_embed_dense_task", _record("pub_dense"))
    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", _record("pub_sparse"))
    monkeypatch.setattr(broker_module, "publish_index_graph_task", _record("pub_graph"))
    monkeypatch.setattr(broker_module, "publish_label_task", _record("pub_label"))
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
    # Fast path: each file is cataloged synchronously and the per-stage DAG is
    # enqueued (embed.dense + embed.sparse + index.graph + label) — projection /
    # labelling happen async in the workers, so no inline fan-out.
    assert len(mock_outbound["fast"]) == 3
    for key in ("pub_dense", "pub_sparse", "pub_graph", "pub_label"):
        assert len(mock_outbound[key]) == 3, key
    assert mock_outbound["fanout"] == []
    # Each file's real on-disk path is carried into the fast path (so the catalog
    # record stays identifiable by its source file).
    for entry in mock_outbound["fast"]:
        assert entry["source_path"] is not None
        assert str(tmp_path) in entry["source_path"]
    # The enqueued stage tasks correspond to the cataloged images.
    cataloged = {e["sha256"] for e in mock_outbound["fast"]}
    assert set(mock_outbound["pub_dense"]) == cataloged
    assert set(mock_outbound["pub_label"]) == cataloged


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
    # Only the first run ran the fast path + enqueued (2 files); the re-run
    # skipped both (process-local sha256 dedup).
    assert len(mock_outbound["fast"]) == 2
    assert len(mock_outbound["pub_dense"]) == 2


# ---------------------------------------------------------------------------
# (2c) opt-in ingest-queue mode (ADR 0002): producer enqueues, worker catalogs
# ---------------------------------------------------------------------------
def test_ingest_via_queue_publishes_ingest_tasks(tmp_path, fresh_store, mock_outbound, monkeypatch):
    monkeypatch.setenv("INGEST_VIA_QUEUE", "true")
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0), (0, 0, 255)])
    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        final = _wait_for(client, job_id, {"completed"})
        assert final["status"] == "completed"
        assert final["progress"]["done"] == 3
    # The producer only enqueues ingest tasks; the fast path + downstream stages
    # run in the ingest-worker (not exercised here), so no inline fast path and no
    # downstream publish on this side.
    assert len(mock_outbound["pub_ingest"]) == 3
    assert all(str(tmp_path) in p for p in mock_outbound["pub_ingest"])
    assert mock_outbound["fast"] == []
    assert mock_outbound["pub_dense"] == []


def test_ingest_via_queue_falls_back_inline_when_broker_down(
    tmp_path, fresh_store, mock_outbound, monkeypatch
):
    monkeypatch.setenv("INGEST_VIA_QUEUE", "true")

    async def boom(path, source_folder_id=None, parent_op_id=None):
        raise RuntimeError("broker down")

    monkeypatch.setattr(broker_module, "publish_ingest_task", boom)
    _write_pngs(tmp_path, [(255, 0, 0), (0, 255, 0)])
    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        final = _wait_for(client, job_id, {"completed"})
        assert final["status"] == "completed"
        assert final["progress"]["done"] == 2
    # ingest publish failed -> inline fast path ran and the per-stage DAG was
    # published best-effort, so the catalog write still landed.
    assert len(mock_outbound["fast"]) == 2
    assert len(mock_outbound["pub_dense"]) == 2
    assert mock_outbound["pub_ingest"] == []


# ---------------------------------------------------------------------------
# (2b) GET /jobs lists jobs (newest first) with UI-shaped flat fields
# ---------------------------------------------------------------------------
def test_list_jobs_returns_jobs_with_flat_fields(tmp_path, fresh_store, mock_outbound):
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
        # Flat aliases the UI consumes (snake_case file counts + folder path).
        assert job["total_files"] == 2
        assert job["processed_files"] == 2
        assert job["failed_files"] == 0
        assert job["folder_path"] == str(tmp_path)
        # Nested progress is preserved for the contract / per-job detail.
        assert job["progress"]["done"] == 2


def test_list_jobs_newest_first(fresh_store, mock_outbound):
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

    processed = {"n": 0}

    # Slow fast path so cancel can land mid-run. `source_path`/`on_stage` mirror
    # the real ingest_fast signature the worker calls.
    def slow_fast(data, filename, source_path=None, on_stage=None):
        processed["n"] += 1
        time.sleep(0.05)
        return pipeline.compute_sha256(data)

    async def noop_publish(sha256, parent_op_id=None):
        return None

    # Pin to serial so the cancel point is deterministic (this test is about
    # cancellation, not concurrency).
    monkeypatch.setenv("INGEST_CONCURRENCY", "1")
    monkeypatch.setattr(pipeline, "ingest_fast", slow_fast)
    for name in (
        "publish_embed_dense_task", "publish_embed_sparse_task",
        "publish_index_graph_task", "publish_label_task",
    ):
        monkeypatch.setattr(broker_module, name, noop_publish)

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
        # 32px source is below the 1080 short-edge floor -> kept at native size
        # (downscale only, never upscaled).
        assert im.size == (32, 32)

    # A source larger than the floor is downscaled so its SHORTER edge == floor,
    # preserving aspect; the longer edge stays proportionally larger.
    big = _png_bytes((10, 20, 30), size=400)  # 400x400 square
    big_thumb = pipeline.make_webp_thumbnail(big, min_edge=100)
    assert big_thumb is not None
    with Image.open(io.BytesIO(big_thumb)) as im:
        assert min(im.size) == 100

    rec = asyncio.run(pipeline.process_file(data, "img.png", source_path="/library/sub/img.png"))
    assert rec.sha256 == pipeline.compute_sha256(data)
    assert rec.record["phash"] == phash
    assert rec.record["width"] == 32 and rec.record["height"] == 32
    assert rec.record["sha256"] == rec.sha256
    # The original source path rides on the catalog record AND the search payload
    # so an image stays identifiable by its file when inspecting the system.
    assert rec.record["filepath"] == "/library/sub/img.png"
    assert rec.point["payload"]["filepath"] == "/library/sub/img.png"
    assert rec.point["dense"] == [0.1, 0.2, 0.3]
    assert rec.point["sparse"] == {"indices": [1, 2], "values": [0.5, 0.7]}
    # search UpsertPoint is keyed by sha256 (search derives uuid5 itself); the
    # derived point id is surfaced in the payload.
    assert rec.point["sha256"] == rec.sha256
    assert rec.point["payload"]["point_id"] == pipeline.point_id_for_sha256(rec.sha256)
    # payload carries proxy URLs (with file extensions) so a hit renders straight
    # from the payload and the Qdrant dashboard shows previews. The full image
    # keeps the original extension; the thumbnail is always WebP.
    base = pipeline.COMFYHELPER_PUBLIC_URL
    assert rec.point["payload"]["image_url"] == f"{base}/api/library/images/{rec.sha256}/file.png"
    assert rec.point["payload"]["thumbnail_url"] == f"{base}/api/library/images/{rec.sha256}/thumbnail.webp"
    # references flattened to {kind,name,hash}
    assert {"kind": "checkpoint", "name": "sdxl", "hash": None} in rec.record["references"]
    assert rec.thumbnail is not None
    # labelagent disabled here (fake_describe -> {}): no AI keys clutter the payload.
    assert "label" not in rec.point["payload"]
    assert "description" not in rec.point["payload"]
    assert "safety" not in rec.point["payload"]
    # record always carries the safety + description keys (None when the labelagent
    # is off; catalog COALESCEs/keeps so a reindex never wipes a stored value).
    assert rec.record["safety"] is None
    assert rec.record["description"] is None


# ---------------------------------------------------------------------------
# (4b) process_file folds catalog TRUTH (description/safety/tags) into the
# sparse text, the point payload, the record, and the graph edges (ADR 0001).
# The index task supplies these from the catalog after a label task patches it.
# ---------------------------------------------------------------------------
def test_process_file_folds_catalog_truth_into_tags_sparse_and_payload(mock_outbound):
    rec = asyncio.run(pipeline.process_file(
        _png_bytes((10, 20, 30), size=16),
        "img.png",
        description="A red-armored knight standing in a misty forest.",
        safety="sfw",
        tags=["red", "knight", "armor", "forest"],
    ))

    # Passed-in (catalog-truth) tags flow everywhere, replacing the extracted set.
    merged = ["red", "knight", "armor", "forest"]
    assert rec.point["payload"]["tags"] == merged
    assert rec.record["tags"] == merged
    assert rec.edges["tags"] == merged
    # Description surfaced in the searchable payload AND persisted on the record.
    assert (
        rec.point["payload"]["description"]
        == "A red-armored knight standing in a misty forest."
    )
    assert (
        rec.record["description"]
        == "A red-armored knight standing in a misty forest."
    )
    # Safety class lands on the catalog record AND the search payload (filterable).
    assert rec.record["safety"] == "sfw"
    assert rec.point["payload"]["safety"] == "sfw"
    # The description (and the extracted SD prompt) drive the sparse embedding text.
    assert "misty forest" in mock_outbound["sparse_text"]
    assert "a red knight" in mock_outbound["sparse_text"]
    # The description ALSO gets its own CLIP-text dense vector on the point, embedded
    # over the description text alone (not the combined sparse text).
    assert mock_outbound["description_text"] == "A red-armored knight standing in a misty forest."
    assert rec.point["description"] == [0.4, 0.5, 0.6]


# ---------------------------------------------------------------------------
# (5) fan-out writes DIRECTLY to catalog/search/graph, catalog-first, w/ retry
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
    """Async stand-in for the pooled httpx.AsyncClient used by the fan-out."""

    def __init__(self, *, post=None, put=None):
        self._post, self._put = post, put

    async def post(self, url, json=None, **kw):
        return self._post(url, json=json)

    async def put(self, url, content=None, headers=None, **kw):
        return self._put(url, content=content, headers=headers)


def test_fanout_direct_to_owning_services_catalog_first_with_retry(monkeypatch):
    """The fan-out hits the OWNING services directly (#17), not the TS app:

      catalog POST /images -> catalog PUT /blobs/{sha}/thumbnail
        -> search POST /points -> graph POST /edges

    Catalog is FIRST (record before blob before the derived projections) and the
    catalog record POST is retried on a transient 500.
    """
    sha = "a" * 64
    calls: list[tuple[str, str]] = []  # (method, url)
    attempts = {"images": 0}

    def fake_post(url, json=None):
        calls.append(("POST", url))
        if url == f"{pipeline.CATALOG_URL}/images":
            attempts["images"] += 1
            if attempts["images"] == 1:
                return _FakeResp(500)  # transient failure, then retry succeeds
        return _FakeResp(200)

    def fake_put(url, content=None, headers=None):
        calls.append(("PUT", url))
        return _FakeResp(200)

    monkeypatch.setattr(pipeline, "get_client", lambda: _FakeClient(post=fake_post, put=fake_put))

    rec = pipeline.IngestRecord(
        sha256=sha,
        record={"sha256": sha},
        point={"sha256": sha, "dense": [0.0]},
        edges={"sha256": sha},
        thumbnail=b"webp-bytes",
    )
    asyncio.run(pipeline.fan_out_writes(rec))

    urls = [u for _m, u in calls]
    images_idx = [i for i, u in enumerate(urls) if u == f"{pipeline.CATALOG_URL}/images"]
    thumb_idx = urls.index(f"{pipeline.CATALOG_URL}/blobs/{sha}/thumbnail")
    points_idx = urls.index(f"{pipeline.SEARCH_URL}/points")
    edges_idx = urls.index(f"{pipeline.GRAPH_URL}/edges")

    # Direct service targets, NOT the TS app.
    assert all("/api/library/" not in u for u in urls)
    # Catalog record retried (2 POSTs) and the whole catalog write (record +
    # thumbnail blob) lands BEFORE search, which lands before graph.
    assert len(images_idx) == 2  # one failed + one retry success
    assert max(images_idx) < thumb_idx < points_idx < edges_idx
    # The thumbnail blob was PUT (not POSTed).
    assert ("PUT", f"{pipeline.CATALOG_URL}/blobs/{sha}/thumbnail") in calls


def test_fanout_skips_thumbnail_blob_when_absent(monkeypatch):
    """No thumbnail -> no blob PUT, but the record/point/edges still fan out."""
    sha = "c" * 64
    calls: list[str] = []
    monkeypatch.setattr(
        pipeline,
        "get_client",
        lambda: _FakeClient(
            post=lambda url, json=None: (calls.append(url) or _FakeResp(200)),
            put=lambda url, content=None, headers=None: (calls.append(url) or _FakeResp(200)),
        ),
    )

    rec = pipeline.IngestRecord(
        sha256=sha,
        record={"sha256": sha},
        point={"sha256": sha, "dense": [0.0]},
        edges={"sha256": sha},
        thumbnail=None,
    )
    asyncio.run(pipeline.fan_out_writes(rec))

    assert f"{pipeline.CATALOG_URL}/blobs/{sha}/thumbnail" not in calls
    assert calls == [
        f"{pipeline.CATALOG_URL}/images",
        f"{pipeline.SEARCH_URL}/points",
        f"{pipeline.GRAPH_URL}/edges",
    ]


def test_fanout_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(
        pipeline, "get_client",
        lambda: _FakeClient(post=lambda url, json=None: _FakeResp(503)),
    )
    rec = pipeline.IngestRecord(
        sha256="b" * 64, record={}, point={}, edges={}, thumbnail=None
    )
    with pytest.raises(pipeline.httpx.HTTPStatusError):
        asyncio.run(pipeline.fan_out_writes(rec))
