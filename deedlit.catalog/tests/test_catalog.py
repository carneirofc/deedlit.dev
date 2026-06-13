"""Behavior tests for the deedlit.catalog service.

Each test runs against a freshly migrated throwaway database (see conftest) and
the live RustFS object store. Covers: image create+read, tags & params,
rating, favorite, references, and blob put/get for thumbnails + embeddings.
"""
from __future__ import annotations

import hashlib
import os
import secrets


def _sha() -> str:
    return hashlib.sha256(secrets.token_bytes(16)).hexdigest()


def test_create_image_and_read_back(client) -> None:
    sha = _sha()
    r = client.post(
        "/images",
        json={
            "sha256": sha,
            "width": 512,
            "height": 768,
            "sourceTool": "comfyui",
            "prompt": "a cat",
            "negative": "blurry",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sha256"] == sha
    assert body["width"] == 512
    assert body["favorite"] is False

    r2 = client.get(f"/images/{sha}")
    assert r2.status_code == 200
    got = r2.json()
    assert got["sha256"] == sha
    assert got["prompt"] == "a cat"
    assert got["negative"] == "blurry"
    assert got["created_at"] is not None


def test_missing_image_404(client) -> None:
    assert client.get(f"/images/{_sha()}").status_code == 404


def test_set_and_read_tags_and_params(client) -> None:
    sha = _sha()
    r = client.post(
        "/images",
        json={
            "sha256": sha,
            "tags": ["Red Eyes", "1girl"],
            "params": {
                "seed": 42,
                "steps": 20,
                "cfg": 7.5,
                "sampler": "euler",
                "clipskip": 2,
            },
        },
    )
    assert r.status_code == 200, r.text

    got = client.get(f"/images/{sha}").json()
    assert set(got["tags"]) == {"Red Eyes", "1girl"}
    assert got["params"]["seed"] == 42
    assert got["params"]["steps"] == 20
    assert got["params"]["cfg"] == 7.5
    assert got["params"]["sampler"] == "euler"
    assert got["params"]["clipskip"] == 2


def test_set_rating(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha})
    r = client.put(f"/images/{sha}/rating", json={"rating": 4})
    assert r.status_code == 200, r.text
    assert client.get(f"/images/{sha}").json()["rating"] == 4


def test_set_rating_missing_404(client) -> None:
    assert client.put(f"/images/{_sha()}/rating", json={"rating": 3}).status_code == 404


def test_set_favorite(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha})
    r = client.put(f"/images/{sha}/favorite", json={"favorite": True})
    assert r.status_code == 200, r.text
    assert client.get(f"/images/{sha}").json()["favorite"] is True

    # favorite filter
    listed = client.get("/images", params={"favorite": True}).json()
    assert any(i["sha256"] == sha for i in listed)


def test_patch_image(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha})
    r = client.patch(
        f"/images/{sha}",
        json={"rating": 5, "favorite": True, "tags": ["landscape"]},
    )
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["rating"] == 5
    assert got["favorite"] is True
    assert got["tags"] == ["landscape"]


def test_attach_references(client) -> None:
    sha = _sha()
    r = client.post(
        "/images",
        json={
            "sha256": sha,
            "references": [
                {"kind": "checkpoint", "name": "sdxl_base", "hash": "abc123"},
                {"kind": "lora", "name": "detail_tweaker"},
            ],
        },
    )
    assert r.status_code == 200, r.text
    refs = client.get(f"/images/{sha}").json()["references"]
    by_name = {x["name"]: x for x in refs}
    assert by_name["sdxl_base"]["kind"] == "checkpoint"
    assert by_name["sdxl_base"]["hash"] == "abc123"
    assert by_name["detail_tweaker"]["kind"] == "lora"
    assert by_name["detail_tweaker"]["hash"] is None


def test_list_by_tag(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha, "tags": ["unique_tag_xyz"]})
    listed = client.get("/images", params={"tag": "unique_tag_xyz"}).json()
    assert [i["sha256"] for i in listed] == [sha]


def test_put_get_thumbnail_blob(client) -> None:
    sha = _sha()
    payload = b"fake-webp-bytes-\x00\x01\x02"
    r = client.put(
        f"/blobs/{sha}/thumbnail",
        content=payload,
        headers={"content-type": "application/octet-stream"},
    )
    assert r.status_code == 200, r.text

    g = client.get(f"/blobs/{sha}/thumbnail")
    assert g.status_code == 200
    assert g.content == payload
    assert g.headers["content-type"] == "image/webp"


def test_put_get_embedding_blob(client) -> None:
    sha = _sha()
    payload = secrets.token_bytes(2048)  # raw float bytes stand-in
    r = client.put(
        f"/blobs/{sha}/embedding",
        content=payload,
        headers={"content-type": "application/octet-stream"},
    )
    assert r.status_code == 200, r.text

    g = client.get(f"/blobs/{sha}/embedding")
    assert g.status_code == 200
    assert g.content == payload
    assert g.headers["content-type"] == "application/octet-stream"


def test_blob_not_found_404(client) -> None:
    assert client.get(f"/blobs/{_sha()}/thumbnail").status_code == 404


def test_blob_key_layout() -> None:
    from catalog.object_store import blob_key

    sha = "ab" + "0" * 62
    assert blob_key(sha, "thumbnail") == f"thumbnails/ab/{sha}.webp"
    assert blob_key(sha, "embedding") == f"embeddings/ab/{sha}.bin"


def test_notes_and_collections(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha})

    note = client.post(
        "/notes",
        json={
            "title": "ref",
            "blocks": {"time": 1, "blocks": []},
            "imageRefs": [sha],
        },
    ).json()
    assert note["id"]
    fetched = client.get(f"/notes/{note['id']}").json()
    assert fetched["imageRefs"] == [sha]
    by_image = client.get(f"/notes/by-image/{sha}").json()
    assert any(n["id"] == note["id"] for n in by_image)

    col = client.post("/collections", json={"name": "faves", "images": [sha]}).json()
    assert col["images"] == [sha]
    r = client.put(f"/collections/{col['id']}/images", json={"images": []})
    assert r.status_code == 200
    assert client.get("/collections").json()[0]["images"] == []
