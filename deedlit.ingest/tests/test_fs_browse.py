"""Tests for GET /fs/browse — the admin directory picker's listing endpoint."""
import os

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_roots_view_when_path_omitted():
    r = client.get("/fs/browse")
    assert r.status_code == 200
    body = r.json()
    # Synthetic roots view: no concrete path, but quick-access roots present.
    assert body["path"] is None
    assert body["parent"] is None
    assert body["separator"] == os.sep
    assert len(body["roots"]) >= 1
    # Roots are mirrored as directory entries so the picker can render them.
    assert all(e["isDirectory"] for e in body["entries"])


def test_lists_a_real_directory(tmp_path):
    (tmp_path / "beta").mkdir()
    (tmp_path / "alpha").mkdir()
    (tmp_path / "note.txt").write_text("hi")

    r = client.get("/fs/browse", params={"path": str(tmp_path)})
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == os.path.abspath(str(tmp_path))
    assert body["parent"] == os.path.dirname(os.path.abspath(str(tmp_path)))

    names = [e["name"] for e in body["entries"]]
    # Directories first (alphabetical), then files.
    assert names == ["alpha", "beta", "note.txt"]
    by_name = {e["name"]: e for e in body["entries"]}
    assert by_name["alpha"]["isDirectory"] is True
    assert by_name["note.txt"]["isDirectory"] is False


def test_missing_path_is_400(tmp_path):
    missing = str(tmp_path / "does-not-exist")
    r = client.get("/fs/browse", params={"path": missing})
    assert r.status_code == 400
    assert "not found" in r.json()["detail"].lower()


def test_file_path_is_400(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x")
    r = client.get("/fs/browse", params={"path": str(f)})
    assert r.status_code == 400
