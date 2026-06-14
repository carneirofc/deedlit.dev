"""Tests for the deedlit.ingest job lifecycle + single-file pipeline + fan-out.

All outbound HTTP (metadata, vision, and the catalog/search/graph fan-out) is
monkeypatched so the suite is deterministic and offline. Images are tiny PNGs
built with Pillow.
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
        calls["sparse_text"] = text
        return {"indices": [1, 2], "values": [0.5, 0.7]}

    def fake_describe(data, filename, mime, prompt_hint=None):
        # Default: labelagent disabled (mirrors LABELAGENT_URL unset). Individual
        # tests monkeypatch this when they want AI enrichment.
        calls["describe"] = calls.get("describe", 0) + 1
        return {}

    def fake_fanout(rec, *args):
        calls["fanout"].append(rec)

    monkeypatch.setattr(pipeline, "extract_metadata", fake_extract)
    monkeypatch.setattr(pipeline, "embed_image", fake_image)
    monkeypatch.setattr(pipeline, "embed_sparse", fake_sparse)
    monkeypatch.setattr(pipeline, "describe_image", fake_describe)
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
    # The worker passes each file's real on-disk path through the pipeline, so
    # every fanned-out record (catalog) and point payload (search) is tagged
    # with the source filepath for human identification.
    for rec in mock_outbound["fanout"]:
        assert rec.record["filepath"] is not None
        assert str(tmp_path) in rec.record["filepath"]
        assert rec.point["payload"]["filepath"] == rec.record["filepath"]


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

    # Slow, side-effecting pipeline so cancel can land mid-run. `*args` absorbs
    # the source_path + on_stage progress hook the real signature now carries.
    def slow_process(data, filename, *args):
        processed["n"] += 1
        time.sleep(0.05)
        return pipeline.IngestRecord(
            sha256=pipeline.compute_sha256(data),
            record={}, point={}, edges={}, thumbnail=None,
        )

    monkeypatch.setattr(pipeline, "process_file", slow_process)
    monkeypatch.setattr(pipeline, "fan_out_writes", lambda rec, *args: None)

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

    rec = pipeline.process_file(data, "img.png", source_path="/library/sub/img.png")
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
# (4b) labelagent enrichment folds into tags, sparse text, and the payload
# ---------------------------------------------------------------------------
def test_pipeline_folds_labelagent_into_tags_sparse_and_payload(mock_outbound, monkeypatch):
    """With the labelagent enabled, its description drives the sparse (lexical)
    text and the point payload, and its tags merge with the extracted tags."""

    def fake_describe(data, filename, mime, prompt_hint=None):
        # The extracted SD prompt is forwarded as the grounding hint.
        assert prompt_hint == "a red knight"
        return {
            "label": "fantasy character portrait",
            "description": "A red-armored knight standing in a misty forest.",
            "tags": ["knight", "armor", "forest"],
            "safety": "sfw",
        }

    monkeypatch.setattr(pipeline, "describe_image", fake_describe)

    rec = pipeline.process_file(_png_bytes((10, 20, 30), size=16), "img.png")

    # AI tags merged after the extracted tags, de-duped, order-stable, everywhere.
    merged = ["red", "knight", "armor", "forest"]
    assert rec.point["payload"]["tags"] == merged
    assert rec.record["tags"] == merged
    assert rec.edges["tags"] == merged
    # Label + description surfaced in the searchable payload.
    assert rec.point["payload"]["label"] == "fantasy character portrait"
    assert (
        rec.point["payload"]["description"]
        == "A red-armored knight standing in a misty forest."
    )
    # The (expensive) AI description is ALSO persisted on the catalog record so it
    # is retrievable/viewable without re-running the model — not only in search.
    assert (
        rec.record["description"]
        == "A red-armored knight standing in a misty forest."
    )
    # Safety class lands on the catalog record AND the search payload (filterable).
    assert rec.record["safety"] == "sfw"
    assert rec.point["payload"]["safety"] == "sfw"
    # The AI description (and the SD prompt) drive the sparse embedding text.
    assert "misty forest" in mock_outbound["sparse_text"]
    assert "a red knight" in mock_outbound["sparse_text"]


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

    def fake_post(url, json=None, timeout=None):
        calls.append(("POST", url))
        if url == f"{pipeline.CATALOG_URL}/images":
            attempts["images"] += 1
            if attempts["images"] == 1:
                return _FakeResp(500)  # transient failure, then retry succeeds
        return _FakeResp(200)

    def fake_put(url, content=None, headers=None, timeout=None):
        calls.append(("PUT", url))
        return _FakeResp(200)

    monkeypatch.setattr(pipeline.httpx, "post", fake_post)
    monkeypatch.setattr(pipeline.httpx, "put", fake_put)

    rec = pipeline.IngestRecord(
        sha256=sha,
        record={"sha256": sha},
        point={"sha256": sha, "dense": [0.0]},
        edges={"sha256": sha},
        thumbnail=b"webp-bytes",
    )
    pipeline.fan_out_writes(rec)

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
        pipeline.httpx,
        "post",
        lambda url, json=None, timeout=None: (calls.append(url) or _FakeResp(200)),
    )
    monkeypatch.setattr(
        pipeline.httpx,
        "put",
        lambda url, content=None, headers=None, timeout=None: (calls.append(url) or _FakeResp(200)),
    )

    rec = pipeline.IngestRecord(
        sha256=sha,
        record={"sha256": sha},
        point={"sha256": sha, "dense": [0.0]},
        edges={"sha256": sha},
        thumbnail=None,
    )
    pipeline.fan_out_writes(rec)

    assert f"{pipeline.CATALOG_URL}/blobs/{sha}/thumbnail" not in calls
    assert calls == [
        f"{pipeline.CATALOG_URL}/images",
        f"{pipeline.SEARCH_URL}/points",
        f"{pipeline.GRAPH_URL}/edges",
    ]


def test_fanout_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(
        pipeline.httpx, "post", lambda url, json=None, timeout=None: _FakeResp(503)
    )
    rec = pipeline.IngestRecord(
        sha256="b" * 64, record={}, point={}, edges={}, thumbnail=None
    )
    with pytest.raises(pipeline.httpx.HTTPStatusError):
        pipeline.fan_out_writes(rec)
