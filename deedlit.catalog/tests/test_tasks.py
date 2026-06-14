"""Tests for the catalog tasks ledger (#27, ADR 0001).

Uses the throwaway migrated-Postgres ``client`` fixture (see conftest.py), so
these exercise the real 0004_tasks migration + repository SQL end-to-end.
"""
from __future__ import annotations

SHA_A = "a" * 64
SHA_B = "b" * 64


def test_upsert_creates_then_lists_and_reads(client):
    r = client.post("/tasks", json={"sha256": SHA_A, "type": "index", "status": "queued"})
    assert r.status_code == 200
    task = r.json()
    assert task["sha256"] == SHA_A
    assert task["type"] == "index"
    assert task["status"] == "queued"
    assert task["attempts"] == 0
    task_id = task["id"]

    listed = client.get("/tasks").json()
    assert any(t["id"] == task_id for t in listed)

    one = client.get(f"/tasks/{task_id}")
    assert one.status_code == 200
    assert one.json()["id"] == task_id


def test_upsert_is_one_row_per_sha_and_type(client):
    first = client.post(
        "/tasks", json={"sha256": SHA_A, "type": "index", "status": "queued"}
    ).json()
    second = client.post(
        "/tasks", json={"sha256": SHA_A, "type": "index", "status": "running"}
    ).json()
    # Same (sha256, type) -> same row, advanced to the new state.
    assert second["id"] == first["id"]
    assert second["status"] == "running"
    # A different type for the same image is a distinct row.
    label = client.post(
        "/tasks", json={"sha256": SHA_A, "type": "label", "status": "queued"}
    ).json()
    assert label["id"] != first["id"]
    assert len(client.get("/tasks", params={"sha256": SHA_A}).json()) == 2


def test_attempts_kept_when_omitted_and_error_cleared_on_success(client):
    client.post("/tasks", json={"sha256": SHA_A, "type": "index", "status": "queued"})
    # A failure records attempts + error.
    failed = client.post(
        "/tasks",
        json={"sha256": SHA_A, "type": "index", "status": "failed", "attempts": 2, "error": "boom"},
    ).json()
    assert failed["attempts"] == 2
    assert failed["error"] == "boom"
    # Running again without attempts keeps the existing count.
    running = client.post(
        "/tasks", json={"sha256": SHA_A, "type": "index", "status": "running"}
    ).json()
    assert running["attempts"] == 2
    # Success clears the error (error written as given -> null).
    done = client.post(
        "/tasks", json={"sha256": SHA_A, "type": "index", "status": "done"}
    ).json()
    assert done["status"] == "done"
    assert done["error"] is None


def test_filter_by_status_and_type(client):
    client.post("/tasks", json={"sha256": SHA_A, "type": "index", "status": "dlq"})
    client.post("/tasks", json={"sha256": SHA_B, "type": "index", "status": "done"})
    client.post("/tasks", json={"sha256": SHA_B, "type": "label", "status": "dlq"})

    dlq = client.get("/tasks", params={"status": "dlq"}).json()
    assert {t["sha256"] for t in dlq} == {SHA_A, SHA_B}
    assert all(t["status"] == "dlq" for t in dlq)

    labels = client.get("/tasks", params={"type": "label"}).json()
    assert all(t["type"] == "label" for t in labels)


def test_get_unknown_or_malformed_task_is_404(client):
    assert client.get("/tasks/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/tasks/not-a-uuid").status_code == 404


def test_invalid_type_or_status_rejected(client):
    assert client.post(
        "/tasks", json={"sha256": SHA_A, "type": "bogus", "status": "queued"}
    ).status_code == 422
    assert client.post(
        "/tasks", json={"sha256": SHA_A, "type": "index", "status": "bogus"}
    ).status_code == 422
    assert client.post(
        "/tasks", json={"sha256": "nothex", "type": "index", "status": "queued"}
    ).status_code == 422
