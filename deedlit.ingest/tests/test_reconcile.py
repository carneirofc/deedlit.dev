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
    """Mock catalog list + the four per-stage coverage probes + per-stage pubs.

    Catalog has A, B, C.
      A: dense+sparse blobs, search point, graph node — fully projected.
      B: dense+sparse blobs + graph node, but NO search point -> index.search.
      C: nothing — no dense, no sparse, no search, no graph.
    So per-stage drift is: embed.dense={C}, embed.sparse={C},
    index.search={B} (B has both vectors but no point; C's vectors are missing so
    its embed stages fan in instead), index.graph={C}.
    """
    state: dict = {
        "dense_ids": {SHA_A, SHA_B},
        "sparse_ids": {SHA_A, SHA_B},
        "search_ids": {SHA_A},
        "graph_ids": {SHA_A, SHA_B},
        "pub": {"embed.dense": [], "embed.sparse": [], "index.search": [], "index.graph": []},
    }

    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: [SHA_A, SHA_B, SHA_C])
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: [0.1] if sha in state["dense_ids"] else None)
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: {"indices": []} if sha in state["sparse_ids"] else None)
    monkeypatch.setattr(pipeline, "search_has", lambda sha: sha in state["search_ids"])
    monkeypatch.setattr(pipeline, "graph_has", lambda sha: sha in state["graph_ids"])

    def _record(key):
        async def pub(sha256, parent_op_id=None):
            state["pub"][key].append(sha256)
        return pub

    monkeypatch.setattr(broker_module, "publish_embed_dense_task", _record("embed.dense"))
    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", _record("embed.sparse"))
    monkeypatch.setattr(broker_module, "publish_index_search_task", _record("index.search"))
    monkeypatch.setattr(broker_module, "publish_index_graph_task", _record("index.graph"))
    return state


# ---------------------------------------------------------------------------
# (1) detects per-stage drift + (2) re-enqueues the right stage + (3) report
# ---------------------------------------------------------------------------
def test_reconcile_detects_drift_and_reenqueues_per_stage(fresh_store, mock_projections):
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

    # Per-image stage status report.
    images = report["images"]
    assert images[SHA_A]["enqueued"] == []  # fully projected

    # B: both vectors present but no search point -> only index.search.
    assert images[SHA_B]["dense"] is True and images[SHA_B]["sparse"] is True
    assert images[SHA_B]["in_search"] is False
    assert images[SHA_B]["enqueued"] == ["index.search"]

    # C: nothing present -> embed.dense + embed.sparse + index.graph (NOT
    # index.search: its vectors are missing, so the embed stages fan it in).
    assert images[SHA_C]["enqueued"] == ["embed.dense", "embed.sparse", "index.graph"]

    # Per-stage drift + repair strategy.
    assert report["drift"]["embed.dense"] == [SHA_C]
    assert report["drift"]["embed.sparse"] == [SHA_C]
    assert report["drift"]["index.search"] == [SHA_B]
    assert report["drift"]["index.graph"] == [SHA_C]
    assert report["repair_strategy"] == "enqueue-per-stage"

    # Exactly the right stage task published per drifted image.
    assert mock_projections["pub"]["embed.dense"] == [SHA_C]
    assert mock_projections["pub"]["embed.sparse"] == [SHA_C]
    assert mock_projections["pub"]["index.search"] == [SHA_B]
    assert mock_projections["pub"]["index.graph"] == [SHA_C]


def test_reconcile_no_drift_enqueues_nothing(fresh_store, monkeypatch):
    monkeypatch.setattr(pipeline, "list_catalog_sha256", lambda: [SHA_A])
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: [0.1])
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: {"indices": []})
    monkeypatch.setattr(pipeline, "search_has", lambda sha: True)
    monkeypatch.setattr(pipeline, "graph_has", lambda sha: True)
    published: list[str] = []

    def _record(_key):
        async def pub(sha256, parent_op_id=None):
            published.append(sha256)
        return pub

    for name in (
        "publish_embed_dense_task", "publish_embed_sparse_task",
        "publish_index_search_task", "publish_index_graph_task",
    ):
        monkeypatch.setattr(broker_module, name, _record(name))

    with TestClient(app_module.app) as client:
        job_id = client.post("/reconcile", json={}).json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})
        assert final["status"] == "completed"
        report = fresh_store.get(job_id).report

    assert published == []
    assert all(report["drift"][s] == [] for s in report["drift"])
    assert report["images"][SHA_A]["enqueued"] == []


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
