"""Tests for the async index queue + fast-path split (issue #25, ADR 0001).

Covers the broker seam (retry/backoff/DLQ decision + one delivery), the
synchronous fast path (catalog-only write + index-task publish), the repaired
byte-fetch (catalog filepath -> shared disk), the index worker handler, and the
broker-outage safety net (a publish failure never fails the catalog write).

The broker is never actually connected: the async functions are driven with
``asyncio.run`` and a fake ``publish`` callback, so the suite stays offline and
needs no live RabbitMQ.
"""
from __future__ import annotations

import asyncio
import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app as app_module
import broker as broker_module
import jobs as jobs_module
import pipeline
import worker as worker_module


def _png_bytes(color: tuple[int, int, int] = (255, 0, 0), size: int = 16) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (size, size), color).save(out, format="PNG")
    return out.getvalue()


def _wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/jobs/{job_id}").json()
        if last["status"] in statuses:
            return last
        time.sleep(0.02)
    return last


# ---------------------------------------------------------------------------
# (1) retry/backoff/DLQ decision logic (pure)
# ---------------------------------------------------------------------------
def test_next_action_retries_then_dlq():
    assert broker_module.next_action(1, max_retries=3) == "retry"
    assert broker_module.next_action(2, max_retries=3) == "retry"
    assert broker_module.next_action(3, max_retries=3) == "dlq"
    assert broker_module.next_action(4, max_retries=3) == "dlq"


def test_backoff_is_exponential_and_capped():
    base = broker_module.BACKOFF_BASE_MS
    assert broker_module.backoff_ms(1) == base
    assert broker_module.backoff_ms(2) == base * 2
    assert broker_module.backoff_ms(3) == base * 4
    assert broker_module.backoff_ms(1000) == broker_module.BACKOFF_CAP_MS


# ---------------------------------------------------------------------------
# (2) one delivery: ok / retry / dlq
# ---------------------------------------------------------------------------
def test_process_delivery_ok_runs_handler_and_does_not_publish():
    seen: list[str] = []

    async def fake_publish(*a, **k):  # pragma: no cover - must not be called
        raise AssertionError("should not publish on success")

    def handler(payload):
        seen.append(payload["sha256"])

    action = asyncio.run(
        broker_module.process_delivery(
            "index", b'{"sha256":"abc"}', None, handler, publish=fake_publish
        )
    )
    assert action == "ok"
    assert seen == ["abc"]


def test_process_delivery_awaits_async_handler():
    seen: list[str] = []

    async def fake_publish(*a, **k):
        return None

    async def handler(payload):
        seen.append(payload["sha256"])

    action = asyncio.run(
        broker_module.process_delivery(
            "index", b'{"sha256":"z"}', None, handler, publish=fake_publish
        )
    )
    assert action == "ok" and seen == ["z"]


def test_process_delivery_failure_retries_with_backoff():
    published: list[tuple] = []

    async def fake_publish(queue, payload, *, headers=None, expiration_ms=None):
        published.append((queue, payload, headers, expiration_ms))

    def boom(payload):
        raise RuntimeError("handler failed")

    action = asyncio.run(
        broker_module.process_delivery(
            "index", b'{"sha256":"x"}', {}, boom, publish=fake_publish, max_retries=3
        )
    )
    assert action == "retry"
    queue, payload, headers, expiration = published[0]
    assert queue == "index.retry"
    assert payload == {"sha256": "x"}
    assert headers[broker_module.ATTEMPT_HEADER] == 1
    assert expiration == broker_module.backoff_ms(1)


def test_process_delivery_dead_letters_after_max_retries():
    published: list[tuple] = []

    async def fake_publish(queue, payload, *, headers=None, expiration_ms=None):
        published.append((queue, payload, headers, expiration_ms))

    def boom(payload):
        raise RuntimeError("still failing")

    # Header says 2 prior failures; this is the 3rd == max_retries -> DLQ.
    action = asyncio.run(
        broker_module.process_delivery(
            "index", b'{"sha256":"x"}',
            {broker_module.ATTEMPT_HEADER: 2}, boom,
            publish=fake_publish, max_retries=3,
        )
    )
    assert action == "dlq"
    queue, _payload, headers, expiration = published[0]
    assert queue == "index.dlq"
    assert headers[broker_module.ATTEMPT_HEADER] == 3
    assert expiration is None  # dead-letter is terminal, no TTL


# ---------------------------------------------------------------------------
# (3) fast path: catalog-only write + record shape
# ---------------------------------------------------------------------------
def test_ingest_fast_writes_catalog_record_and_thumbnail(monkeypatch):
    posts: list[tuple] = []
    puts: list[tuple] = []

    monkeypatch.setattr(
        pipeline, "extract_metadata",
        lambda d, f, m: {"prompt": "p", "tags": ["t"], "params": {}, "references": {}},
    )
    monkeypatch.setattr(
        pipeline, "_post_with_retry",
        lambda url, body, *a, **k: posts.append((url, body)),
    )
    monkeypatch.setattr(
        pipeline, "_put_blob_with_retry",
        lambda url, data, content_type=None, *a, **k: puts.append((url, content_type)),
    )

    data = _png_bytes((10, 20, 30))
    sha = asyncio.run(pipeline.ingest_fast(data, "x.png", "/lib/x.png"))
    assert sha == pipeline.compute_sha256(data)

    # catalog record POST first, carrying the source filepath; AI fields are None
    # (the label task fills them later — catalog COALESCEs).
    assert posts[0][0] == f"{pipeline.CATALOG_URL}/images"
    rec = posts[0][1]
    assert rec["sha256"] == sha
    assert rec["filepath"] == "/lib/x.png"
    assert rec["tags"] == ["t"]
    assert rec["description"] is None
    assert rec["safety"] is None
    # thumbnail blob PUT as WebP.
    assert puts[0][0] == f"{pipeline.CATALOG_URL}/blobs/{sha}/thumbnail"
    assert puts[0][1] == "image/webp"


# ---------------------------------------------------------------------------
# (4) repaired byte-fetch: catalog filepath -> shared disk
# ---------------------------------------------------------------------------
def test_fetch_image_bytes_reads_from_disk_via_filepath(tmp_path, monkeypatch):
    data = _png_bytes((1, 2, 3))
    p = tmp_path / "z.png"
    p.write_bytes(data)
    monkeypatch.setattr(pipeline, "fetch_image_filepath", lambda sha256: str(p))

    out, mime = asyncio.run(pipeline.fetch_image_bytes("a" * 64))
    assert out == data
    assert mime == "image/png"


def test_fetch_image_bytes_raises_without_filepath(monkeypatch):
    monkeypatch.setattr(pipeline, "fetch_image_filepath", lambda sha256: None)
    with pytest.raises(FileNotFoundError):
        asyncio.run(pipeline.fetch_image_bytes("a" * 64))


# ---------------------------------------------------------------------------
# (5) index worker handler = rebuild projection from catalog truth
# ---------------------------------------------------------------------------
def test_index_handler_reindexes_sha(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(pipeline, "reindex_image", lambda sha256: seen.append(sha256))
    asyncio.run(worker_module.index_handler({"sha256": "a" * 64, "type": "index"}))
    assert seen == ["a" * 64]


def test_index_handler_requires_sha():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.index_handler({"type": "index"}))


# ---------------------------------------------------------------------------
# (6) best-effort publish: a broker outage never fails the fast path
# ---------------------------------------------------------------------------
def test_publish_index_best_effort_swallows_broker_errors(monkeypatch):
    async def boom(sha256, parent_op_id=None):
        raise RuntimeError("broker down")

    monkeypatch.setattr(broker_module, "publish_index_task", boom)
    ok = asyncio.run(jobs_module._publish_index_best_effort("a" * 64))
    assert ok is False


def test_publish_index_best_effort_happy_path(monkeypatch):
    seen: list[tuple] = []

    async def fake(sha256, parent_op_id=None):
        seen.append((sha256, parent_op_id))

    monkeypatch.setattr(broker_module, "publish_index_task", fake)
    ok = asyncio.run(jobs_module._publish_index_best_effort("a" * 64, parent_op_id="job1"))
    assert ok is True
    assert seen == [("a" * 64, "job1")]


def test_folder_ingest_completes_when_broker_is_down(tmp_path, monkeypatch):
    """Broker-outage safety net: the catalog write lands and the job completes
    even when publishing the index task fails (reconcile re-enqueues later)."""
    store = jobs_module.JobStore()
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.setattr(pipeline, "extract_metadata", lambda d, f, m: {"prompt": "p", "tags": []})
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_put_blob_with_retry", lambda *a, **k: None)

    async def boom(sha256, parent_op_id=None):
        raise RuntimeError("broker down")

    # Every per-stage publish fails (broker down). The inline fast-path catalog
    # write still lands, so the image is cataloged-but-unprojected and the job
    # completes; reconcile / backfill re-enqueue the stages later (ADR 0002).
    for name in (
        "publish_embed_dense_task", "publish_embed_sparse_task",
        "publish_index_graph_task", "publish_label_task",
    ):
        monkeypatch.setattr(broker_module, name, boom)

    (tmp_path / "a.png").write_bytes(_png_bytes((7, 8, 9)))
    with TestClient(app_module.app) as client:
        job_id = client.post("/ingest", json={"folderPath": str(tmp_path)}).json()["id"]
        final = _wait_for(client, job_id, {"completed", "failed"})

    assert final["status"] == "completed"
    assert final["progress"]["done"] == 1
    assert final["progress"]["failed"] == 0


# ---------------------------------------------------------------------------
# (7) label queue (#26): describe -> patch catalog -> re-enqueue index
# ---------------------------------------------------------------------------
class _Err:
    status_code = 500
    request = None

    def raise_for_status(self):
        raise pipeline.httpx.HTTPStatusError("boom", request=None, response=None)

    def json(self):  # pragma: no cover
        return {}


class _FakeClient:
    """Minimal stand-in for the pooled httpx.AsyncClient (async verbs)."""

    def __init__(self, *, post=None, put=None, get=None):
        self._post, self._put, self._get = post, put, get

    async def post(self, url, **kw):
        return self._post(url, **kw)

    async def put(self, url, **kw):
        return self._put(url, **kw)

    async def get(self, url, **kw):
        return self._get(url, **kw)


def test_describe_image_disabled_returns_empty(monkeypatch):
    monkeypatch.setattr(pipeline, "LABELAGENT_URL", "")
    assert asyncio.run(pipeline.describe_image(b"x", "x.png", "image/png")) == {}


def test_describe_image_raises_on_http_error(monkeypatch):
    # Strict failure mode: a labelagent error PROPAGATES so the broker can
    # retry / dead-letter (no silent degrade now that only the label task calls it).
    monkeypatch.setattr(pipeline, "LABELAGENT_URL", "http://labelagent")
    monkeypatch.setattr(pipeline, "get_client", lambda: _FakeClient(post=lambda url, **k: _Err()))
    with pytest.raises(pipeline.httpx.HTTPStatusError):
        asyncio.run(pipeline.describe_image(b"x", "x.png", "image/png"))


def test_label_image_patches_catalog_and_merges_tags(monkeypatch):
    data = _png_bytes((5, 5, 5))
    posts: list[tuple] = []
    monkeypatch.setattr(pipeline, "fetch_image_bytes", lambda sha256: (data, "image/png"))
    monkeypatch.setattr(
        pipeline, "fetch_image_record",
        lambda sha256: {"filepath": "/lib/x.png", "tags": ["red"]},
    )
    monkeypatch.setattr(
        pipeline, "extract_metadata",
        lambda d, f, m: {"prompt": "p", "tags": ["red"], "params": {}, "references": {}},
    )
    monkeypatch.setattr(
        pipeline, "describe_image",
        lambda d, f, m, prompt_hint=None: {
            "description": "a red thing", "safety": "sfw", "tags": ["green"],
        },
    )
    monkeypatch.setattr(
        pipeline, "_post_with_retry", lambda url, body, *a, **k: posts.append((url, body))
    )

    changed = asyncio.run(pipeline.label_image("a" * 64))
    assert changed is True
    url, rec = posts[0]
    assert url == f"{pipeline.CATALOG_URL}/images"
    assert rec["description"] == "a red thing"
    assert rec["safety"] == "sfw"
    # AI tags merged into the existing catalog tags (de-duped, order-stable).
    assert rec["tags"] == ["red", "green"]
    assert rec["filepath"] == "/lib/x.png"


def test_label_image_is_noop_when_describe_empty(monkeypatch):
    data = _png_bytes()
    posts: list = []
    monkeypatch.setattr(pipeline, "fetch_image_bytes", lambda sha256: (data, "image/png"))
    monkeypatch.setattr(pipeline, "fetch_image_record", lambda sha256: {"tags": []})
    monkeypatch.setattr(pipeline, "extract_metadata", lambda d, f, m: {"prompt": "p", "tags": []})
    monkeypatch.setattr(pipeline, "describe_image", lambda d, f, m, prompt_hint=None: {})
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda *a, **k: posts.append(a))

    assert asyncio.run(pipeline.label_image("a" * 64)) is False
    assert posts == []  # nothing patched -> no catalog write


def test_label_handler_patches_then_reprojects_sparse_and_graph(monkeypatch):
    # ADR 0002: a label patch re-runs only the cheap stages — embed.sparse (which
    # fans into index.search) + index.graph — never embed.dense (bytes unchanged).
    published: list[tuple] = []

    monkeypatch.setattr(pipeline, "label_image", lambda sha256: True)

    async def fake_sparse(sha256, parent_op_id=None):
        published.append(("embed.sparse", sha256, parent_op_id))

    async def fake_graph(sha256, parent_op_id=None):
        published.append(("index.graph", sha256, parent_op_id))

    async def boom_dense(*a, **k):  # pragma: no cover - must not re-embed the GPU vector
        raise AssertionError("label must not re-publish embed.dense")

    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", fake_sparse)
    monkeypatch.setattr(broker_module, "publish_index_graph_task", fake_graph)
    monkeypatch.setattr(broker_module, "publish_embed_dense_task", boom_dense)
    asyncio.run(worker_module.label_handler({"sha256": "a" * 64, "parent_op_id": "op1"}))
    assert published == [
        ("embed.sparse", "a" * 64, "op1"),
        ("index.graph", "a" * 64, "op1"),
    ]


def test_label_handler_noop_does_not_reproject(monkeypatch):
    monkeypatch.setattr(pipeline, "label_image", lambda sha256: False)

    async def boom(*a, **k):  # pragma: no cover - must not run
        raise AssertionError("should not re-project on a no-op label")

    monkeypatch.setattr(broker_module, "publish_embed_sparse_task", boom)
    monkeypatch.setattr(broker_module, "publish_index_graph_task", boom)
    asyncio.run(worker_module.label_handler({"sha256": "a" * 64}))


def test_label_handler_requires_sha():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.label_handler({"type": "label"}))


def test_worker_registers_all_stage_handlers():
    # Per-stage DAG (ADR 0002) + the opt-in ingest queue + the retained legacy
    # `index` handler.
    assert set(worker_module.HANDLERS) == {
        broker_module.INGEST_QUEUE,
        broker_module.EMBED_DENSE_QUEUE,
        broker_module.EMBED_SPARSE_QUEUE,
        broker_module.INDEX_SEARCH_QUEUE,
        broker_module.INDEX_GRAPH_QUEUE,
        broker_module.LABEL_QUEUE,
        broker_module.INDEX_QUEUE,
    }


# ---------------------------------------------------------------------------
# (8) ledger lifecycle events (#27): running -> done / failed / dlq
# ---------------------------------------------------------------------------
async def _noop_publish(*a, **k):
    return None


def _run_delivery(headers, handler, **kw):
    events: list[tuple] = []

    def on_event(status, attempts, error):
        events.append((status, attempts, error))

    action = asyncio.run(
        broker_module.process_delivery(
            "index", b'{"sha256":"x","type":"index"}', headers, handler,
            publish=_noop_publish, on_event=on_event, **kw,
        )
    )
    return action, events


def test_process_delivery_emits_running_then_done():
    action, events = _run_delivery({}, lambda p: None)
    assert action == "ok"
    assert [e[0] for e in events] == ["running", "done"]


def test_process_delivery_emits_running_then_failed_on_retry():
    def boom(p):
        raise RuntimeError("nope")

    action, events = _run_delivery({}, boom, max_retries=3)
    assert action == "retry"
    assert [e[0] for e in events] == ["running", "failed"]
    assert events[1][1] == 1  # attempts
    assert events[1][2] == "nope"  # error


def test_process_delivery_emits_running_then_dlq_when_exhausted():
    def boom(p):
        raise RuntimeError("nope")

    action, events = _run_delivery({broker_module.ATTEMPT_HEADER: 2}, boom, max_retries=3)
    assert action == "dlq"
    assert [e[0] for e in events] == ["running", "dlq"]
    assert events[1][1] == 3  # attempts


def test_publish_index_records_queued_on_ledger(stub_ledger, monkeypatch):
    async def ok(sha256, parent_op_id=None):
        return None

    monkeypatch.setattr(broker_module, "publish_index_task", ok)
    assert asyncio.run(jobs_module._publish_index_best_effort("a" * 64, parent_op_id="op7")) is True
    assert any(
        c["type"] == "index" and c["status"] == "queued" and c["parent_op_id"] == "op7"
        for c in stub_ledger
    )


# ---------------------------------------------------------------------------
# (9) single-task endpoints (#30): POST /tasks/index, /tasks/label
# ---------------------------------------------------------------------------
def test_enqueue_index_endpoint_publishes(monkeypatch):
    published: list[str] = []

    async def fake(sha256, parent_op_id=None):
        published.append(sha256)

    monkeypatch.setattr(broker_module, "publish_index_task", fake)
    with TestClient(app_module.app) as client:
        r = client.post("/tasks/index", json={"sha256": "a" * 64})
        assert r.status_code == 202
        assert r.json()["type"] == "index"
    assert published == ["a" * 64]


def test_enqueue_label_endpoint_publishes(monkeypatch):
    published: list[str] = []

    async def fake(sha256, parent_op_id=None):
        published.append(sha256)

    monkeypatch.setattr(broker_module, "publish_label_task", fake)
    with TestClient(app_module.app) as client:
        r = client.post("/tasks/label", json={"sha256": "b" * 64})
        assert r.status_code == 202
        assert r.json()["type"] == "label"
    assert published == ["b" * 64]


def test_enqueue_task_rejects_bad_sha():
    with TestClient(app_module.app) as client:
        assert client.post("/tasks/index", json={"sha256": "nothex"}).status_code == 422
