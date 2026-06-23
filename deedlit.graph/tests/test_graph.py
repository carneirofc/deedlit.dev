"""Integration tests for deedlit.graph against a live Neo4j."""
from __future__ import annotations

from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app import app
from graph.models import AssetRef
from graph.repository import asset_key, normalize_name
from tests.conftest import sha

client = TestClient(app)


# --- name normalization (unit) ----------------------------------------------


def test_normalize_name_strips_path_extension_and_case():
    assert normalize_name("SD/Models/Foo.safetensors") == "foo"
    assert normalize_name("foo.ckpt") == "foo"
    assert normalize_name("  FOO  ") == "foo"
    assert normalize_name("sub\\dir\\Bar.pt") == "bar"


# --- (1) POST /edges upsert creates Image+Asset+USES and links shared ckpt ---


def test_edges_upsert_links_images_sharing_checkpoint():
    a, b = sha("imgA"), sha("imgB")
    ckpt = {"kind": "checkpoint", "name": "dreamshaper.safetensors", "hash": None}

    r1 = client.post("/edges", json={"sha256": a, "references": [ckpt]})
    r2 = client.post("/edges", json={"sha256": b, "references": [ckpt]})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["assets"] == 1

    # Both images USE the same single Asset node.
    nb = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"})
    assert nb.status_code == 200
    shas = [n["sha256"] for n in nb.json()["neighbors"]]
    assert b in shas


# --- (2) GET /neighbors returns the co-asset image --------------------------


def test_neighbors_returns_co_asset_image_with_weight():
    a, b, c = sha("nA"), sha("nB"), sha("nC")
    lora = {"kind": "lora", "name": "detail.safetensors"}
    vae = {"kind": "vae", "name": "kl-f8.pt"}
    client.post("/edges", json={"sha256": a, "references": [lora, vae]})
    client.post("/edges", json={"sha256": b, "references": [lora, vae]})  # shares 2
    client.post("/edges", json={"sha256": c, "references": [lora]})        # shares 1

    nb = client.get(f"/neighbors/{a}").json()["neighbors"]
    by_sha = {n["sha256"]: n for n in nb}
    assert b in by_sha and c in by_sha
    # b shares more assets than c -> higher weight and ranked first
    assert by_sha[b]["weight"] > by_sha[c]["weight"]
    assert nb[0]["sha256"] == b


# --- (3) tag co-occurrence -> related-tags ----------------------------------


def test_related_tags_returns_cooccurring_tags():
    a, b = sha("tA"), sha("tB")
    client.post("/edges", json={"sha256": a, "tags": ["forest", "night", "moon"]})
    client.post("/edges", json={"sha256": b, "tags": ["forest", "night"]})

    rel = client.get("/related-tags/forest").json()
    tags = {row["tag"]: row["weight"] for row in rel}
    assert "night" in tags  # co-occurs in 2 images
    assert "moon" in tags   # co-occurs in 1 image
    assert tags["night"] > tags["moon"]

    # also surfaces via tag_cooccurrence neighbors
    nb = client.get(f"/neighbors/{a}", params={"relation": "tag_cooccurrence"}).json()
    assert b in [n["sha256"] for n in nb["neighbors"]]


# --- (4) lineage chain ------------------------------------------------------


def test_lineage_returns_chain():
    root, mid, leaf = sha("L0"), sha("L1"), sha("L2")
    # mid is an upscale of root; leaf is a variant of mid
    client.post("/edges", json={"sha256": root})
    client.post(
        "/edges",
        json={"sha256": mid, "lineage": [{"parent": root, "kind": "upscale"}]},
    )
    client.post(
        "/edges",
        json={"sha256": leaf, "lineage": [{"parent": mid, "kind": "variant"}]},
    )

    chain = client.get(f"/lineage/{mid}").json()["neighbors"]
    shas = {n["sha256"]: n["relation"] for n in chain}
    assert root in shas and shas[root] == "ancestor"
    assert leaf in shas and shas[leaf] == "descendant"

    # from the leaf, both root and mid are ancestors
    up = client.get(f"/lineage/{leaf}").json()["neighbors"]
    up_shas = {n["sha256"] for n in up}
    assert root in up_shas and mid in up_shas


# --- (5) edges key on normalized name when hash is None ----------------------


def test_edges_key_on_normalized_name_when_hash_absent():
    a, b = sha("kA"), sha("kB")
    # Same logical checkpoint, different paths/extensions, no hash.
    ref1 = {"kind": "checkpoint", "name": "SD/Foo.safetensors", "hash": None}
    ref2 = {"kind": "checkpoint", "name": "other\\dir\\foo.ckpt"}  # hash omitted

    assert asset_key(AssetRef(**ref1)) == asset_key(AssetRef(**ref2))

    client.post("/edges", json={"sha256": a, "references": [ref1]})
    client.post("/edges", json={"sha256": b, "references": [ref2]})

    # They collapse to one Asset -> the two images are shared-asset neighbors.
    nb = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"}).json()
    assert b in [n["sha256"] for n in nb["neighbors"]]


def test_edges_key_distinguishes_by_hash_when_present():
    a, b = sha("hA"), sha("hB")
    ref1 = {"kind": "lora", "name": "x.safetensors", "hash": "a" * 8}
    ref2 = {"kind": "lora", "name": "x.safetensors", "hash": "b" * 8}
    client.post("/edges", json={"sha256": a, "references": [ref1]})
    client.post("/edges", json={"sha256": b, "references": [ref2]})
    # Different hashes -> different assets -> NOT neighbors.
    nb = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"}).json()
    assert b not in [n["sha256"] for n in nb["neighbors"]]


# --- (6) DELETE /images/{sha256} removes the node + its edges ----------------


def test_delete_image_removes_node_and_neighbor_edges():
    a, b = sha("delA"), sha("delB")
    ckpt = {"kind": "checkpoint", "name": "todelete.safetensors", "hash": None}
    client.post("/edges", json={"sha256": a, "references": [ckpt]})
    client.post("/edges", json={"sha256": b, "references": [ckpt]})
    # a and b share the checkpoint, so they are shared-asset neighbors.
    nb = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"}).json()
    assert b in [n["sha256"] for n in nb["neighbors"]]

    r = client.delete(f"/images/{b}")
    assert r.status_code == 200
    assert r.json()["deleted"] == 1

    # b's node + USES edge are gone, so it no longer surfaces as a's neighbor.
    nb2 = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"}).json()
    assert b not in [n["sha256"] for n in nb2["neighbors"]]

    # Deleting a missing node is not an error and reports 0.
    assert client.delete(f"/images/{b}").json()["deleted"] == 0


def test_clean_tag_collapses_weighting_and_brackets():
    from graph.repository import clean_tag

    for raw in ["(asd)", "(asd:12)", "(asd:1.2)", "((asd))", "[asd]", "asd", "ASD", " AsD "]:
        assert clean_tag(raw) == "asd", raw
    assert clean_tag("red eyes") == "red eyes"
    assert clean_tag("(red eyes:1.1)") == "red eyes"


def test_weighted_and_plain_tag_collapse_to_one_node():
    a, b = sha("tcoA"), sha("tcoB")
    # Same booru tag, weighted on one image and plain on the other -> ONE :Tag
    # node, so the two images become tag-cooccurrence neighbors.
    client.post("/edges", json={"sha256": a, "tags": ["(asd:1.2)"], "references": []})
    client.post("/edges", json={"sha256": b, "tags": ["asd"], "references": []})
    nb = client.get(f"/neighbors/{a}", params={"relation": "tag_cooccurrence"}).json()
    assert b in [n["sha256"] for n in nb["neighbors"]]


def test_entities_suggest_by_type_prefix_and_usage():
    a, b = sha("eA"), sha("eB")
    ckpt = {"kind": "checkpoint", "name": "Dreamshaper.safetensors", "hash": None}
    lora = {"kind": "lora", "name": "detail-tweaker.safetensors"}
    client.post("/edges", json={"sha256": a, "references": [ckpt, lora], "tags": ["forest", "night"]})
    client.post("/edges", json={"sha256": b, "references": [ckpt], "tags": ["forest"]})

    # Tags ranked most-used first (forest: 2 images, night: 1).
    tags = client.get("/entities", params={"type": "tag"}).json()
    assert tags[0] == "forest"
    assert "night" in tags

    # Prefix is case-insensitive and matches the start of the name.
    assert client.get("/entities", params={"type": "tag", "prefix": "FOR"}).json() == ["forest"]

    # Asset kind -> the asset's display name (original casing preserved).
    assert client.get("/entities", params={"type": "checkpoint"}).json() == ["Dreamshaper.safetensors"]
    assert client.get(
        "/entities", params={"type": "checkpoint", "prefix": "dream"}
    ).json() == ["Dreamshaper.safetensors"]
    # Kinds are independent.
    assert client.get("/entities", params={"type": "lora"}).json() == ["detail-tweaker.safetensors"]

    # No matches / unknown kind -> empty list (the picker just goes quiet).
    assert client.get("/entities", params={"type": "vae"}).json() == []
    assert client.get("/entities", params={"type": "tag", "prefix": "zzz"}).json() == []


def test_batch_delete_removes_many_nodes():
    a, b, c = sha("bdelA"), sha("bdelB"), sha("bdelC")
    ck = {"kind": "checkpoint", "name": "batchdel.safetensors", "hash": None}
    for s in (a, b, c):
        client.post("/edges", json={"sha256": s, "references": [ck]})

    # Delete a + b in ONE call (+ a never-seen sha, which is a no-op).
    r = client.post("/images/batch-delete", json={"sha256s": [a, b, sha("never")]})
    assert r.status_code == 200
    assert r.json()["deleted"] == 2  # only a + b existed

    # a + b are gone; c is untouched.
    assert client.delete(f"/images/{a}").json()["deleted"] == 0
    assert client.delete(f"/images/{b}").json()["deleted"] == 0
    assert client.delete(f"/images/{c}").json()["deleted"] == 1


# --- POST /prune removes structurally-orphaned Asset/Tag nodes --------------


def test_prune_removes_orphaned_asset_and_tag_after_image_delete():
    a = sha("pruneA")
    ckpt = {"kind": "checkpoint", "name": "lonely.safetensors", "hash": None}
    client.post("/edges", json={"sha256": a, "references": [ckpt], "tags": ["solo"]})

    # The asset + tag are reachable via the entity autocomplete while the image lives.
    assert client.get("/entities", params={"type": "checkpoint"}).json() == ["lonely.safetensors"]
    assert "solo" in client.get("/entities", params={"type": "tag"}).json()

    # Delete the only image that used them: delete_image leaves the Asset/Tag behind.
    assert client.delete(f"/images/{a}").json()["deleted"] == 1
    assert client.get("/entities", params={"type": "checkpoint"}).json() == ["lonely.safetensors"]
    assert "solo" in client.get("/entities", params={"type": "tag"}).json()

    # Prune sweeps the now-orphaned Asset + Tag.
    r = client.post("/prune")
    assert r.status_code == 200
    body = r.json()
    assert body["assets_deleted"] == 1
    assert body["tags_deleted"] == 1
    assert body["dry_run"] is False

    # They're gone from the autocomplete now.
    assert client.get("/entities", params={"type": "checkpoint"}).json() == []
    assert client.get("/entities", params={"type": "tag"}).json() == []

    # Idempotent: a second prune finds nothing.
    assert client.post("/prune").json() == {
        "status": "ok", "assets_deleted": 0, "tags_deleted": 0, "dry_run": False,
    }


def test_prune_keeps_assets_and_tags_still_in_use():
    a, b = sha("keepA"), sha("keepB")
    ckpt = {"kind": "checkpoint", "name": "shared.safetensors", "hash": None}
    client.post("/edges", json={"sha256": a, "references": [ckpt], "tags": ["forest"]})
    client.post("/edges", json={"sha256": b, "references": [ckpt], "tags": ["forest"]})

    # Delete only one of the two images that share the checkpoint + tag.
    client.delete(f"/images/{a}")
    # The asset + tag are STILL used by b, so prune must not touch them.
    r = client.post("/prune").json()
    assert r["assets_deleted"] == 0
    assert r["tags_deleted"] == 0
    assert client.get("/entities", params={"type": "checkpoint"}).json() == ["shared.safetensors"]
    assert client.get("/entities", params={"type": "tag"}).json() == ["forest"]


def test_prune_dry_run_counts_without_deleting():
    a = sha("dryA")
    client.post(
        "/edges",
        json={
            "sha256": a,
            "references": [{"kind": "lora", "name": "dry.safetensors"}],
            "tags": ["alpha", "beta"],
        },
    )
    client.delete(f"/images/{a}")

    # dry_run reports the would-be deletions and removes nothing.
    preview = client.post("/prune", json={"dry_run": True}).json()
    assert preview == {"status": "ok", "assets_deleted": 1, "tags_deleted": 2, "dry_run": True}
    assert "dry.safetensors" in client.get("/entities", params={"type": "lora"}).json()

    # The real run then actually deletes them.
    done = client.post("/prune", json={"dry_run": False}).json()
    assert done["assets_deleted"] == 1 and done["tags_deleted"] == 2
    assert client.get("/entities", params={"type": "lora"}).json() == []


def test_prune_never_deletes_image_nodes():
    # A bare image with no references and no tags is structurally identical to a
    # lineage stub; prune must leave ALL Image nodes in place.
    a = sha("imgKeep")
    client.post("/edges", json={"sha256": a})
    client.post("/prune")
    # The image node still exists (lineage query answers for a known node).
    assert client.get(f"/lineage/{a}").status_code == 200
    # And it can still be deleted explicitly (i.e. it was not pruned away).
    assert client.delete(f"/images/{a}").json()["deleted"] == 1


# --- rebuild-from-catalog (mocked HTTP) -------------------------------------


def test_rebuild_upserts_edges_from_mocked_catalog():
    a, b = sha("rA"), sha("rB")
    ckpt = {"kind": "checkpoint", "name": "anime.safetensors", "hash": None}
    catalog_images = [
        {"sha256": a, "references": [ckpt], "tags": ["anime"], "lineage": []},
        {
            "sha256": b,
            "references": [ckpt],
            "tags": ["anime", "portrait"],
            "lineage": [{"parent": a, "kind": "variant"}],
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/images"
        offset = int(request.url.params.get("offset", "0"))
        page = catalog_images if offset == 0 else []
        return httpx.Response(200, json=page)

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    with patch("graph.rebuild.httpx.Client", return_value=mock_client):
        r = client.post("/rebuild")
    assert r.status_code == 202
    assert r.json()["edges_upserted"] == 2

    # The rebuilt graph behaves: shared checkpoint, co-tag, and lineage all present.
    nb = client.get(f"/neighbors/{a}", params={"relation": "shared_asset"}).json()
    assert b in [n["sha256"] for n in nb["neighbors"]]
    rel = client.get("/related-tags/anime").json()
    assert "portrait" in [row["tag"] for row in rel]
    lin = client.get(f"/lineage/{a}").json()["neighbors"]
    assert b in [n["sha256"] for n in lin]
