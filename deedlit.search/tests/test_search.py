"""Integration tests against a LIVE Qdrant.

qdrant-client has no in-process mode that reliably supports sparse vectors +
RRF fusion, so these tests require a running Qdrant (``docker compose up -d
--wait qdrant`` from the repo root). They use a throwaway collection
(``conftest.TEST_COLLECTION``) that is dropped in teardown.
"""
from __future__ import annotations

import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient

import app as app_module
from conftest import TEST_COLLECTION
from id_scheme import NAMESPACE, point_id_for_sha256
from search.config import (
    DENSE_DIM,
    DENSE_VECTOR_NAME,
    DESCRIPTION_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
)

client = TestClient(app_module.app)
store = app_module.get_store()


def _sha(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def _dense(seed: int) -> list[float]:
    """A simple 1024-dim one-hot-ish vector so neighbors are predictable."""
    vec = [0.0] * DENSE_DIM
    vec[seed % DENSE_DIM] = 1.0
    vec[(seed + 1) % DENSE_DIM] = 0.5
    return vec


def _sparse(indices, values):
    return {"indices": list(indices), "values": list(values)}


# Three deterministic fixtures. A and B share a dense direction (close); C is
# orthogonal (far). Sparse weights make A/C share lexical terms.
SHA_A = _sha("image-a")
SHA_B = _sha("image-b")
SHA_C = _sha("image-c")


@pytest.fixture(scope="module", autouse=True)
def _clean_collection():
    """Ensure a fresh throwaway collection for the module; drop it after."""
    store.drop_collection()
    store.ensure_collection()
    yield
    store.drop_collection()


def _upsert(sha, dense, sparse=None, payload=None):
    body = {"sha256": sha, "dense": dense}
    if sparse is not None:
        body["sparse"] = sparse
    if payload is not None:
        body["payload"] = payload
    r = client.post("/points", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def _seed(_clean_collection):
    # A and B point the same dense direction; C is orthogonal.
    _upsert(SHA_A, _dense(0), _sparse([1, 2, 3], [0.9, 0.8, 0.1]), {"name": "a"})
    _upsert(SHA_B, _dense(0), _sparse([7, 8, 9], [0.4, 0.4, 0.4]), {"name": "b"})
    _upsert(SHA_C, _dense(500), _sparse([1, 2, 3], [0.9, 0.8, 0.1]), {"name": "c"})


# --- (1) collection created with named dense + sparse vectors ---------------


def test_collection_has_named_dense_and_sparse_vectors():
    info = store.client.get_collection(TEST_COLLECTION)
    vectors = info.config.params.vectors
    assert DENSE_VECTOR_NAME in vectors
    assert vectors[DENSE_VECTOR_NAME].size == DENSE_DIM
    # Cosine distance on the dense named vector.
    assert vectors[DENSE_VECTOR_NAME].distance.lower() == "cosine"
    sparse = info.config.params.sparse_vectors
    assert sparse is not None and SPARSE_VECTOR_NAME in sparse


def test_collection_has_description_dense_vector():
    info = store.client.get_collection(TEST_COLLECTION)
    vectors = info.config.params.vectors
    # The description (CLIP text) vector lives in the same space as the image one.
    assert DESCRIPTION_VECTOR_NAME in vectors
    assert vectors[DESCRIPTION_VECTOR_NAME].size == DENSE_DIM
    assert vectors[DESCRIPTION_VECTOR_NAME].distance.lower() == "cosine"


def test_description_vector_indexed_and_queryable():
    """A point's optional description vector is stored under its own named vector
    and can be queried independently (fusion='description')."""
    sha = _sha("desc-point")
    desc_vec = _dense(700)
    r = client.post(
        "/points",
        json={"sha256": sha, "dense": _dense(701), "description": desc_vec},
    )
    assert r.status_code == 200, r.text

    r = client.post("/query", json={"description": desc_vec, "limit": 5})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["fusion"] == "description"
    assert sha in {h["sha256"] for h in data["hits"]}

    # Clean up so the seeded A/B/C neighbour assertions stay unaffected.
    client.delete(f"/points/{sha}")


# --- (2) /points upserts and the point id equals uuid5(sha256) --------------


def test_point_id_is_uuid5_of_sha256():
    result = _upsert(_sha("idcheck"), _dense(10))
    expected = str(uuid.uuid5(NAMESPACE, _sha("idcheck")))
    assert result["id"] == expected
    assert result["id"] == point_id_for_sha256(_sha("idcheck"))
    # The full sha256 is carried in the payload of the stored point.
    stored = store.client.retrieve(TEST_COLLECTION, ids=[expected], with_payload=True)
    assert stored[0].payload["sha256"] == _sha("idcheck")


def test_upsert_points_writes_whole_batch_in_one_call():
    """The batch upsert writes every point (one Qdrant round-trip) and returns
    their ids in order; each is immediately retrievable (wait=True)."""
    shas = [_sha(f"batch-{i}") for i in range(3)]
    ids = store.upsert_points(
        [(s, _dense(800 + i), None, {"name": f"batch{i}"}, None) for i, s in enumerate(shas)]
    )
    assert ids == [point_id_for_sha256(s) for s in shas]
    for pid in ids:
        assert store.client.retrieve(TEST_COLLECTION, ids=[pid])
    # Clean up so the seeded A/B/C neighbour assertions stay unaffected.
    for s in shas:
        client.delete(f"/points/{s}")


# --- (3) /query hybrid dense+sparse returns RRF-fused hits -------------------


def test_query_hybrid_uses_rrf_fusion():
    body = {
        "dense": _dense(0),
        "sparse": _sparse([1, 2, 3], [0.9, 0.8, 0.1]),
        "limit": 10,
    }
    r = client.post("/query", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["fusion"] == "rrf"
    shas = {h["sha256"] for h in data["hits"]}
    # All three are reachable via one of the two prefetches, so RRF surfaces them.
    assert {SHA_A, SHA_B, SHA_C} <= shas
    # Hits are ranked (scores descending).
    scores = [h["score"] for h in data["hits"]]
    assert scores == sorted(scores, reverse=True)


# --- (4) /query with only dense (or only sparse) ----------------------------


def test_query_dense_only():
    r = client.post("/query", json={"dense": _dense(0), "limit": 10})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["fusion"] == "dense"
    # A and B share the dense direction; both rank above orthogonal C.
    ranked = [h["sha256"] for h in data["hits"]]
    assert ranked[0] in {SHA_A, SHA_B}
    assert ranked.index(SHA_C) > ranked.index(SHA_A)
    assert ranked.index(SHA_C) > ranked.index(SHA_B)


def test_query_sparse_only():
    r = client.post(
        "/query",
        json={"sparse": _sparse([1, 2, 3], [0.9, 0.8, 0.1]), "limit": 10},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["fusion"] == "sparse"
    shas = {h["sha256"] for h in data["hits"]}
    # A and C share the lexical terms; B (terms 7,8,9) does not.
    assert {SHA_A, SHA_C} <= shas
    assert SHA_B not in shas


def test_query_requires_a_vector():
    r = client.post("/query", json={"limit": 5})
    assert r.status_code == 422


# --- (5) similar + by-image return expected neighbors -----------------------


def test_similar_returns_neighbors_excluding_self():
    r = client.post("/similar", json={"sha256": SHA_A, "limit": 5})
    assert r.status_code == 200, r.text
    hits = r.json()["hits"]
    shas = [h["sha256"] for h in hits]
    assert SHA_A not in shas  # excludes the query point itself
    # B shares A's dense direction so it is the nearest neighbor.
    assert shas[0] == SHA_B


def test_similar_offset_pages_deeper_neighbors():
    """offset pages past the nearest window. Page 0 (offset 0) yields the nearest
    neighbour B; offset 1 skips it and surfaces the next-nearest (C) — no self,
    no duplicate of the already-seen B."""
    page0 = client.post("/similar", json={"sha256": SHA_A, "limit": 1, "offset": 0})
    page1 = client.post("/similar", json={"sha256": SHA_A, "limit": 1, "offset": 1})
    assert page0.status_code == 200 and page1.status_code == 200
    first = [h["sha256"] for h in page0.json()["hits"]]
    second = [h["sha256"] for h in page1.json()["hits"]]
    assert first == [SHA_B]
    assert SHA_A not in second and SHA_B not in second
    assert second == [SHA_C]


def test_by_image_returns_neighbors():
    r = client.post("/by-image", json={"sha256": SHA_A, "limit": 5})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["fusion"] == "dense"
    shas = [h["sha256"] for h in data["hits"]]
    assert SHA_A not in shas
    assert shas[0] == SHA_B


def test_by_image_applies_payload_filter():
    """A payload filter on /by-image excludes non-matching neighbours — B is the
    nearest to A but is filtered out, leaving only C (which the filter matches)."""
    r = client.post(
        "/by-image",
        json={
            "sha256": SHA_A,
            "limit": 5,
            "filter": {"must": [{"key": "name", "match": {"value": "c"}}]},
        },
    )
    assert r.status_code == 200, r.text
    shas = [h["sha256"] for h in r.json()["hits"]]
    assert shas == [SHA_C]  # B (nearest, name=b) filtered out; only C remains


# --- (6) DELETE /points/{sha256} removes the point (idempotent) --------------


def test_delete_point_removes_it_idempotently():
    # Use a throwaway point so the seeded A/B/C fixtures stay intact.
    sha = _sha("to-delete")
    _upsert(sha, _dense(123))
    pid = point_id_for_sha256(sha)
    assert store.client.retrieve(TEST_COLLECTION, ids=[pid])  # present

    r = client.delete(f"/points/{sha}")
    assert r.status_code == 200, r.text
    assert r.json()["sha256"] == sha
    assert store.client.retrieve(TEST_COLLECTION, ids=[pid]) == []  # gone

    # Deleting a missing point is not an error.
    assert client.delete(f"/points/{sha}").status_code == 200
