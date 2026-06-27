"""Tests for the catalog jobs registry (durable JobStore projection).

Uses the throwaway migrated-Postgres ``client`` fixture (see conftest.py), so
these exercise the real 0005_jobs_settings migration + repository SQL end-to-end.
"""
from __future__ import annotations

JOB_A = "11111111-1111-1111-1111-111111111111"
JOB_B = "22222222-2222-2222-2222-222222222222"
JOB_C = "33333333-3333-3333-3333-333333333333"


def test_upsert_creates_then_lists_and_reads(client):
    r = client.post(
        "/jobs",
        json={
            "id": JOB_A,
            "type": "ingest",
            "status": "queued",
            "folder_path": "K:/out",
        },
    )
    assert r.status_code == 200
    job = r.json()
    assert job["id"] == JOB_A
    assert job["type"] == "ingest"
    assert job["status"] == "queued"
    assert job["folder_path"] == "K:/out"

    listed = client.get("/jobs").json()
    assert any(j["id"] == JOB_A for j in listed)

    one = client.get(f"/jobs/{JOB_A}")
    assert one.status_code == 200
    assert one.json()["id"] == JOB_A


def test_upsert_same_id_updates_in_place_with_sticky_timestamps(client):
    first = client.post(
        "/jobs",
        json={
            "id": JOB_A,
            "type": "ingest",
            "status": "running",
            "started_at": "2026-06-17T10:00:00+00:00",
            "total": 10,
            "done": 3,
        },
    ).json()
    second = client.post(
        "/jobs",
        json={
            "id": JOB_A,
            "type": "ingest",
            "status": "completed",
            "total": 10,
            "done": 10,
            "finished_at": "2026-06-17T10:05:00+00:00",
        },
    ).json()
    # Same id -> same row advanced to the new state + counts.
    assert second["status"] == "completed"
    assert second["done"] == 10
    # started_at omitted on the second write is kept (COALESCE), finished added.
    assert second["started_at"] is not None
    assert second["finished_at"] is not None
    # created_at is INSERT-only (preserved across the update).
    assert second["created_at"] == first["created_at"]
    assert len(client.get("/jobs").json()) == 1


def test_stage_counts_and_report_roundtrip(client):
    job = client.post(
        "/jobs",
        json={
            "id": JOB_A,
            "type": "reconcile",
            "status": "completed",
            "stage_counts": {"catalog": 5, "search": 4},
            "report": {"catalog_count": 5, "drift": {"index.search": []}},
        },
    ).json()
    assert job["stage_counts"] == {"catalog": 5, "search": 4}
    assert job["report"]["catalog_count"] == 5


def test_interrupt_stale_flips_queued_and_running_only(client):
    client.post("/jobs", json={"id": JOB_A, "type": "ingest", "status": "queued"})
    client.post("/jobs", json={"id": JOB_B, "type": "ingest", "status": "running"})
    client.post("/jobs", json={"id": JOB_C, "type": "ingest", "status": "completed"})

    res = client.post("/jobs/interrupt-stale")
    assert res.status_code == 200
    flipped = set(res.json()["interrupted"])
    assert flipped == {JOB_A, JOB_B}

    assert client.get(f"/jobs/{JOB_A}").json()["status"] == "interrupted"
    assert client.get(f"/jobs/{JOB_B}").json()["status"] == "interrupted"
    # A terminal job is untouched.
    assert client.get(f"/jobs/{JOB_C}").json()["status"] == "completed"
    # Interrupted jobs get a finished_at so the UI shows them as ended.
    assert client.get(f"/jobs/{JOB_A}").json()["finished_at"] is not None


def test_get_unknown_job_is_404(client):
    assert client.get(f"/jobs/{JOB_A}").status_code == 404


def test_list_is_newest_updated_first(client):
    client.post("/jobs", json={"id": JOB_A, "type": "ingest", "status": "completed"})
    client.post("/jobs", json={"id": JOB_B, "type": "ingest", "status": "completed"})
    # Re-touch A so it becomes the most-recently-updated.
    client.post("/jobs", json={"id": JOB_A, "type": "ingest", "status": "failed"})
    ids = [j["id"] for j in client.get("/jobs").json()]
    assert ids[0] == JOB_A
