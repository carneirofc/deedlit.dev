"""Tests for the live-observability additions:

  - the per-service ActivityTracker + GET /activity endpoint (activity.py),
  - pipeline-stage emissions threaded through process_file / fan_out_writes,
  - the ingest Job's current_stage / stage_counts + lifecycle timestamps.

All outbound HTTP is monkeypatched so the suite stays offline/deterministic.
"""
from __future__ import annotations

import io
import time

from fastapi.testclient import TestClient
from PIL import Image

import app as app_module
import jobs as jobs_module
import pipeline
from activity import ActivityTracker


def _png_bytes(color: tuple[int, int, int] = (255, 0, 0), size: int = 16) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (size, size), color).save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------------------
# ActivityTracker (the shared per-service module copied into every service)
# ---------------------------------------------------------------------------
def test_activity_tracker_counts_inflight_throughput_and_last_op():
    t = ActivityTracker()
    assert t.snapshot() == {"inflight": 0, "per_min": 0.0, "busy": False, "last_op": None}

    t.begin("GET /jobs")
    s = t.snapshot()
    assert s["inflight"] == 1
    assert s["busy"] is True
    assert s["last_op"] == "GET /jobs"

    t.end()
    s = t.snapshot()
    assert s["inflight"] == 0
    assert s["busy"] is False
    assert s["per_min"] == 1.0  # one completion inside the 60s window


def test_activity_endpoint_excludes_probes_and_reports_last_real_op():
    with TestClient(app_module.app) as client:
        client.get("/health")  # probe — excluded from counters + last_op
        client.get("/jobs")  # real work — counted, sets last_op
        snap = client.get("/activity").json()  # probe — excluded
    assert set(snap) == {"inflight", "per_min", "busy", "last_op"}
    assert snap["inflight"] == 0
    assert snap["busy"] is False
    assert snap["per_min"] >= 1.0  # at least the /jobs call counted
    # /health and /activity are excluded, so the last recorded op is /jobs.
    assert snap["last_op"] == "GET /jobs"


# ---------------------------------------------------------------------------
# Pipeline stage emissions (which microservice is active, in order)
# ---------------------------------------------------------------------------
def test_process_file_emits_stages_in_order(monkeypatch):
    monkeypatch.setattr(pipeline, "extract_metadata", lambda d, f, m: {"prompt": "x", "tags": []})
    monkeypatch.setattr(pipeline, "describe_image", lambda d, f, m, prompt_hint=None: {})
    monkeypatch.setattr(pipeline, "embed_image", lambda d, f, m: [0.1])
    monkeypatch.setattr(pipeline, "embed_sparse", lambda t: {"indices": [], "values": []})

    stages: list[str] = []
    pipeline.process_file(_png_bytes(), "img.png", None, stages.append)
    assert stages == ["hash", "metadata", "label", "vision:dense", "vision:sparse"]


def test_fan_out_writes_emits_stages_in_order(monkeypatch):
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_put_blob_with_retry", lambda *a, **k: None)

    rec = pipeline.IngestRecord(sha256="a" * 64, record={}, point={}, edges={}, thumbnail=b"x")
    stages: list[str] = []
    pipeline.fan_out_writes(rec, stages.append)
    assert stages == ["catalog", "search", "graph"]


# ---------------------------------------------------------------------------
# Job stage callback + serialization
# ---------------------------------------------------------------------------
def test_job_stage_callback_records_current_and_counts():
    job = jobs_module.Job(id="j", type="ingest")
    cb = job.stage_callback()
    cb("metadata")
    cb("metadata")
    cb("vision:dense")

    assert job.current_stage == "vision:dense"
    assert job.stage_counts == {"metadata": 2, "vision:dense": 1}

    d = job.to_dict()
    assert d["current_stage"] == "vision:dense"
    assert d["stage_counts"] == {"metadata": 2, "vision:dense": 1}
    # created_at is stamped on construction; started/finished only once running.
    assert isinstance(d["created_at"], str) and d["created_at"]
    assert d["started_at"] is None
    assert d["finished_at"] is None


# ---------------------------------------------------------------------------
# End-to-end: a real ingest sets timestamps + the full per-stage staircase
# ---------------------------------------------------------------------------
def test_ingest_run_sets_timestamps_and_full_stage_staircase(tmp_path, monkeypatch):
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    # Stub only the outbound clients; keep the REAL process_file + fan_out_writes
    # so every stage (including catalog/search/graph) is exercised offline.
    monkeypatch.setattr(pipeline, "extract_metadata", lambda d, f, m: {"prompt": "p", "tags": ["t"]})
    monkeypatch.setattr(pipeline, "describe_image", lambda d, f, m, prompt_hint=None: {})
    monkeypatch.setattr(pipeline, "embed_image", lambda d, f, m: [0.1, 0.2])
    monkeypatch.setattr(pipeline, "embed_sparse", lambda t: {"indices": [1], "values": [0.5]})
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_put_blob_with_retry", lambda *a, **k: None)

    (tmp_path / "a.png").write_bytes(_png_bytes((1, 2, 3)))
    (tmp_path / "b.png").write_bytes(_png_bytes((4, 5, 6)))

    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        deadline = time.time() + 5.0
        final = None
        while time.time() < deadline:
            final = client.get(f"/jobs/{job_id}").json()
            if final["status"] == "completed":
                break
            time.sleep(0.02)

    assert final is not None and final["status"] == "completed"
    # Lifecycle timestamps populated (the UI shows created/started/finished).
    assert final["created_at"] and final["started_at"] and final["finished_at"]
    # Every microservice stage was reached once per file (2 files).
    sc = final["stage_counts"]
    for stage in [
        "hash",
        "metadata",
        "label",
        "vision:dense",
        "vision:sparse",
        "catalog",
        "search",
        "graph",
    ]:
        assert sc.get(stage) == 2, f"stage {stage}: {sc.get(stage)}"
    # The final stage of the last file is the graph write.
    assert final["current_stage"] == "graph"
