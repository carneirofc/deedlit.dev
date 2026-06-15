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


def test_filepath_roundtrips_and_survives_reindex(client) -> None:
    sha = _sha()
    # Fresh ingest carries the original on-disk source path.
    r = client.post("/images", json={"sha256": sha, "filepath": "/lib/a/cat.png"})
    assert r.status_code == 200, r.text
    assert r.json()["filepath"] == "/lib/a/cat.png"

    # A later reindex re-upserts the same sha WITHOUT a path (the path is unknown
    # when re-running from stored bytes). file_path is INSERT-only, so the real
    # path must be preserved rather than clobbered with the object-store URI.
    r2 = client.post("/images", json={"sha256": sha, "prompt": "refreshed"})
    assert r2.status_code == 200, r2.text
    got = client.get(f"/images/{sha}").json()
    assert got["filepath"] == "/lib/a/cat.png"
    assert got["prompt"] == "refreshed"


def test_filepath_defaults_to_object_store_uri_when_absent(client) -> None:
    # No path supplied (e.g. an ingest that never had one): the NOT NULL column
    # falls back to the sha256-keyed object-store URI rather than failing.
    sha = _sha()
    r = client.post("/images", json={"sha256": sha})
    assert r.status_code == 200, r.text
    assert r.json()["filepath"] == f"s3://images/{sha}"


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


def _make_image(client, *, filepath, tags, rating=None) -> str:
    """Create an image with tags / filepath (+ optional rating) and return its sha."""
    sha = _sha()
    r = client.post("/images", json={"sha256": sha, "filepath": filepath, "tags": tags})
    assert r.status_code == 200, r.text
    if rating is not None:
        client.put(f"/images/{sha}/rating", json={"rating": rating})
    return sha


def test_list_browse_sort_and_tag_filters(client) -> None:
    # Three images created oldest->newest. Names chosen so basename sort differs
    # from insert order: a_apple < b_banana < c_cat.
    a = _make_image(client, filepath="/lib/a_apple.png", tags=["knight", "castle"], rating=5)
    b = _make_image(client, filepath="/lib/c_cat.png", tags=["knight"], rating=2)
    c = _make_image(client, filepath="/lib/b_banana.png", tags=["knight", "castle", "blurry"])

    def shas(params):
        return [i["sha256"] for i in client.get("/images", params=params).json()]

    # Newest-first (default) vs oldest-first.
    assert shas({"sort": "newest"}) == [c, b, a]
    assert shas({"sort": "oldest"}) == [a, b, c]

    # Include tags AND together: only images carrying BOTH knight + castle.
    assert set(shas([("tag", "knight"), ("tag", "castle")])) == {a, c}

    # Exclude drops any match: knight minus blurry leaves a, b.
    assert set(shas([("tag", "knight"), ("exclude_tag", "blurry")])) == {a, b}

    # Rating floor keeps only sufficiently-rated images.
    assert shas({"rating_gte": 3}) == [a]

    # Rating sort: highest first, unrated (NULL) sorts last.
    assert shas({"sort": "rating_desc"}) == [a, b, c]

    # Name sort uses the basename, not insert order.
    assert shas({"sort": "name_asc"}) == [a, c, b]


def test_delete_image_removes_record_refs_and_blob(client) -> None:
    sha = _sha()
    client.post(
        "/images",
        json={
            "sha256": sha,
            "tags": ["todelete_xyz"],
            "references": [{"kind": "lora", "name": "x"}],
        },
    )
    client.put(
        f"/blobs/{sha}/thumbnail",
        content=b"fake-webp",
        headers={"content-type": "application/octet-stream"},
    )
    assert client.get(f"/images/{sha}").status_code == 200

    r = client.delete(f"/images/{sha}")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    # Record + blob are gone, and the image no longer lists under its tag.
    assert client.get(f"/images/{sha}").status_code == 404
    assert client.get(f"/blobs/{sha}/thumbnail").status_code == 404
    listed = client.get("/images", params={"tag": "todelete_xyz"}).json()
    assert all(i["sha256"] != sha for i in listed)


def test_delete_missing_image_404(client) -> None:
    assert client.delete(f"/images/{_sha()}").status_code == 404


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


def test_safety_roundtrips_and_survives_reindex(client) -> None:
    # Ingest classifies the image; the safety class round-trips on read.
    sha = _sha()
    r = client.post("/images", json={"sha256": sha, "safety": "explicit"})
    assert r.status_code == 200, r.text
    assert r.json()["safety"] == "explicit"

    # A reindex with no safety supplied must not wipe the stored class (COALESCE).
    r2 = client.post("/images", json={"sha256": sha, "prompt": "refreshed"})
    assert r2.status_code == 200, r2.text
    assert client.get(f"/images/{sha}").json()["safety"] == "explicit"


def test_description_roundtrips_survives_reindex_and_refreshes(client) -> None:
    # The labelagent's (expensive) description is persisted and round-trips on read.
    sha = _sha()
    desc = "A red-armored knight standing in a misty forest."
    r = client.post("/images", json={"sha256": sha, "description": desc})
    assert r.status_code == 200, r.text
    assert r.json()["description"] == desc

    # A reindex with the labelagent off (no description) must NOT wipe the stored
    # one — re-deriving it is expensive, so it is kept like the scalar columns.
    r2 = client.post("/images", json={"sha256": sha, "prompt": "refreshed"})
    assert r2.status_code == 200, r2.text
    assert client.get(f"/images/{sha}").json()["description"] == desc

    # A reindex that DOES supply a new description refreshes it (single current
    # row per provider — no duplicate accumulation across re-ingests).
    new_desc = "A knight in gleaming silver armor under a clear sky."
    r3 = client.post("/images", json={"sha256": sha, "description": new_desc})
    assert r3.status_code == 200, r3.text
    assert client.get(f"/images/{sha}").json()["description"] == new_desc


def test_patch_safety(client) -> None:
    sha = _sha()
    client.post("/images", json={"sha256": sha, "safety": "nsfw"})
    r = client.patch(f"/images/{sha}", json={"safety": "sfw"})
    assert r.status_code == 200, r.text
    assert r.json()["safety"] == "sfw"


def test_list_filter_by_safety_multi(client) -> None:
    sfw, nsfw, exp = _sha(), _sha(), _sha()
    client.post("/images", json={"sha256": sfw, "safety": "sfw"})
    client.post("/images", json={"sha256": nsfw, "safety": "nsfw"})
    client.post("/images", json={"sha256": exp, "safety": "explicit"})

    # Multi-select: include sfw + nsfw, exclude explicit.
    listed = client.get("/images", params={"safety": ["sfw", "nsfw"]}).json()
    shas = {i["sha256"] for i in listed}
    assert sfw in shas and nsfw in shas
    assert exp not in shas


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


def test_put_get_sparse_blob(client) -> None:
    # The embed.sparse stage (ADR 0002) persists the sparse vector as JSON; the
    # index.search fan-in reads it back. Round-trip the bytes + content type.
    sha = _sha()
    payload = b'{"indices":[1,7,42],"values":[0.5,0.25,0.1]}'
    r = client.put(
        f"/blobs/{sha}/sparse",
        content=payload,
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 200, r.text

    g = client.get(f"/blobs/{sha}/sparse")
    assert g.status_code == 200
    assert g.content == payload
    assert g.headers["content-type"] == "application/json"


def test_blob_rejects_unknown_kind(client) -> None:
    assert client.get(f"/blobs/{_sha()}/bogus").status_code == 422
    assert (
        client.put(
            f"/blobs/{_sha()}/bogus",
            content=b"x",
            headers={"content-type": "application/octet-stream"},
        ).status_code
        == 422
    )


def test_blob_not_found_404(client) -> None:
    assert client.get(f"/blobs/{_sha()}/thumbnail").status_code == 404


def test_blob_key_layout() -> None:
    from catalog.object_store import blob_key

    sha = "ab" + "0" * 62
    assert blob_key(sha, "thumbnail") == f"thumbnails/ab/{sha}.webp"
    assert blob_key(sha, "embedding") == f"embeddings/ab/{sha}.bin"
    assert blob_key(sha, "sparse") == f"sparse/ab/{sha}.json"


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


# --- #12: note export ------------------------------------------------------


def test_note_export(client) -> None:
    sha = _sha()
    note = client.post(
        "/notes",
        json={
            "title": "export me",
            "positive": "masterpiece",
            "negative": "lowres",
            "blocks": {"time": 7, "blocks": [{"type": "paragraph"}]},
            "imageRefs": [sha],
        },
    ).json()

    r = client.get(f"/notes/{note['id']}/export")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["id"] == note["id"]
    assert payload["title"] == "export me"
    assert payload["positive"] == "masterpiece"
    assert payload["negative"] == "lowres"
    assert payload["blocks"] == {"time": 7, "blocks": [{"type": "paragraph"}]}
    assert payload["imageRefs"] == [sha]


def test_note_export_missing_404(client) -> None:
    import uuid as _uuid

    assert client.get(f"/notes/{_uuid.uuid4()}/export").status_code == 404


# --- #13: collection rename / delete / reorder / by-image ------------------


def test_collection_rename(client) -> None:
    col = client.post("/collections", json={"name": "old"}).json()
    r = client.put(f"/collections/{col['id']}", json={"name": "new"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "new"
    assert client.get(f"/collections/{col['id']}").json()["name"] == "new"


def test_collection_rename_missing_404(client) -> None:
    import uuid as _uuid

    assert (
        client.put(f"/collections/{_uuid.uuid4()}", json={"name": "x"}).status_code
        == 404
    )


def test_collection_delete(client) -> None:
    col = client.post("/collections", json={"name": "doomed"}).json()
    r = client.delete(f"/collections/{col['id']}")
    assert r.status_code == 200, r.text
    assert client.get(f"/collections/{col['id']}").status_code == 404
    assert client.delete(f"/collections/{col['id']}").status_code == 404


def test_collection_read_one(client) -> None:
    sha = _sha()
    col = client.post("/collections", json={"name": "single", "images": [sha]}).json()
    got = client.get(f"/collections/{col['id']}")
    assert got.status_code == 200, got.text
    assert got.json()["images"] == [sha]


def test_collection_reorder_images(client) -> None:
    a, b, c = _sha(), _sha(), _sha()
    col = client.post(
        "/collections", json={"name": "ordered", "images": [a, b, c]}
    ).json()
    assert col["images"] == [a, b, c]
    # reorder + remove b (set semantics)
    r = client.put(f"/collections/{col['id']}/images", json={"images": [c, a]})
    assert r.status_code == 200, r.text
    assert client.get(f"/collections/{col['id']}").json()["images"] == [c, a]


def test_collections_by_image(client) -> None:
    sha = _sha()
    other = _sha()
    c1 = client.post("/collections", json={"name": "has-it", "images": [sha]}).json()
    client.post("/collections", json={"name": "not-it", "images": [other]}).json()
    c3 = client.post(
        "/collections", json={"name": "also-has-it", "images": [other, sha]}
    ).json()

    listed = client.get(f"/collections/by-image/{sha}").json()
    ids = {c["id"] for c in listed}
    assert ids == {c1["id"], c3["id"]}
