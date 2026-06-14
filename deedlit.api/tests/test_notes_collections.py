"""Tests for the deedlit.api notes + collections proxy routes.

These routes are thin proxies to the catalog service (CATALOG_URL). Every
outbound HTTP call is mocked via ``httpx.MockTransport`` so the suite stays
offline; tests assert the gateway hits the *catalog* base URL on the expected
method/path and forwards/returns bodies unchanged. A catalog 404 surfaces as a
gateway 404; any other downstream failure surfaces as a 502.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app as app_module
import clients

SHA = "a" * 64
NOTE_ID = "note-1"
COL_ID = "col-1"


class Recorder:
    """Records outbound requests; tests script (METHOD, path) -> response."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.routes: dict[tuple[str, str], object] = {}

    def on(self, method: str, path: str, handler) -> None:
        self.routes[(method.upper(), path)] = handler

    async def handle(self, request: httpx.Request) -> httpx.Response:
        base = f"{request.url.scheme}://{request.url.host}:{request.url.port}"
        path = request.url.path
        self.calls.append((base, request.method, path))
        handler = self.routes.get((request.method.upper(), path))
        if handler is None:
            return httpx.Response(404, json={"detail": f"no mock for {path}"})
        resp = handler(request)
        if isinstance(resp, httpx.Response):
            return resp
        return httpx.Response(200, json=resp)


@pytest.fixture
def rec(monkeypatch):
    recorder = Recorder()
    transport = httpx.MockTransport(recorder.handle)
    monkeypatch.setattr(
        clients,
        "make_async_client",
        lambda **kw: httpx.AsyncClient(transport=transport, timeout=5.0),
    )
    return recorder


@pytest.fixture
def client(rec) -> TestClient:
    return TestClient(app_module.app)


def _bases(rec: Recorder) -> set[str]:
    return {b for (b, _m, _p) in rec.calls}


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------
def test_create_note_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": NOTE_ID, **seen["body"]}

    rec.on("POST", "/notes", handler)

    payload = {
        "title": "study",
        "positive": "knight, castle",
        "negative": "blurry",
        "blocks": {"time": 1, "blocks": [], "version": "2.0"},
        "imageRefs": [SHA],
    }
    r = client.post("/notes", json=payload)
    assert r.status_code == 200
    assert r.json()["id"] == NOTE_ID
    assert _bases(rec) == {clients.CATALOG_URL}
    assert seen["body"]["imageRefs"] == [SHA]


def test_read_note_proxies_to_catalog(rec, client):
    rec.on("GET", f"/notes/{NOTE_ID}", lambda r: {"id": NOTE_ID, "blocks": {}, "imageRefs": []})
    r = client.get(f"/notes/{NOTE_ID}")
    assert r.status_code == 200
    assert r.json()["id"] == NOTE_ID
    assert _bases(rec) == {clients.CATALOG_URL}


def test_read_note_404_propagates(rec, client):
    rec.on("GET", f"/notes/{NOTE_ID}", lambda r: httpx.Response(404, json={"detail": "note not found"}))
    r = client.get(f"/notes/{NOTE_ID}")
    assert r.status_code == 404


def test_update_note_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": NOTE_ID, **seen["body"]}

    rec.on("PUT", f"/notes/{NOTE_ID}", handler)
    payload = {"blocks": {"blocks": []}, "imageRefs": [SHA], "positive": "x"}
    r = client.put(f"/notes/{NOTE_ID}", json=payload)
    assert r.status_code == 200
    assert seen["body"]["positive"] == "x"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_export_note_proxies_to_catalog(rec, client):
    rec.on("GET", f"/notes/{NOTE_ID}/export", lambda r: {"id": NOTE_ID, "blocks": {}, "imageRefs": []})
    r = client.get(f"/notes/{NOTE_ID}/export")
    assert r.status_code == 200
    assert r.json()["id"] == NOTE_ID
    assert _bases(rec) == {clients.CATALOG_URL}
    assert any(p == f"/notes/{NOTE_ID}/export" for (_b, _m, p) in rec.calls)


def test_notes_by_image_proxies_to_catalog(rec, client):
    rec.on("GET", f"/notes/by-image/{SHA}", lambda r: [{"id": NOTE_ID, "blocks": {}, "imageRefs": [SHA]}])
    r = client.get(f"/notes/by-image/{SHA}")
    assert r.status_code == 200
    assert r.json()[0]["id"] == NOTE_ID
    assert _bases(rec) == {clients.CATALOG_URL}


def test_note_downstream_500_is_502(rec, client):
    rec.on("GET", f"/notes/{NOTE_ID}", lambda r: httpx.Response(500, json={"detail": "boom"}))
    r = client.get(f"/notes/{NOTE_ID}")
    assert r.status_code == 502


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------
def test_create_collection_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": COL_ID, **seen["body"]}

    rec.on("POST", "/collections", handler)
    r = client.post("/collections", json={"name": "faves", "images": [SHA]})
    assert r.status_code == 200
    assert r.json()["id"] == COL_ID
    assert seen["body"]["name"] == "faves"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_list_collections_proxies_to_catalog(rec, client):
    rec.on("GET", "/collections", lambda r: [{"id": COL_ID, "name": "faves", "images": []}])
    r = client.get("/collections")
    assert r.status_code == 200
    assert r.json()[0]["id"] == COL_ID
    assert _bases(rec) == {clients.CATALOG_URL}


def test_read_collection_proxies_to_catalog(rec, client):
    rec.on("GET", f"/collections/{COL_ID}", lambda r: {"id": COL_ID, "name": "faves", "images": [SHA]})
    r = client.get(f"/collections/{COL_ID}")
    assert r.status_code == 200
    assert r.json()["images"] == [SHA]


def test_read_collection_404(rec, client):
    rec.on("GET", f"/collections/{COL_ID}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    r = client.get(f"/collections/{COL_ID}")
    assert r.status_code == 404


def test_rename_collection_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": COL_ID, "name": seen["body"]["name"], "images": []}

    rec.on("PUT", f"/collections/{COL_ID}", handler)
    r = client.put(f"/collections/{COL_ID}", json={"name": "renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"
    assert seen["body"]["name"] == "renamed"


def test_delete_collection_proxies_to_catalog(rec, client):
    rec.on("DELETE", f"/collections/{COL_ID}", lambda r: {"status": "ok"})
    r = client.delete(f"/collections/{COL_ID}")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_set_collection_images_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"status": "ok"}

    rec.on("PUT", f"/collections/{COL_ID}/images", handler)
    r = client.put(f"/collections/{COL_ID}/images", json={"images": [SHA, "b" * 64]})
    assert r.status_code == 200
    assert seen["body"]["images"] == [SHA, "b" * 64]
    assert _bases(rec) == {clients.CATALOG_URL}


def test_set_collection_images_404(rec, client):
    rec.on("PUT", f"/collections/{COL_ID}/images", lambda r: httpx.Response(404, json={"detail": "nope"}))
    r = client.put(f"/collections/{COL_ID}/images", json={"images": [SHA]})
    assert r.status_code == 404


def test_collections_by_image_proxies_to_catalog(rec, client):
    rec.on("GET", f"/collections/by-image/{SHA}", lambda r: [{"id": COL_ID, "name": "faves", "images": [SHA]}])
    r = client.get(f"/collections/by-image/{SHA}")
    assert r.status_code == 200
    assert r.json()[0]["id"] == COL_ID
    assert _bases(rec) == {clients.CATALOG_URL}
