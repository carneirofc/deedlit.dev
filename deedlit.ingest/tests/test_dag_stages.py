"""Tests for the per-stage DAG functions + worker handlers (ADR 0002).

Covers slices 4-7: embed.dense / embed.sparse persist their vector to catalog and
the workers fan in to index.search; index.search upserts only when BOTH vectors
are present (the catalog-rendezvous fan-in) and no-ops otherwise; index.graph
projects edges from catalog truth. Every catalog/vision/broker boundary is
monkeypatched, so the suite stays offline.
"""
from __future__ import annotations

import asyncio

import pytest

import broker as broker_module
import pipeline
import worker as worker_module

SHA = "a" * 64


# ---------------------------------------------------------------------------
# ingest stage (opt-in cross-process producer)
# ---------------------------------------------------------------------------
def test_ingest_path_reads_file_and_fast_paths(tmp_path, monkeypatch):
    seen: list[tuple] = []
    p = tmp_path / "x.png"
    p.write_bytes(b"rawbytes")
    monkeypatch.setattr(
        pipeline, "ingest_fast",
        lambda data, name, src, *a, **k: seen.append((data, name, src)) or "deadbeef",
    )
    sha = asyncio.run(pipeline.ingest_path(str(p)))
    assert sha == "deadbeef"
    assert seen == [(b"rawbytes", "x.png", str(p))]


def test_ingest_handler_fast_paths_then_publishes_post_ingest(monkeypatch):
    monkeypatch.setattr(pipeline, "ingest_path", lambda path: SHA)
    published: list[tuple] = []

    async def fake_post(sha256, parent_op_id=None):
        published.append((sha256, parent_op_id))

    monkeypatch.setattr(broker_module, "publish_post_ingest", fake_post)
    asyncio.run(worker_module.ingest_handler({"path": "/lib/x.png", "parent_op_id": "op9"}))
    assert published == [(SHA, "op9")]


def test_ingest_handler_requires_path():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.ingest_handler({"type": "ingest"}))


# ---------------------------------------------------------------------------
# Slice 4: embed.dense
# ---------------------------------------------------------------------------
def test_embed_dense_persists_vector_to_catalog(monkeypatch):
    stored: list[tuple] = []
    monkeypatch.setattr(pipeline, "fetch_image_bytes", lambda sha: (b"bytes", "image/png"))
    monkeypatch.setattr(pipeline, "embed_image", lambda d, f, m: [0.1, 0.2, 0.3])
    monkeypatch.setattr(pipeline, "store_dense_blob", lambda sha, v: stored.append((sha, v)))

    asyncio.run(pipeline.embed_dense(SHA))
    assert stored == [(SHA, [0.1, 0.2, 0.3])]


def test_store_dense_blob_writes_embedding_kind_json(monkeypatch):
    puts: list[tuple] = []
    monkeypatch.setattr(
        pipeline, "_put_blob_with_retry",
        lambda url, data, content_type=None, *a, **k: puts.append((url, data, content_type)),
    )
    asyncio.run(pipeline.store_dense_blob(SHA, [1.0, 2.0]))
    url, data, ctype = puts[0]
    assert url == f"{pipeline.CATALOG_URL}/blobs/{SHA}/embedding"
    assert data == b"[1.0, 2.0]"


def test_embed_dense_handler_publishes_index_search(monkeypatch):
    published: list[tuple] = []
    monkeypatch.setattr(pipeline, "embed_dense", lambda sha: None)

    async def fake(sha, parent_op_id=None):
        published.append((sha, parent_op_id))

    monkeypatch.setattr(broker_module, "publish_index_search_task", fake)
    asyncio.run(worker_module.embed_dense_handler({"sha256": SHA, "parent_op_id": "op1"}))
    assert published == [(SHA, "op1")]


def test_embed_dense_handler_requires_sha():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.embed_dense_handler({"type": "embed.dense"}))


# ---------------------------------------------------------------------------
# Slice 5: embed.sparse
# ---------------------------------------------------------------------------
def test_embed_sparse_builds_text_from_catalog_truth(monkeypatch):
    seen_text: list[str] = []
    stored: list[tuple] = []
    desc_text: list[str] = []
    desc_stored: list[tuple] = []
    monkeypatch.setattr(
        pipeline, "fetch_image_record",
        lambda sha: {"prompt": "a cat", "description": "fluffy", "tags": ["cute", "pet"]},
    )
    monkeypatch.setattr(
        pipeline, "embed_sparse_text",
        lambda t: seen_text.append(t) or {"indices": [1], "values": [0.5]},
    )
    monkeypatch.setattr(pipeline, "store_sparse_blob", lambda sha, v: stored.append((sha, v)))
    monkeypatch.setattr(pipeline, "embed_text", lambda t: desc_text.append(t) or [0.1, 0.2])
    monkeypatch.setattr(
        pipeline, "store_description_blob", lambda sha, v: desc_stored.append((sha, v))
    )

    asyncio.run(pipeline.embed_sparse(SHA))
    assert seen_text == ["a cat fluffy cute pet"]
    assert stored == [(SHA, {"indices": [1], "values": [0.5]})]
    # The description ALSO gets its own CLIP-text dense vector — over the
    # description text alone (not the combined sparse text).
    assert desc_text == ["fluffy"]
    assert desc_stored == [(SHA, [0.1, 0.2])]


def test_embed_sparse_empty_text_stores_empty_without_calling_vision(monkeypatch):
    stored: list[tuple] = []
    monkeypatch.setattr(pipeline, "fetch_image_record", lambda sha: {"tags": []})

    def boom(_t):  # pragma: no cover - must not be called for empty text
        raise AssertionError("vision should not be called for empty sparse text")

    monkeypatch.setattr(pipeline, "embed_sparse_text", boom)
    monkeypatch.setattr(pipeline, "store_sparse_blob", lambda sha, v: stored.append((sha, v)))
    # No description in the record -> no description vector, no /embed/text call.
    monkeypatch.setattr(pipeline, "embed_text", boom)
    monkeypatch.setattr(
        pipeline, "store_description_blob",
        lambda sha, v: (_ for _ in ()).throw(AssertionError("no description to store")),
    )

    asyncio.run(pipeline.embed_sparse(SHA))
    assert stored == [(SHA, {"indices": [], "values": []})]


def test_embed_sparse_embeds_description_even_when_no_prompt_tags(monkeypatch):
    """A description with no prompt/tags still yields BOTH the sparse vector (over
    the description) and its own description dense vector."""
    sparse_stored: list[tuple] = []
    desc_text: list[str] = []
    desc_stored: list[tuple] = []
    monkeypatch.setattr(pipeline, "fetch_image_record", lambda sha: {"description": "a lone wolf"})
    monkeypatch.setattr(pipeline, "embed_sparse_text", lambda t: {"indices": [7], "values": [1.0]})
    monkeypatch.setattr(pipeline, "store_sparse_blob", lambda sha, v: sparse_stored.append((sha, v)))
    monkeypatch.setattr(pipeline, "embed_text", lambda t: desc_text.append(t) or [0.9])
    monkeypatch.setattr(
        pipeline, "store_description_blob", lambda sha, v: desc_stored.append((sha, v))
    )

    asyncio.run(pipeline.embed_sparse(SHA))
    assert desc_text == ["a lone wolf"]
    assert desc_stored == [(SHA, [0.9])]


def test_embed_sparse_handler_publishes_index_search(monkeypatch):
    published: list[str] = []
    monkeypatch.setattr(pipeline, "embed_sparse", lambda sha: None)

    async def fake(sha, parent_op_id=None):
        published.append(sha)

    monkeypatch.setattr(broker_module, "publish_index_search_task", fake)
    asyncio.run(worker_module.embed_sparse_handler({"sha256": SHA}))
    assert published == [SHA]


# ---------------------------------------------------------------------------
# Slice 6: index.search fan-in
# ---------------------------------------------------------------------------
def test_index_search_upserts_when_both_vectors_present(monkeypatch):
    posts: list[tuple] = []
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: [0.1, 0.2])
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: {"indices": [3], "values": [0.9]})
    monkeypatch.setattr(pipeline, "load_description_blob", lambda sha: [0.3, 0.4])
    monkeypatch.setattr(
        pipeline, "fetch_image_record",
        lambda sha: {
            "filepath": "/lib/x.png", "tags": ["t"],
            "description": "d", "safety": "sfw",
        },
    )
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda url, body, *a, **k: posts.append((url, body)))

    assert asyncio.run(pipeline.index_search(SHA)) is True
    url, point = posts[0]
    assert url == f"{pipeline.SEARCH_URL}/points"
    assert point["sha256"] == SHA
    assert point["dense"] == [0.1, 0.2]
    assert point["sparse"] == {"indices": [3], "values": [0.9]}
    # The description dense vector rides along as its own named vector.
    assert point["description"] == [0.3, 0.4]
    assert point["payload"]["filepath"] == "/lib/x.png"
    assert point["payload"]["description"] == "d"
    assert point["payload"]["safety"] == "sfw"


def test_index_search_omits_description_vector_when_absent(monkeypatch):
    """No persisted description vector -> the point indexes on dense+sparse only
    (the missing description vector never blocks the fan-in)."""
    posts: list[tuple] = []
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: [0.1, 0.2])
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: {"indices": [3], "values": [0.9]})
    monkeypatch.setattr(pipeline, "load_description_blob", lambda sha: None)
    monkeypatch.setattr(pipeline, "fetch_image_record", lambda sha: {"filepath": "/lib/x.png"})
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda url, body, *a, **k: posts.append((url, body)))

    assert asyncio.run(pipeline.index_search(SHA)) is True
    _, point = posts[0]
    assert "description" not in point


def test_index_search_noop_when_dense_missing(monkeypatch):
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: None)
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: {"indices": [], "values": []})
    monkeypatch.setattr(pipeline, "load_description_blob", lambda sha: None)

    def boom(*a, **k):  # pragma: no cover - must not upsert while waiting
        raise AssertionError("must not upsert until both vectors land")

    monkeypatch.setattr(pipeline, "_post_with_retry", boom)
    assert asyncio.run(pipeline.index_search(SHA)) is False


def test_index_search_noop_when_sparse_missing(monkeypatch):
    monkeypatch.setattr(pipeline, "load_dense_blob", lambda sha: [0.1])
    monkeypatch.setattr(pipeline, "load_sparse_blob", lambda sha: None)
    monkeypatch.setattr(pipeline, "load_description_blob", lambda sha: None)
    monkeypatch.setattr(
        pipeline, "_post_with_retry",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not upsert")),
    )
    assert asyncio.run(pipeline.index_search(SHA)) is False


def test_index_search_handler_requires_sha():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.index_search_handler({"type": "index.search"}))


# ---------------------------------------------------------------------------
# Slice 7: index.graph
# ---------------------------------------------------------------------------
def test_index_graph_posts_edges_from_catalog(monkeypatch):
    posts: list[tuple] = []
    monkeypatch.setattr(
        pipeline, "fetch_image_record",
        lambda sha: {
            "references": [{"kind": "lora", "name": "x", "hash": None}],
            "tags": ["a", "b"],
        },
    )
    monkeypatch.setattr(pipeline, "_post_with_retry", lambda url, body, *a, **k: posts.append((url, body)))

    asyncio.run(pipeline.index_graph(SHA))
    url, edges = posts[0]
    assert url == f"{pipeline.GRAPH_URL}/edges"
    assert edges["sha256"] == SHA
    assert edges["references"] == [{"kind": "lora", "name": "x", "hash": None}]
    assert edges["tags"] == ["a", "b"]
    assert edges["lineage"] == []


def test_index_graph_handler_requires_sha():
    with pytest.raises(ValueError):
        asyncio.run(worker_module.index_graph_handler({"type": "index.graph"}))
