"""Tests for the source-folder registry + unlabeled-images query.

Uses the throwaway-migrated-DB ``client`` fixture (conftest.py). The folder
registry is the catalog-owned config that the ingest scheduler reads/writes;
image/label counts are derived on read from images.file_path prefixes, so the
tests seed a couple of images to assert the coverage math.
"""
from __future__ import annotations


def _mk_image(client, sha: str, filepath: str, *, description: str | None = None) -> None:
    body: dict = {"sha256": sha, "filepath": filepath}
    if description is not None:
        body["description"] = description
    r = client.post("/images", json=body)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
def test_create_folder_applies_defaults(client):
    r = client.post("/folders", json={"path": "K:/comfy/output"})
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["path"] == "K:/comfy/output"
    # User-confirmed defaults: auto-scan on, recursive, 15-min interval.
    assert f["enabled"] is True
    assert f["recursive"] is True
    assert f["scan_interval_seconds"] == 900
    assert f["last_scan_at"] is None
    assert f["id"]


def test_create_folder_is_idempotent_on_path(client):
    a = client.post("/folders", json={"path": "K:/a", "label": "first"}).json()
    b = client.post(
        "/folders", json={"path": "K:/a", "label": "second", "scan_interval_seconds": 60}
    ).json()
    # Same row (UNIQUE path) updated rather than duplicated.
    assert a["id"] == b["id"]
    assert b["label"] == "second"
    assert b["scan_interval_seconds"] == 60
    assert len(client.get("/folders").json()) == 1


def test_list_and_get_folder(client):
    created = client.post("/folders", json={"path": "K:/b"}).json()
    listed = client.get("/folders").json()
    assert [f["id"] for f in listed] == [created["id"]]
    one = client.get(f"/folders/{created['id']}").json()
    assert one["path"] == "K:/b"


def test_get_unknown_folder_404(client):
    assert client.get("/folders/00000000-0000-0000-0000-000000000000").status_code == 404


def test_patch_folder_controls(client):
    fid = client.post("/folders", json={"path": "K:/c"}).json()["id"]
    r = client.patch(
        f"/folders/{fid}",
        json={"enabled": False, "recursive": False, "scan_interval_seconds": 30, "label": "x"},
    )
    assert r.status_code == 200
    f = r.json()
    assert f["enabled"] is False
    assert f["recursive"] is False
    assert f["scan_interval_seconds"] == 30
    assert f["label"] == "x"


def test_patch_records_scan_state_and_touch(client):
    fid = client.post("/folders", json={"path": "K:/d"}).json()["id"]
    r = client.patch(
        f"/folders/{fid}",
        json={
            "last_scan_status": "completed",
            "last_scan_job_id": "job-123",
            "last_error": "",
            "touch_last_scan_at": True,
        },
    )
    assert r.status_code == 200
    f = r.json()
    assert f["last_scan_status"] == "completed"
    assert f["last_scan_job_id"] == "job-123"
    # touch_last_scan_at stamps the catalog clock.
    assert f["last_scan_at"] is not None


def test_delete_folder(client):
    fid = client.post("/folders", json={"path": "K:/e"}).json()["id"]
    assert client.delete(f"/folders/{fid}").status_code == 200
    assert client.get(f"/folders/{fid}").status_code == 404
    assert client.delete(f"/folders/{fid}").status_code == 404


# ---------------------------------------------------------------------------
# Derived coverage + unlabeled set
# ---------------------------------------------------------------------------
def test_folder_derives_image_and_label_counts(client):
    a, b, c = ("a" * 64, "b" * 64, "c" * 64)
    # Two images under the folder (one labeled, one not), one outside it.
    _mk_image(client, a, "K:/lib/folderA/a.png", description="a knight")
    _mk_image(client, b, "K:/lib/folderA/sub/b.png")
    _mk_image(client, c, "K:/lib/other/c.png", description="elsewhere")

    fid = client.post("/folders", json={"path": "K:/lib/folderA"}).json()["id"]
    f = client.get(f"/folders/{fid}").json()
    assert f["image_count"] == 2
    assert f["labeled_count"] == 1
    assert f["unlabeled_count"] == 1


def test_folder_counts_separator_insensitive(client):
    sha = "d" * 64
    # Image stored with backslashes; folder registered with forward slashes.
    _mk_image(client, sha, "K:\\lib\\win\\a.png")
    fid = client.post("/folders", json={"path": "K:/lib/win"}).json()["id"]
    assert client.get(f"/folders/{fid}").json()["image_count"] == 1


def test_list_unlabeled(client):
    labeled, unlabeled = ("e" * 64, "f" * 64)
    _mk_image(client, labeled, "K:/lib/x/a.png", description="has one")
    _mk_image(client, unlabeled, "K:/lib/x/b.png")
    body = client.get("/images/unlabeled").json()
    assert body["sha256"] == [unlabeled]


def test_unlabeled_route_not_shadowed_by_sha_param(client):
    # "/images/unlabeled" must resolve to the literal route, not /images/{sha256}
    # (which would 422 the non-hex segment).
    r = client.get("/images/unlabeled")
    assert r.status_code == 200
    assert "sha256" in r.json()
