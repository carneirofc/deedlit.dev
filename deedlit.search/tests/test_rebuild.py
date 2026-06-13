"""Rebuild test: the catalog HTTP call is mocked (no running catalog needed),
and we assert the returned items are upserted into the live Qdrant collection.
"""
from __future__ import annotations

import hashlib

import pytest
from fastapi.testclient import TestClient

import app as app_module
from conftest import TEST_COLLECTION
from id_scheme import point_id_for_sha256
from search import rebuild as rebuild_module
from search.config import DENSE_DIM

client = TestClient(app_module.app)
store = app_module.get_store()


def _sha(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def _dense(seed: int) -> list[float]:
    vec = [0.0] * DENSE_DIM
    vec[seed % DENSE_DIM] = 1.0
    return vec


CATALOG_ITEMS = [
    {
        "sha256": _sha("cat-1"),
        "dense": _dense(1),
        "sparse": {"indices": [1, 2], "values": [0.5, 0.5]},
        "payload": {"name": "cat-1"},
    },
    {
        "sha256": _sha("cat-2"),
        "dense": _dense(2),
        "payload": {"name": "cat-2"},
    },
    # No dense vector -> must be skipped (nothing to index on).
    {"sha256": _sha("cat-3"), "payload": {"name": "cat-3"}},
]


@pytest.fixture(autouse=True)
def _clean():
    store.drop_collection()
    store.ensure_collection()
    yield
    store.drop_collection()


def test_rebuild_upserts_catalog_items(monkeypatch):
    captured = {}

    def fake_fetch(config):
        captured["catalog_url"] = config.catalog_url
        return list(CATALOG_ITEMS)

    # Mock the catalog HTTP call (don't require catalog running).
    monkeypatch.setattr(rebuild_module, "fetch_catalog_images", fake_fetch)

    r = client.post("/rebuild")
    assert r.status_code == 202, r.text
    assert r.json()["upserted"] == 2  # cat-3 skipped (no dense)

    # The two catalog items with vectors landed in Qdrant under uuid5 ids.
    id1 = point_id_for_sha256(_sha("cat-1"))
    id2 = point_id_for_sha256(_sha("cat-2"))
    stored = store.client.retrieve(TEST_COLLECTION, ids=[id1, id2], with_payload=True)
    by_id = {str(p.id): p for p in stored}
    assert set(by_id) == {id1, id2}
    assert by_id[id1].payload["name"] == "cat-1"
    assert by_id[id1].payload["sha256"] == _sha("cat-1")

    # The skipped item is absent.
    id3 = point_id_for_sha256(_sha("cat-3"))
    assert store.client.retrieve(TEST_COLLECTION, ids=[id3]) == []

    # Used the configured catalog URL (default http://localhost:8001).
    assert captured["catalog_url"].endswith(":8001")
