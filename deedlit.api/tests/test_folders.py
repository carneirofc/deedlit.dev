"""Tests for the deedlit.api source-folder proxy routes + "scan now".

Folder CRUD is a thin catalog proxy; "scan now" is the one composite route — it
resolves the folder path from catalog, then dispatches an ingest job. Outbound
HTTP is mocked via httpx.MockTransport (same Recorder pattern as
test_notes_collections) so the suite is offline; tests assert which downstream
base/path the gateway hits.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app as app_module
import clients

FID = "folder-1"


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.routes: dict[tuple[str, str], object] = {}

    def on(self, method: str, path: str, handler) -> None:
        self.routes[(method.upper(), path)] = handler

    async def handle(self, request: httpx.Request) -> httpx.Response:
        base = f"{request.url.scheme}://{request.url.host}:{request.url.port}"
        self.calls.append((base, request.method, request.url.path))
        handler = self.routes.get((request.method.upper(), request.url.path))
        if handler is None:
            return httpx.Response(404, json={"detail": f"no mock for {request.url.path}"})
        resp = handler(request)
        return resp if isinstance(resp, httpx.Response) else httpx.Response(200, json=resp)


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
# CRUD proxies -> catalog
# ---------------------------------------------------------------------------
def test_list_folders_proxies_to_catalog(rec, client):
    rec.on("GET", "/folders", lambda r: [{"id": FID, "path": "K:/a"}])
    r = client.get("/folders")
    assert r.status_code == 200
    assert r.json()[0]["id"] == FID
    assert _bases(rec) == {clients.CATALOG_URL}


def test_create_folder_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": FID, **seen["body"]}

    rec.on("POST", "/folders", handler)
    r = client.post("/folders", json={"path": "K:/a", "scan_interval_seconds": 60})
    assert r.status_code == 200
    assert seen["body"]["path"] == "K:/a"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_patch_folder_proxies_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": FID, "enabled": False}

    rec.on("PATCH", f"/folders/{FID}", handler)
    r = client.patch(f"/folders/{FID}", json={"enabled": False})
    assert r.status_code == 200
    assert seen["body"]["enabled"] is False
    assert _bases(rec) == {clients.CATALOG_URL}


def test_delete_folder_proxies_to_catalog(rec, client):
    rec.on("DELETE", f"/folders/{FID}", lambda r: {"status": "ok"})
    r = client.delete(f"/folders/{FID}")
    assert r.status_code == 200
    assert _bases(rec) == {clients.CATALOG_URL}


def test_read_folder_404_propagates(rec, client):
    rec.on("GET", f"/folders/{FID}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    assert client.get(f"/folders/{FID}").status_code == 404


# ---------------------------------------------------------------------------
# /images/unlabeled proxy
# ---------------------------------------------------------------------------
def test_unlabeled_proxies_to_catalog(rec, client):
    rec.on("GET", "/images/unlabeled", lambda r: {"sha256": ["a" * 64]})
    r = client.get("/images/unlabeled")
    assert r.status_code == 200
    assert r.json()["sha256"] == ["a" * 64]
    assert _bases(rec) == {clients.CATALOG_URL}


# ---------------------------------------------------------------------------
# Scan now — resolve path from catalog, dispatch ingest job
# ---------------------------------------------------------------------------
def test_scan_now_resolves_path_then_dispatches_ingest(rec, client):
    rec.on("GET", f"/folders/{FID}", lambda r: {"id": FID, "path": "K:/lib/a"})
    seen = {}

    def ingest_handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(202, json={"id": "job-9", "status": "queued"})

    rec.on("POST", "/ingest", ingest_handler)

    r = client.post(f"/folders/{FID}/scan")
    assert r.status_code == 202
    assert r.json()["id"] == "job-9"
    # Hit catalog (resolve path) THEN ingest (dispatch) with that path.
    assert seen["body"]["folderPath"] == "K:/lib/a"
    assert _bases(rec) == {clients.CATALOG_URL, clients.INGEST_URL}


def test_scan_now_unknown_folder_404(rec, client):
    rec.on("GET", f"/folders/{FID}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    assert client.post(f"/folders/{FID}/scan").status_code == 404
