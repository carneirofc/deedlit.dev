"""Tests for the deedlit.ingest reconcile sweep job (issue #21).

The reconcile job compares catalog coverage against the search and graph
projections and repairs drift via the rebuild-from-catalog paths, supporting the
eventual-consistency guarantees of the fan-out write model.

It reuses the #9/#10 in-memory Job model + async worker loop, so it gets
progress + cooperative cancel for free.

ALL outbound HTTP (catalog list, search/graph coverage probes, search/graph
rebuild, per-image reindex pipeline) is monkeypatched so the suite is
deterministic and offline.

Covered:
  (1) reconcile detects images missing from search AND from graph
  (2) it triggers the rebuild/repair path for drift
  (3) it reports per-image projection status
  (4) on-demand trigger works via the POST /reconcile endpoint
  (5) the periodic scheduler enqueues a reconcile job when enabled
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import app as app_module
import broker as broker_module
import jobs as jobs_module
import pipeline


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


@pytest.fixture
def fresh_store(monkeypatch):
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    return store


def _wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/jobs/{job_id}").json()
        if last["status"] in statuses:
            return last
        time.sleep(0.02)
    return last


@pytest.fixture
def mock_projections(monkeypatch):
    """Mock catalog list + search/graph coverage probes + the index publisher.

    Catalog has A, B, C. Search has A, B (C missing). Graph has A (B, C missing).
    So search-drift = {C}, graph-drift = {B, C}; the drift UNION is {B, C}.
    """
    state: dict = {
        "search_ids": {SHA_A, SHA_B},
        "graph_ids": {SHA_A},
        "published": [],
    }

    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: [SHA_A, SHA_B, SHA_C])
    monkeypatch.setattr(pipeline, "search_has", lambda sha: sha in state["search_ids"])
    monkeypatch.setattr(pipeline, "graph_has", lambda sha: sha in state["graph_ids"])

    async def fake_publish_index(sha256, parent_op_id=None):
        state["published"].append(sha256)

    monkeypatch.setattr(broker_module, "publish_index_task", fake_publish_index)
    return state


# ---------------------------------------------------------------------------
# (1) detects drift + (2) re-enqueues an index task per drifter + (3) report
# ---------------------------------------------------------------------------
def test_reconcile_detects_drift_and_reenqueues_index(fresh_store, mock_projections):
    with TestClient(app_module.app) as client:
        r = client.post("/reconcile", json={})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == "reconcile"
        job_id = body["id"]

        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        # 3 catalog images probed.
        assert final["progress"]["total"] == 3

        job = fresh_store.get(job_id)
        report = job.report

    # Per-image projection status report.
    images = report["images"]
    assert images[SHA_A]["in_search"] is True
    assert images[SHA_A]["in_graph"] is True
    assert images[SHA_A]["enqueued"] is False

    # C was missing from both -> re-enqueued.
    assert images[SHA_C]["in_search"] is False
    assert images[SHA_C]["in_graph"] is False
    assert images[SHA_C]["enqueued"] is True

    # B was missing from graph only -> re-enqueued.
    assert images[SHA_B]["in_search"] is True
    assert images[SHA_B]["in_graph"] is False
    assert images[SHA_B]["enqueued"] is True

    # Summary drift sets + the repair strategy.
    assert set(report["search_drift"]) == {SHA_C}
    assert set(report["graph_drift"]) == {SHA_B, SHA_C}
    assert set(report["enqueued"]) == {SHA_B, SHA_C}
    assert report["repair_strategy"] == "enqueue-index"

    # Exactly one index task per drifted image (the union), not per drift entry.
    assert sorted(mock_projections["published"]) == sorted([SHA_B, SHA_C])


def test_reconcile_no_drift_enqueues_nothing(fresh_store, monkeypatch):
    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: [SHA_A])
    monkeypatch.setattr(pipeline, "search_has", lambda sha: True)
    monkeypatch.setattr(pipeline, "graph_has", lambda sha: True)
    published: list[str] = []

    async def fake_publish_index(sha256, parent_op_id=None):
        published.append(sha256)

    monkeypatch.setattr(broker_module, "publish_index_task", fake_publish_index)

    with TestClient(app_module.app) as client:
        job_id = client.post("/reconcile", json={}).json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        report = fresh_store.get(job_id).report

    assert published == []
    assert report["search_drift"] == []
    assert report["graph_drift"] == []
    assert report["enqueued"] == []
    assert report["images"][SHA_A]["enqueued"] is False


# ---------------------------------------------------------------------------
# One index task per drifted image (an index task re-projects BOTH stores)
# ---------------------------------------------------------------------------
def test_reconcile_enqueues_index_per_drifted_image(fresh_store, monkeypatch):
    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: [SHA_A, SHA_B])
    monkeypatch.setattr(pipeline, "search_has", lambda sha: sha == SHA_A)  # B missing
    monkeypatch.setattr(pipeline, "graph_has", lambda sha: True)
    published: list[str] = []

    async def fake_publish_index(sha256, parent_op_id=None):
        published.append(sha256)

    monkeypatch.setattr(broker_module, "publish_index_task", fake_publish_index)

    with TestClient(app_module.app) as client:
        job_id = client.post("/reconcile", json={}).json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        report = fresh_store.get(job_id).report

    assert published == [SHA_B]
    assert report["images"][SHA_B]["enqueued"] is True
    assert report["repair_strategy"] == "enqueue-index"


# ---------------------------------------------------------------------------
# (4) on-demand trigger via the endpoint
# ---------------------------------------------------------------------------
def test_reconcile_endpoint_creates_job(fresh_store, mock_projections):
    with TestClient(app_module.app) as client:
        r = client.post("/reconcile", json={})
        assert r.status_code == 202
        body = r.json()
        assert body["type"] == "reconcile"
        assert body["status"] in ("queued", "running")


def test_reconcile_via_jobs_endpoint(fresh_store, mock_projections):
    """type=reconcile is also accepted on the generic POST /jobs endpoint."""
    with TestClient(app_module.app) as client:
        r = client.post("/jobs", json={"type": "reconcile"})
        assert r.status_code == 202
        assert r.json()["type"] == "reconcile"


# ---------------------------------------------------------------------------
# (5) periodic scheduler enqueues a reconcile job when enabled
# ---------------------------------------------------------------------------
def test_scheduler_tick_enqueues_reconcile_job(fresh_store):
    # Directly invoke one scheduler tick rather than waiting on real time.
    before = len(fresh_store._jobs)
    job = jobs_module.run_reconcile_tick(fresh_store)
    assert job is not None
    assert job.type == "reconcile"
    assert len(fresh_store._jobs) == before + 1


def test_scheduler_disabled_by_default(monkeypatch):
    # With no RECONCILE_INTERVAL_SECONDS, the scheduler must not start.
    monkeypatch.delenv("RECONCILE_INTERVAL_SECONDS", raising=False)
    assert jobs_module.reconcile_interval_seconds() == 0
