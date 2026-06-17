"""Tests for the per-stage ingest DAG queue topology (ADR 0002, slice 1).

Covers only the broker seam added by slice 1: the per-stage queue constants, the
expanded topology declaration, and the per-stage publish helpers. The broker is
never connected — ``declare_topology`` runs against a fake channel and the publish
helpers run against a monkeypatched ``publish_task`` — so the suite stays offline.
"""
from __future__ import annotations

import asyncio

import broker as broker_module

SHA = "a" * 64


# ---------------------------------------------------------------------------
# (1) queue set
# ---------------------------------------------------------------------------
def test_task_queues_cover_every_stage():
    assert set(broker_module.TASK_QUEUES) == {
        "ingest",
        "embed.dense",
        "embed.sparse",
        "index.search",
        "index.graph",
        "label",
    }


# ---------------------------------------------------------------------------
# (2) topology: main + retry + dlq declared for each queue
# ---------------------------------------------------------------------------
class _FakeChannel:
    def __init__(self) -> None:
        self.declared: list[tuple[str, dict]] = []

    async def declare_queue(self, name, *, durable=False, arguments=None):
        self.declared.append((name, arguments or {}))


def test_declare_topology_declares_main_retry_dlq_for_each():
    ch = _FakeChannel()
    asyncio.run(broker_module.declare_topology(ch, ("embed.dense",)))
    names = [n for n, _ in ch.declared]
    assert names == ["embed.dense.dlq", "embed.dense.retry", "embed.dense"]
    # The retry queue dead-letters BACK to the main queue when its TTL expires.
    retry_args = dict(ch.declared)["embed.dense.retry"]
    assert retry_args["x-dead-letter-routing-key"] == "embed.dense"


def test_label_queue_is_single_serial_consumer():
    # LLM queue: prefetch 1 + exclusive consumer (broker-enforced single consumer
    # so the single-threaded model server is never hit concurrently).
    assert broker_module.prefetch_for("label") == 1
    assert broker_module.exclusive_for("label") is True


def test_fast_queues_use_high_prefetch_and_share():
    for q in ["ingest", "embed.dense", "embed.sparse", "index.search", "index.graph", "index"]:
        assert broker_module.prefetch_for(q) == broker_module.PREFETCH
        assert broker_module.exclusive_for(q) is False


def test_declare_topology_covers_all_task_queues():
    ch = _FakeChannel()
    asyncio.run(broker_module.declare_topology(ch, broker_module.TASK_QUEUES))
    declared = {n for n, _ in ch.declared}
    for q in broker_module.TASK_QUEUES:
        assert {q, f"{q}.retry", f"{q}.dlq"} <= declared


# ---------------------------------------------------------------------------
# (3) publish helpers route to the right queue with the right payload
# ---------------------------------------------------------------------------
def _capture(monkeypatch) -> list[tuple]:
    sent: list[tuple] = []

    async def fake_publish_task(queue, payload, *, headers=None, expiration_ms=None):
        sent.append((queue, payload))

    monkeypatch.setattr(broker_module, "publish_task", fake_publish_task)
    return sent


def test_publish_ingest_task_carries_path_and_folder(monkeypatch):
    sent = _capture(monkeypatch)
    asyncio.run(
        broker_module.publish_ingest_task(
            "/lib/x.png", source_folder_id="f1", parent_op_id="op1"
        )
    )
    queue, payload = sent[0]
    assert queue == "ingest"
    assert payload == {
        "path": "/lib/x.png",
        "type": "ingest",
        "source_folder_id": "f1",
        "parent_op_id": "op1",
    }


def test_per_stage_publish_helpers_route_by_sha(monkeypatch):
    sent = _capture(monkeypatch)
    cases = [
        (broker_module.publish_embed_dense_task, "embed.dense"),
        (broker_module.publish_embed_sparse_task, "embed.sparse"),
        (broker_module.publish_index_search_task, "index.search"),
        (broker_module.publish_index_graph_task, "index.graph"),
        (broker_module.publish_label_task, "label"),
    ]
    for fn, _q in cases:
        asyncio.run(fn(SHA, parent_op_id="op2"))
    for (queue, payload), (_fn, expected) in zip(sent, cases):
        assert queue == expected
        assert payload == {"sha256": SHA, "type": expected, "parent_op_id": "op2"}
