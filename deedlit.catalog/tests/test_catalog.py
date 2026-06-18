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


def test_list_filter_by_path_substring(client) -> None:
    # Separator-insensitive SUBSTRING match over file_path. The third image uses a
    # Windows-style backslash path on purpose: a forward-slash query must match it.
    a = _make_image(client, filepath="/lib/2024/portraits/a.png", tags=["x"])
    b = _make_image(client, filepath="/lib/2024/landscapes/b.png", tags=["x"])
    c = _make_image(client, filepath=r"D:\art\2023\portraits\c.png", tags=["x"])

    def shas(params):
        return {i["sha256"] for i in client.get("/images", params=params).json()}

    # A folder fragment matches anywhere in the path, across separators + case.
    assert shas({"path": "portraits"}) == {a, c}
    assert shas({"path": "LANDSCAPES"}) == {b}
    # A deeper fragment narrows to one tree; the backslash path matches a slash query.
    assert shas({"path": "2024/portraits"}) == {a}
    assert shas({"path": "2023/portraits"}) == {c}
    # No match -> empty; count mirrors the list filter.
    assert shas({"path": "nope_zzz"}) == set()
    assert client.get("/images/count", params={"path": "portraits"}).json()["count"] == 2


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


def test_created_date_sort_differs_from_ingestion(client) -> None:
    # Ingestion order a -> b -> c -> d (imported_at increasing). Creation times
    # are deliberately REVERSED for a/b/c (a is the newest creation), so a sort by
    # creation date must NOT match the ingestion order. `d` carries no createdAt,
    # so it falls back to its (latest) import time.
    a, b, c, d = _sha(), _sha(), _sha(), _sha()
    client.post("/images", json={"sha256": a, "createdAt": "2024-03-01T00:00:00+00:00"})
    client.post("/images", json={"sha256": b, "createdAt": "2024-02-01T00:00:00+00:00"})
    client.post("/images", json={"sha256": c, "createdAt": "2024-01-01T00:00:00+00:00"})
    client.post("/images", json={"sha256": d})  # no creation time -> uses import time

    def shas(sort):
        return [i["sha256"] for i in client.get("/images", params={"sort": sort}).json()]

    # Ingestion: newest import first. d imported last, then c, b, a.
    assert shas("newest") == [d, c, b, a]
    # Creation: a (Mar) > b (Feb) > c (Jan); d falls back to its import time, the
    # most recent of all, so it leads. Proves creation != ingestion ordering.
    assert shas("created_desc") == [d, a, b, c]
    assert shas("created_asc") == [c, b, a, d]


def test_created_at_survives_reindex_without_mtime(client) -> None:
    # First ingest captures a creation time; a later reindex (no createdAt) must
    # not wipe it — created_at is INSERT-only.
    sha = _sha()
    client.post("/images", json={"sha256": sha, "createdAt": "2022-05-05T12:00:00+00:00"})
    client.post("/images", json={"sha256": sha, "prompt": "reindexed"})  # no createdAt
    got = client.get(f"/images/{sha}").json()
    assert got["created_at"].startswith("2022-05-05T12:00:00")


def test_suggest_tags_prefix_and_usage_ranking(client) -> None:
    # castle x3, cat x2, cathedral x1, dog x1 — usage drives the order.
    for tags in (
        ["castle", "cat", "cathedral", "dog"],
        ["castle", "cat"],
        ["castle"],
    ):
        client.post("/images", json={"sha256": _sha(), "tags": tags})

    # Prefix match, ranked by how many images carry each tag.
    assert client.get("/tags", params={"prefix": "cat"}).json() == ["cat", "cathedral"]
    # "cas" only matches castle.
    assert client.get("/tags", params={"prefix": "cas"}).json() == ["castle"]
    # Empty prefix returns the globally most-used tags first.
    assert client.get("/tags", params={"prefix": ""}).json()[0] == "castle"
    # No match -> empty list.
    assert client.get("/tags", params={"prefix": "zzz_nope"}).json() == []


# --- reports: count / tag inventory / stats / folder coverage --------------


def test_images_count_matches_filters(client) -> None:
    # Fresh DB per test (conftest), so counts are exact.
    a = _make_image(client, filepath="/c/a.png", tags=["alpha", "shared"], rating=5)
    _make_image(client, filepath="/c/b.png", tags=["beta", "shared"], rating=1)
    _make_image(client, filepath="/c/c.png", tags=["shared"])

    def count(params):
        return client.get("/images/count", params=params).json()["count"]

    assert count({}) == 3
    assert count({"tag": "shared"}) == 3
    # AND semantics: only the image carrying both shared AND alpha.
    assert count([("tag", "shared"), ("tag", "alpha")]) == 1
    assert count({"rating_gte": 3}) == 1
    assert count({"exclude_tag": "beta"}) == 2
    # The count agrees with what listing returns under the same filter.
    listed = client.get("/images", params={"tag": "alpha"}).json()
    assert count({"tag": "alpha"}) == len(listed) == 1
    assert listed[0]["sha256"] == a


def test_tags_report_counts_total_and_paging(client) -> None:
    # castle x3, cat x2, dog x1 — usage drives both the counts and the order.
    for tags in (["castle", "cat", "dog"], ["castle", "cat"], ["castle"]):
        client.post("/images", json={"sha256": _sha(), "tags": tags})

    body = client.get("/tags/report").json()
    assert body["total"] == 3  # castle, cat, dog
    counts = {t["name"]: t["image_count"] for t in body["items"]}
    assert counts == {"castle": 3, "cat": 2, "dog": 1}
    # Most-used first.
    assert [t["name"] for t in body["items"]] == ["castle", "cat", "dog"]
    assert body["items"][0]["normalized_name"] == "castle"

    # Prefix narrows the inventory (and its total).
    ca = client.get("/tags/report", params={"prefix": "ca"}).json()
    assert ca["total"] == 2
    assert {t["name"] for t in ca["items"]} == {"castle", "cat"}

    # limit/offset pages the whole inventory; total stays the full count.
    page = client.get("/tags/report", params={"limit": 1, "offset": 1}).json()
    assert page["total"] == 3
    assert [t["name"] for t in page["items"]] == ["cat"]


def test_stats_aggregate_counts(client) -> None:
    s1, s2, s3 = _sha(), _sha(), _sha()
    client.post("/images", json={"sha256": s1, "safety": "sfw", "tags": ["x"], "description": "d"})
    client.post("/images", json={"sha256": s2, "safety": "nsfw"})
    client.post("/images", json={"sha256": s3})  # unclassified, unlabeled
    client.put(f"/images/{s1}/favorite", json={"favorite": True})
    client.post("/collections", json={"name": "c1", "images": [s1]})
    client.post("/notes", json={"blocks": {"time": 1, "blocks": []}, "imageRefs": [s1]})
    client.post("/folders", json={"path": "/lib/statscov"})

    st = client.get("/stats").json()
    assert st["images"] == 3
    assert st["tags"] == 1
    assert st["collections"] == 1
    assert st["notes"] == 1
    assert st["folders"] == 1
    assert st["favorites"] == 1
    # Only s1 carries a labelagent description.
    assert st["labeled"] == 1
    assert st["unlabeled"] == 2
    assert st["safety"] == {"sfw": 1, "nsfw": 1, "explicit": 0, "unclassified": 1}


def test_reports_folders_coverage(client) -> None:
    client.post("/folders", json={"path": "/lib/reportcov", "label": "Report"})
    s1, s2 = _sha(), _sha()
    client.post("/images", json={"sha256": s1, "filepath": "/lib/reportcov/a.png", "description": "d"})
    client.post("/images", json={"sha256": s2, "filepath": "/lib/reportcov/b.png"})

    rep = client.get("/reports/folders").json()
    row = next(r for r in rep if r["path"] == "/lib/reportcov")
    assert row["label"] == "Report"
    assert row["image_count"] == 2
    assert row["labeled_count"] == 1
    assert row["unlabeled_count"] == 1
    # Trimmed projection: no scan-config/scan-state noise.
    assert "scan_interval_seconds" not in row
    assert "last_scan_at" not in row


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
