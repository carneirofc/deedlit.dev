"""Tests for the deedlit.api BFF gateway.

The gateway holds NO database; every endpoint is an HTTP fan-out/proxy to a
downstream service (catalog/search/graph/ingest). All outbound HTTP is mocked
via ``httpx.MockTransport`` so the suite is deterministic and offline.

The downstream boundary lives in ``clients.py`` as a single ``request()``
coroutine that every route/MCP tool funnels through; tests install a recording
mock transport so they can assert *which* downstream was hit, *that* the detail
fan-out is parallel, and *how* the gateway degrades when one downstream fails.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app as app_module
import clients

SHA = "a" * 64


# ---------------------------------------------------------------------------
# Mock transport plumbing
# ---------------------------------------------------------------------------
class Recorder:
    """Records every outbound request and lets a test script the responses.

    ``routes`` maps ``(METHOD, path)`` -> handler(request) -> httpx.Response.
    ``calls`` is the ordered list of (base_url, method, path) tuples seen.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.routes: dict[tuple[str, str], object] = {}
        # Per-service hooks for ordering/concurrency assertions.
        self.barrier: asyncio.Event | None = None
        self.inflight = 0
        self.max_inflight = 0

    def on(self, method: str, path: str, handler) -> None:
        self.routes[(method.upper(), path)] = handler

    async def handle(self, request: httpx.Request) -> httpx.Response:
        base = f"{request.url.scheme}://{request.url.host}:{request.url.port}"
        path = request.url.path
        self.calls.append((base, request.method, path))

        # Concurrency tracking (used to prove the detail fan-out is parallel).
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            if self.barrier is not None:
                # Let all three detail calls pile up before any returns.
                await asyncio.sleep(0.05)
            handler = self.routes.get((request.method.upper(), path))
            if handler is None:
                return httpx.Response(404, json={"detail": f"no mock for {path}"})
            resp = handler(request)
            if isinstance(resp, httpx.Response):
                return resp
            return httpx.Response(200, json=resp)
        finally:
            self.inflight -= 1


@pytest.fixture
def rec(monkeypatch):
    """Install a recording MockTransport as the gateway's AsyncClient factory."""
    recorder = Recorder()
    transport = httpx.MockTransport(recorder.handle)

    def make_client(**kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, timeout=5.0)

    monkeypatch.setattr(clients, "make_async_client", make_client)
    return recorder


@pytest.fixture
def client(rec) -> TestClient:
    return TestClient(app_module.app)


def _bases(rec: Recorder) -> set[str]:
    return {b for (b, _m, _p) in rec.calls}


# ---------------------------------------------------------------------------
# (1) GET /detail/{sha256} fans out to all three and merges
# ---------------------------------------------------------------------------
def test_detail_fans_out_and_merges(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: {"sha256": SHA, "prompt": "knight"})
    rec.on("POST", "/similar", lambda r: {"hits": [{"sha256": "b" * 64, "score": 0.9}]})
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": [{"sha256": "c" * 64, "relation": "tag_cooccurrence"}]})

    r = client.get(f"/detail/{SHA}")
    assert r.status_code == 200
    body = r.json()
    assert body["image"] == {"sha256": SHA, "prompt": "knight"}
    assert body["similar"] == [{"sha256": "b" * 64, "score": 0.9}]
    assert body["neighbors"] == [{"sha256": "c" * 64, "relation": "tag_cooccurrence"}]

    # Hit all three downstream services.
    assert any(p == f"/images/{SHA}" for (_b, _m, p) in rec.calls)
    assert any(p == "/similar" for (_b, _m, p) in rec.calls)
    assert any(p == f"/neighbors/{SHA}" for (_b, _m, p) in rec.calls)
    assert len(_bases(rec)) == 3


# ---------------------------------------------------------------------------
# (2) the detail fan-out is parallel
# ---------------------------------------------------------------------------
def test_detail_fan_out_is_parallel(rec, client):
    rec.barrier = asyncio.Event()
    rec.on("GET", f"/images/{SHA}", lambda r: {"sha256": SHA})
    rec.on("POST", "/similar", lambda r: {"hits": []})
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": []})

    r = client.get(f"/detail/{SHA}")
    assert r.status_code == 200
    # If the three downstream calls ran serially, max_inflight would be 1.
    assert rec.max_inflight == 3


# ---------------------------------------------------------------------------
# (3) detail degrades gracefully when one downstream fails
# ---------------------------------------------------------------------------
def test_detail_degrades_on_single_failure(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: {"sha256": SHA, "prompt": "knight"})
    rec.on("POST", "/similar", lambda r: httpx.Response(500, json={"detail": "boom"}))
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": [{"sha256": "c" * 64, "relation": "x"}]})

    r = client.get(f"/detail/{SHA}")
    assert r.status_code == 200
    body = r.json()
    # catalog (required) + graph succeeded; search degraded to empty list.
    assert body["image"] == {"sha256": SHA, "prompt": "knight"}
    assert body["similar"] == []
    assert body["neighbors"] == [{"sha256": "c" * 64, "relation": "x"}]


def test_detail_404_when_catalog_missing(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    rec.on("POST", "/similar", lambda r: {"hits": []})
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": []})

    r = client.get(f"/detail/{SHA}")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# (4) POST /search proxies to deedlit.search
# ---------------------------------------------------------------------------
def test_search_proxies_to_search(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"hits": [{"sha256": "d" * 64, "score": 0.5}], "fusion": "rrf"}

    rec.on("POST", "/query", handler)

    r = client.post("/search", json={"query": "a knight", "limit": 10})
    assert r.status_code == 200
    assert r.json()["hits"][0]["sha256"] == "d" * 64
    # Proxied to the search service only.
    assert _bases(rec) == {clients.SEARCH_URL}
    assert seen["body"]["limit"] == 10


# ---------------------------------------------------------------------------
# (5) GET /stats aggregates counts across services
# ---------------------------------------------------------------------------
def test_stats_aggregates(rec, client):
    rec.on("GET", "/stats", lambda r: {"images": 42, "tags": 7, "collections": 3, "notes": 5})

    r = client.get("/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["images"] == 42
    assert body["tags"] == 7
    assert body["collections"] == 3
    assert body["notes"] == 5


def test_stats_degrades_when_catalog_down(rec, client):
    rec.on("GET", "/stats", lambda r: httpx.Response(503, json={"detail": "down"}))
    r = client.get("/stats")
    assert r.status_code == 200
    # No data, but a stable shape with images present (required field).
    assert r.json()["images"] == 0


# ---------------------------------------------------------------------------
# (6) POST /jobs dispatches to ingest; GET /jobs proxies status
# ---------------------------------------------------------------------------
def test_jobs_post_dispatches_to_ingest(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(202, json={"id": "job1", "type": "rebuild-search", "status": "queued"})

    rec.on("POST", "/jobs", handler)

    r = client.post("/jobs", json={"type": "rebuild-search"})
    assert r.status_code == 202
    assert r.json()["id"] == "job1"
    assert _bases(rec) == {clients.INGEST_URL}
    assert seen["body"]["type"] == "rebuild-search"


def test_jobs_get_proxies_list(rec, client):
    rec.on("GET", "/jobs", lambda r: [{"id": "job1", "type": "ingest", "status": "running"}])
    r = client.get("/jobs")
    assert r.status_code == 200
    assert r.json()[0]["id"] == "job1"
    assert _bases(rec) == {clients.INGEST_URL}


def test_jobs_get_degrades_to_empty_when_ingest_down(rec, client):
    rec.on("GET", "/jobs", lambda r: httpx.Response(500))
    r = client.get("/jobs")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# (7) POST /mcp — tools/list and tools/call dispatch
# ---------------------------------------------------------------------------
def test_mcp_initialize(rec, client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert r.status_code == 200
    body = r.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == 1
    assert "serverInfo" in body["result"]


def test_mcp_tools_list(rec, client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert r.status_code == 200
    tools = r.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    # The ported tool surface must include the core dispatch tools.
    assert {"search_images", "find_similar_images", "get_image_details", "get_image_graph", "ingest_folder"} <= names
    for t in tools:
        assert "inputSchema" in t and "description" in t


def test_mcp_tools_call_search_dispatches_to_search(rec, client):
    rec.on("POST", "/query", lambda r: {"hits": [{"sha256": "e" * 64, "score": 0.3}], "fusion": "rrf"})
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "search_images", "arguments": {"query": "cat", "limit": 5}},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["isError"] is False
    assert _bases(rec) == {clients.SEARCH_URL}
    assert body["result"]["structuredContent"]["results"][0]["sha256"] == "e" * 64


def test_mcp_tools_call_details_dispatches_to_catalog(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: {"sha256": SHA, "prompt": "knight"})
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {"name": "get_image_details", "arguments": {"image_id": SHA}},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["isError"] is False
    assert _bases(rec) == {clients.CATALOG_URL}
    assert body["result"]["structuredContent"]["sha256"] == SHA


def test_mcp_tools_call_graph_dispatches_to_graph(rec, client):
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": [{"sha256": "f" * 64, "relation": "x"}]})
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 5, "method": "tools/call",
        "params": {"name": "get_image_graph", "arguments": {"image_id": SHA}},
    })
    assert r.status_code == 200
    assert _bases(rec) == {clients.GRAPH_URL}


def test_mcp_tools_call_ingest_enqueues_job(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(202, json={"id": "job9", "type": "ingest", "status": "queued"})

    rec.on("POST", "/ingest", handler)

    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 6, "method": "tools/call",
        "params": {"name": "ingest_folder", "arguments": {"folder_path": "/data/pics"}},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["isError"] is False
    assert _bases(rec) == {clients.INGEST_URL}
    assert seen["body"]["folderPath"] == "/data/pics"
    assert body["result"]["structuredContent"]["job_id"] == "job9"


def test_mcp_unknown_tool_is_error(rec, client):
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 7, "method": "tools/call",
        "params": {"name": "does_not_exist", "arguments": {}},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["error"]["code"] == -32602


def test_mcp_unknown_method(rec, client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 8, "method": "bogus/method"})
    assert r.json()["error"]["code"] == -32601


def test_mcp_tool_call_downstream_failure_is_tool_error(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 9, "method": "tools/call",
        "params": {"name": "get_image_details", "arguments": {"image_id": SHA}},
    })
    assert r.status_code == 200
    body = r.json()
    # JSON-RPC envelope is still ok; the tool result carries isError=True.
    assert "error" not in body or body.get("error") is None
    assert body["result"]["isError"] is True


# ---------------------------------------------------------------------------
# (8) GET /health reports per-service health (HealthDashboard)
# ---------------------------------------------------------------------------
def test_health_dashboard_all_ok(rec, client):
    for path in ("/health",):
        rec.on("GET", path, lambda r: {"status": "ok"})

    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    names = {s["name"] for s in body["services"]}
    assert names == {"catalog", "search", "graph", "ingest"}
    assert all(s["status"] == "ok" for s in body["services"])


def test_health_dashboard_degraded_when_one_down(rec, client):
    def health(request: httpx.Request):
        # graph service down
        if request.url.host == httpx.URL(clients.GRAPH_URL).host and request.url.port == httpx.URL(clients.GRAPH_URL).port:
            return httpx.Response(500)
        return httpx.Response(200, json={"status": "ok"})

    rec.on("GET", "/health", health)

    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    statuses = {s["name"]: s["status"] for s in body["services"]}
    assert statuses["graph"] == "down"
    assert statuses["catalog"] == "ok"
