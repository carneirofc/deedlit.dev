"""Tests for the configured-folder scheduler + label-backfill job.

The per-folder scan scheduler (run on FOLDER_SCAN_TICK_SECONDS) reads the
folder registry from catalog and enqueues an ingest job for each enabled,
past-due folder, stamping its scan-state back. The label-backfill job relabels
every cataloged image missing an AI description via the existing reindex path.

ALL outbound HTTP (folder list, scan-state PATCH, unlabeled list, per-image
reindex, folder walk) is monkeypatched so the suite stays offline.

Covered:
  (1) a due, enabled folder enqueues an ingest job + records queued scan-state
  (2) disabled / not-yet-due / already-scanning folders are skipped
  (3) _folder_due interval math
  (4) a catalog outage during the tick is swallowed (returns [])
  (5) a scheduled scan writes its final status back to the folder on completion
  (6) label-backfill pages the unlabeled set + reindexes each image
  (7) the label-backfill scheduler tick enqueues a label-backfill job
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import app as app_module
import jobs as jobs_module
import pipeline
from jobs import QUEUED, RUNNING, Job, JobStore

SHA_A = "a" * 64
SHA_B = "b" * 64


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Fake store for the synchronous tick tests (no worker / event loop needed).
# ---------------------------------------------------------------------------
class FakeStore:
    def __init__(self, existing: list[Job] | None = None) -> None:
        self.jobs: list[Job] = list(existing or [])

    def list(self) -> list[Job]:
        return list(self.jobs)

    def create_ingest_job(self, folder_path: str, *, source_folder_id: str | None = None) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            type="ingest",
            folder_path=folder_path,
            source_folder_id=source_folder_id,
        )
        self.jobs.append(job)
        return job


@pytest.fixture
def record_calls(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        pipeline,
        "record_folder_scan",
        lambda fid, **kw: calls.append((fid, kw)),
    )
    return calls


# ---------------------------------------------------------------------------
# (1) due folder enqueues + records queued scan-state
# ---------------------------------------------------------------------------
def test_tick_enqueues_due_folder(monkeypatch, record_calls):
    folder = {
        "id": "f1",
        "path": "K:/lib/a",
        "enabled": True,
        "scan_interval_seconds": 900,
        "last_scan_at": None,  # never scanned -> due
    }
    monkeypatch.setattr(pipeline, "list_source_folders", lambda: [folder])
    store = FakeStore()

    enqueued = jobs_module.run_folder_scan_tick(store)

    assert len(enqueued) == 1
    job = enqueued[0]
    assert job.folder_path == "K:/lib/a"
    assert job.source_folder_id == "f1"
    # Scan-state advanced so the next tick won't immediately re-enqueue it.
    assert record_calls
    fid, kw = record_calls[0]
    assert fid == "f1"
    assert kw["status"] == QUEUED
    assert kw["job_id"] == job.id
    assert kw["touch_last_scan_at"] is True


# ---------------------------------------------------------------------------
# (2) skip disabled / not-due / already-scanning folders
# ---------------------------------------------------------------------------
def test_tick_skips_disabled_folder(monkeypatch, record_calls):
    folder = {"id": "f1", "path": "K:/a", "enabled": False, "scan_interval_seconds": 0, "last_scan_at": None}
    monkeypatch.setattr(pipeline, "list_source_folders", lambda: [folder])
    assert jobs_module.run_folder_scan_tick(FakeStore()) == []
    assert record_calls == []


def test_tick_skips_recently_scanned_folder(monkeypatch, record_calls):
    folder = {
        "id": "f1",
        "path": "K:/a",
        "enabled": True,
        "scan_interval_seconds": 900,
        "last_scan_at": _now_iso(),  # just scanned -> not due
    }
    monkeypatch.setattr(pipeline, "list_source_folders", lambda: [folder])
    assert jobs_module.run_folder_scan_tick(FakeStore()) == []


def test_tick_skips_folder_with_active_job(monkeypatch, record_calls):
    folder = {"id": "f1", "path": "K:/a", "enabled": True, "scan_interval_seconds": 900, "last_scan_at": None}
    monkeypatch.setattr(pipeline, "list_source_folders", lambda: [folder])
    active = Job(id="j0", type="ingest", source_folder_id="f1", status=RUNNING)
    assert jobs_module.run_folder_scan_tick(FakeStore([active])) == []


# ---------------------------------------------------------------------------
# (3) _folder_due interval math
# ---------------------------------------------------------------------------
def test_folder_due_math():
    now = datetime.now(timezone.utc)
    base = {"enabled": True, "scan_interval_seconds": 600}
    assert jobs_module._folder_due({**base, "last_scan_at": None}, now) is True
    long_ago = (now - timedelta(seconds=700)).isoformat()
    assert jobs_module._folder_due({**base, "last_scan_at": long_ago}, now) is True
    recent = (now - timedelta(seconds=100)).isoformat()
    assert jobs_module._folder_due({**base, "last_scan_at": recent}, now) is False
    assert jobs_module._folder_due({**base, "enabled": False, "last_scan_at": None}, now) is False


# ---------------------------------------------------------------------------
# (4) catalog outage during a tick is swallowed
# ---------------------------------------------------------------------------
def test_tick_swallows_catalog_outage(monkeypatch):
    def boom():
        raise RuntimeError("catalog down")

    monkeypatch.setattr(pipeline, "list_source_folders", boom)
    assert jobs_module.run_folder_scan_tick(FakeStore()) == []


# ---------------------------------------------------------------------------
# Worker-backed tests (real store + async worker via TestClient)
# ---------------------------------------------------------------------------
def _wait_for(client, job_id, statuses, timeout=5.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/jobs/{job_id}").json()
        if last["status"] in statuses:
            return last
        time.sleep(0.02)
    return last


@pytest.fixture
def fresh_store(monkeypatch):
    store = JobStore()
    monkeypatch.setattr(app_module, "store", store)
    return store


# (5) a scheduled scan writes its final status back to the folder on completion.
def test_scheduled_scan_records_completion(fresh_store, monkeypatch):
    folder = {"id": "f9", "path": "K:/lib/empty", "enabled": True, "scan_interval_seconds": 900, "last_scan_at": None}
    monkeypatch.setattr(pipeline, "list_source_folders", lambda: [folder])
    # Empty folder walk -> the scan completes instantly and offline.
    monkeypatch.setattr(jobs_module, "_list_supported_files", lambda path: [])
    records: list[dict] = []
    monkeypatch.setattr(
        pipeline, "record_folder_scan", lambda fid, **kw: records.append({"fid": fid, **kw})
    )

    with TestClient(app_module.app) as client:
        jobs = jobs_module.run_folder_scan_tick(fresh_store)
        assert len(jobs) == 1
        final = _wait_for(client, jobs[0].id, {"completed", "failed"})
        assert final["status"] == "completed"

    # queued (on enqueue) THEN completed (worker finally-hook) for this folder.
    statuses = [r["status"] for r in records if r["fid"] == "f9"]
    assert statuses[0] == QUEUED
    assert statuses[-1] == "completed"
    assert records[-1]["touch_last_scan_at"] is True


# (6) label-backfill pages the unlabeled set + reindexes each image.
def test_label_backfill_reindexes_unlabeled(fresh_store, monkeypatch):
    monkeypatch.setattr(pipeline, "list_unlabeled_sha256", lambda: [SHA_A, SHA_B])
    reindexed: list[str] = []
    monkeypatch.setattr(pipeline, "reindex_image", lambda sha: reindexed.append(sha))

    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "label-backfill"})
        assert r.status_code == 202
        job_id = r.json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})

    assert final["status"] == "completed"
    assert reindexed == [SHA_A, SHA_B]
    assert final["progress"]["total"] == 2
    assert final["progress"]["done"] == 2


def test_label_backfill_counts_per_image_failures(fresh_store, monkeypatch):
    monkeypatch.setattr(pipeline, "list_unlabeled_sha256", lambda: [SHA_A, SHA_B])

    def flaky(sha):
        if sha == SHA_A:
            raise RuntimeError("labelagent down")

    monkeypatch.setattr(pipeline, "reindex_image", flaky)

    with TestClient(app_module.app) as client:
        job_id = client.post("/jobs", json={"type": "label-backfill"}).json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})

    # One image failing doesn't abort the sweep.
    assert final["status"] == "completed"
    assert final["progress"]["failed"] == 1
    assert final["progress"]["done"] == 1


# (7) the label-backfill scheduler tick enqueues a label-backfill job.
def test_label_backfill_tick_enqueues_job(fresh_store):
    job = jobs_module.run_label_backfill_tick(fresh_store)
    assert job.type == "label-backfill"
    assert fresh_store.get(job.id) is not None
