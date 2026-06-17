"""Tests for the durable-job seam: snapshot shape + restart hydration.

The HTTP write-through itself (job_ledger / settings_client) mirrors the trusted
ledger.py pattern and is stubbed by conftest; here we cover the pure logic that
makes a restart correct — the persisted snapshot and the rebuild-from-snapshot
hydrate that marks in-flight jobs interrupted.
"""
from __future__ import annotations

import jobs as jobs_module
from jobs import (
    COMPLETED,
    INTERRUPTED,
    QUEUED,
    RUNNING,
    Job,
    JobStore,
    Progress,
)


def test_to_persist_has_snake_case_columns_and_counts():
    job = Job(id="abc", type="ingest", status=RUNNING, folder_path="K:/out")
    job.progress = Progress(total=10, done=4, skipped=1, failed=2)
    job.current_stage = "catalog"
    job.stage_counts = {"catalog": 4}
    snap = job.to_persist()
    assert snap["id"] == "abc"
    assert snap["status"] == RUNNING
    assert snap["folder_path"] == "K:/out"
    # Progress is flattened into the column names the catalog jobs table uses.
    assert (snap["total"], snap["done"], snap["skipped"], snap["failed"]) == (10, 4, 1, 2)
    assert snap["stage_counts"] == {"catalog": 4}


def test_job_from_snapshot_marks_nonterminal_interrupted():
    snap = {
        "id": "j1",
        "type": "ingest",
        "status": RUNNING,  # non-terminal -> interrupted on hydrate
        "folder_path": "K:/out",
        "total": 5,
        "done": 2,
        "created_at": "2026-06-17T10:00:00+00:00",
        "started_at": "2026-06-17T10:00:01+00:00",
        "finished_at": None,
    }
    job = jobs_module._job_from_snapshot(snap)
    assert job.status == INTERRUPTED
    assert job.progress.total == 5
    assert job.progress.done == 2
    # An interrupted job gets a synthetic finished_at so the UI shows it ended.
    assert job.finished_at is not None
    assert job.folder_path == "K:/out"


def test_job_from_snapshot_keeps_terminal_status():
    job = jobs_module._job_from_snapshot(
        {"id": "j2", "type": "ingest", "status": COMPLETED, "finished_at": None}
    )
    assert job.status == COMPLETED
    # Terminal-but-no-finish stays None (not back-filled like interrupted).
    assert job.finished_at is None


def test_hydrate_inserts_oldest_first_and_skips_existing():
    store = JobStore()
    # A live job already in the registry must not be clobbered by hydrate.
    live = Job(id="live", type="ingest", status=QUEUED)
    store._jobs["live"] = live

    # Catalog returns newest-updated first; hydrate inserts oldest-first so the
    # registry's `list` (reversed) still yields newest-first.
    snapshots = [
        {"id": "newer", "type": "ingest", "status": COMPLETED},
        {"id": "older", "type": "ingest", "status": COMPLETED},
        {"id": "live", "type": "ingest", "status": COMPLETED},  # already present -> skip
    ]
    loaded = store.hydrate(snapshots)
    assert loaded == 2  # live was skipped

    ids = [j.id for j in store.list()]  # newest-first
    assert ids[0] == "newer"
    assert "older" in ids
    # The pre-existing live job is untouched (still queued, not the snapshot's
    # completed).
    assert store.get("live").status == QUEUED


def test_hydrated_jobs_are_not_queued_for_rerun():
    store = JobStore()
    store.hydrate([{"id": "old", "type": "ingest", "status": COMPLETED}])
    # Hydration loads history only — nothing should be enqueued to run again.
    assert store._queue.qsize() == 0
