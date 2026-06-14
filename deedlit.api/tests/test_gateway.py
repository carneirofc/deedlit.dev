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
import base64
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
def test_search_encodes_text_then_queries(rec, client):
    seen = {}

    def query_handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"hits": [{"sha256": "d" * 64, "score": 0.5}], "fusion": "rrf"}

    # search is a pure vector store: the gateway must encode the text via vision
    # (dense + sparse) before it can query search.
    rec.on("POST", "/embed/text", lambda r: {"embedding": [0.1, 0.2, 0.3]})
    rec.on("POST", "/embed/sparse", lambda r: {"indices": [1, 2], "values": [0.5, 0.7]})
    rec.on("POST", "/query", query_handler)

    r = client.post("/search", json={"query": "a knight", "limit": 10})
    assert r.status_code == 200
    assert r.json()["hits"][0]["sha256"] == "d" * 64
    # Text was encoded via vision, then the resulting vectors queried search.
    assert _bases(rec) == {clients.VISION_URL, clients.SEARCH_URL}
    assert seen["body"]["limit"] == 10
    assert seen["body"]["dense"] == [0.1, 0.2, 0.3]
    assert seen["body"]["sparse"] == {"indices": [1, 2], "values": [0.5, 0.7]}
    # No raw `query` string reaches the vector store.
    assert "query" not in seen["body"]


def test_search_translates_facets_to_qdrant_filter(rec, client):
    # The UI sends a flat camelCase facet object; on the vector path the gateway
    # must translate the payload-backed facets (tags/excludeTags/safety) into a
    # valid Qdrant filter, NOT pass the raw facets (which Qdrant's Filter rejects).
    seen = {}

    def query_handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"hits": [], "fusion": "rrf"}

    rec.on("POST", "/embed/text", lambda r: {"embedding": [0.1, 0.2, 0.3]})
    rec.on("POST", "/embed/sparse", lambda r: {"indices": [1], "values": [0.5]})
    rec.on("POST", "/query", query_handler)

    r = client.post("/search", json={
        "query": "a knight",
        "limit": 10,
        "filter": {
            "tags": ["knight"],
            "excludeTags": ["blurry"],
            "safety": ["sfw", "nsfw"],
            "modelFamily": "sdxl",  # catalog-only facet -> dropped on the vector path
        },
    })
    assert r.status_code == 200
    qfilter = seen["body"]["filter"]
    assert qfilter["must"] == [
        {"key": "tags", "match": {"any": ["knight"]}},
        {"key": "safety", "match": {"any": ["sfw", "nsfw"]}},
    ]
    assert qfilter["must_not"] == [{"key": "tags", "match": {"any": ["blurry"]}}]


def test_search_empty_query_browses_catalog_without_calling_search(rec, client):
    # An empty query has no vector to search by, so the gateway must NOT dispatch
    # a vectorless query (search would 422). Instead it browses the catalog — the
    # source of truth — so the default no-query gallery shows the library.
    rows = [
        {"sha256": "a" * 64, "prompt": "a knight", "tags": ["knight"]},
        {"sha256": "b" * 64, "prompt": None, "tags": []},
    ]
    seen = {}

    def images_handler(request: httpx.Request):
        seen["url"] = str(request.url)
        return rows

    rec.on("GET", "/images", images_handler)

    r = client.post("/search", json={"query": "   ", "limit": 10})
    assert r.status_code == 200
    body = r.json()
    assert body["fusion"] == "browse"
    assert [h["sha256"] for h in body["hits"]] == ["a" * 64, "b" * 64]
    # The whole catalog record rides along as the hit payload (no second fetch).
    assert body["hits"][0]["payload"]["prompt"] == "a knight"
    # Only catalog was touched — vision/search stay out of the browse path.
    assert _bases(rec) == {clients.CATALOG_URL}
    assert "limit=10" in seen["url"]


def test_browse_threads_safety_into_catalog_params(rec, client):
    # No-query browse with a content-safety filter threads it into catalog
    # GET /images as repeated ?safety= params (catalog lists by the set).
    seen = {}

    def images_handler(request: httpx.Request):
        seen["safety"] = request.url.params.get_list("safety")
        return []

    rec.on("GET", "/images", images_handler)

    r = client.post("/search", json={"query": "", "limit": 10, "filter": {"safety": ["sfw", "nsfw"]}})
    assert r.status_code == 200
    assert _bases(rec) == {clients.CATALOG_URL}
    assert seen["safety"] == ["sfw", "nsfw"]


# ---------------------------------------------------------------------------
# (4b) DELETE /images/{sha256} un-indexes across the stores
# ---------------------------------------------------------------------------
def test_delete_image_fans_out_catalog_first_then_projections(rec, client):
    # catalog + graph both live at DELETE /images/{sha}; search at /points/{sha}.
    rec.on("DELETE", f"/images/{SHA}", lambda r: {"status": "ok", "deleted": 1})
    rec.on("DELETE", f"/points/{SHA}", lambda r: {"status": "ok"})

    r = client.delete(f"/images/{SHA}")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ok",
        "sha256": SHA,
        "catalog": True,
        "search": True,
        "graph": True,
    }
    # All three owning services were hit.
    assert _bases(rec) == {clients.CATALOG_URL, clients.SEARCH_URL, clients.GRAPH_URL}
    # Catalog (the source of truth) is deleted FIRST, before the projections.
    assert rec.calls[0][0] == clients.CATALOG_URL


def test_delete_image_404_when_catalog_missing_leaves_projections(rec, client):
    rec.on("DELETE", f"/images/{SHA}", lambda r: httpx.Response(404, json={"detail": "nope"}))
    rec.on("DELETE", f"/points/{SHA}", lambda r: {"status": "ok"})

    r = client.delete(f"/images/{SHA}")
    assert r.status_code == 404
    # A failed truth-delete must NOT touch the derived projections.
    assert _bases(rec) == {clients.CATALOG_URL}


def test_delete_image_reports_projection_failure_but_succeeds(rec, client):
    rec.on("DELETE", f"/images/{SHA}", lambda r: {"status": "ok", "deleted": 1})
    rec.on("DELETE", f"/points/{SHA}", lambda r: httpx.Response(500, json={"detail": "boom"}))

    r = client.delete(f"/images/{SHA}")
    # Catalog (truth) is gone, so the delete succeeds; the search projection
    # failure is reported in the body rather than failing the whole request.
    assert r.status_code == 200
    body = r.json()
    assert body["catalog"] is True
    assert body["search"] is False
    assert body["graph"] is True


def test_delete_image_502_when_catalog_errors(rec, client):
    rec.on("DELETE", f"/images/{SHA}", lambda r: httpx.Response(500, json={"detail": "db down"}))
    r = client.delete(f"/images/{SHA}")
    assert r.status_code == 502
    assert _bases(rec) == {clients.CATALOG_URL}


def test_blob_proxy_streams_catalog_bytes(rec, client):
    # comfyhelper is UI-only and holds no object store, so the gateway proxies
    # raw image bytes from the catalog (the blob owner).
    png = b"\x89PNG\r\n\x1a\nFAKEWEBP"
    rec.on(
        "GET",
        f"/blobs/{SHA}/thumbnail",
        lambda r: httpx.Response(200, content=png, headers={"content-type": "image/webp"}),
    )
    r = client.get(f"/blobs/{SHA}/thumbnail")
    assert r.status_code == 200
    assert r.content == png
    assert r.headers["content-type"] == "image/webp"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_blob_proxy_404_passes_through(rec, client):
    rec.on(
        "GET",
        f"/blobs/{SHA}/thumbnail",
        lambda r: httpx.Response(404, json={"detail": "blob not found"}),
    )
    r = client.get(f"/blobs/{SHA}/thumbnail")
    assert r.status_code == 404


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
# (5b) GET /tasks — async queue ledger proxy to catalog (#27)
# ---------------------------------------------------------------------------
def test_tasks_get_proxies_list_to_catalog(rec, client):
    rec.on("GET", "/tasks", lambda r: [{"id": "t1", "sha256": SHA, "type": "index", "status": "dlq"}])
    r = client.get("/tasks", params={"status": "dlq"})
    assert r.status_code == 200
    assert r.json()[0]["id"] == "t1"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_tasks_get_degrades_to_empty_when_catalog_down(rec, client):
    rec.on("GET", "/tasks", lambda r: httpx.Response(503))
    r = client.get("/tasks")
    assert r.status_code == 200
    assert r.json() == []


def test_task_by_id_proxies_and_passes_404(rec, client):
    rec.on("GET", "/tasks/t1", lambda r: {"id": "t1", "sha256": SHA, "type": "label", "status": "done"})
    assert client.get("/tasks/t1").json()["status"] == "done"

    rec.on("GET", "/tasks/missing", lambda r: httpx.Response(404, json={"detail": "task not found"}))
    assert client.get("/tasks/missing").status_code == 404


# ---------------------------------------------------------------------------
# (5c) /queues — RabbitMQ management proxy for the queue visualization (#29)
#
# httpx decodes the %2F vhost in .path to ///, so the recorder matches paths like
# /api/queues///index (the wire request still sends %2F to RabbitMQ).
# ---------------------------------------------------------------------------
_QUEUE_NAMES = ["index", "index.retry", "index.dlq", "label", "label.retry", "label.dlq"]


def test_queues_lists_task_queue_stats(rec, client):
    for name in _QUEUE_NAMES:
        rec.on(
            "GET", f"/api/queues///{name}",
            lambda r: {
                "messages": 3, "messages_ready": 3, "messages_unacknowledged": 0,
                "consumers": 1,
                "message_stats": {
                    "publish_details": {"rate": 1.5},
                    "deliver_get_details": {"rate": 0.5},
                },
            },
        )
    body = client.get("/queues").json()
    qs = body["queues"]
    assert len(qs) == 6
    idx = next(x for x in qs if x["name"] == "index")
    assert idx["reachable"] is True
    assert idx["messages"] == 3 and idx["consumers"] == 1
    assert idx["publish_rate"] == 1.5 and idx["deliver_rate"] == 0.5


def test_queues_degrades_unreachable_rows(rec, client):
    rec.on("GET", "/api/queues///index", lambda r: {"messages": 5, "consumers": 2})
    # The other queues have no mock -> 404 -> idle/unreachable rows.
    qs = client.get("/queues").json()["queues"]
    idx = next(x for x in qs if x["name"] == "index")
    assert idx["reachable"] is True and idx["messages"] == 5
    dlq = next(x for x in qs if x["name"] == "index.dlq")
    assert dlq["reachable"] is False and dlq["messages"] == 0


def test_peek_queue_messages(rec, client):
    rec.on(
        "POST", "/api/queues///index.dlq/get",
        lambda r: [
            {"payload": '{"sha256":"x"}', "properties": {"headers": {"x-attempt": 3, "x-error": "boom"}}}
        ],
    )
    body = client.get("/queues/index.dlq/messages", params={"limit": 5}).json()
    msg = body["messages"][0]
    assert msg["payload"] == '{"sha256":"x"}'
    assert msg["headers"]["x-error"] == "boom"


def test_purge_queue_calls_mgmt_contents(rec, client):
    rec.on("DELETE", "/api/queues///index.dlq/contents", lambda r: httpx.Response(204))
    r = client.post("/queues/index.dlq/purge")
    assert r.status_code == 200 and r.json()["status"] == "purged"
    assert any(p == "/api/queues///index.dlq/contents" for (_b, _m, p) in rec.calls)


def test_purge_unknown_queue_is_404(rec, client):
    assert client.post("/queues/bogus/purge").status_code == 404


def test_requeue_dlq_drains_and_republishes_to_main(rec, client):
    msgs = [
        {"payload": '{"sha256":"x"}', "payload_encoding": "string"},
        {"payload": '{"sha256":"y"}', "payload_encoding": "string"},
    ]
    rec.on("POST", "/api/queues///label.dlq/get", lambda r: msgs)
    rec.on("POST", "/api/exchanges///amq.default/publish", lambda r: {"routed": True})

    r = client.post("/dlq/label/requeue")
    assert r.status_code == 200
    assert r.json() == {"status": "requeued", "queue": "label", "count": 2}
    publishes = [p for (_b, _m, p) in rec.calls if p == "/api/exchanges///amq.default/publish"]
    assert len(publishes) == 2


def test_requeue_unknown_base_is_404(rec, client):
    assert client.post("/dlq/bogus/requeue").status_code == 404


# ---------------------------------------------------------------------------
# (5d) /images admin — DB power-user page (#30)
# ---------------------------------------------------------------------------
def test_images_list_proxies_to_catalog(rec, client):
    rec.on("GET", "/images", lambda r: [{"sha256": SHA, "prompt": "p"}])
    r = client.get("/images", params={"tag": "x", "limit": 10})
    assert r.status_code == 200
    assert r.json()[0]["sha256"] == SHA
    assert _bases(rec) == {clients.CATALOG_URL}


def test_images_list_degrades_to_empty_when_catalog_down(rec, client):
    rec.on("GET", "/images", lambda r: httpx.Response(500))
    assert client.get("/images").json() == []


def test_patch_image_proxies_and_passes_404(rec, client):
    rec.on("PATCH", f"/images/{SHA}", lambda r: {"sha256": SHA, "safety": "nsfw"})
    r = client.patch(f"/images/{SHA}", json={"safety": "nsfw"})
    assert r.status_code == 200 and r.json()["safety"] == "nsfw"

    rec.on("PATCH", f"/images/{'c' * 64}", lambda r: httpx.Response(404, json={"detail": "x"}))
    assert client.patch(f"/images/{'c' * 64}", json={"safety": "sfw"}).status_code == 404


def test_reindex_dispatches_index_task_to_ingest(rec, client):
    rec.on("POST", "/tasks/index", lambda r: {"status": "queued", "sha256": SHA, "type": "index"})
    r = client.post(f"/images/{SHA}/reindex")
    assert r.status_code == 202 and r.json()["type"] == "index"
    assert _bases(rec) == {clients.INGEST_URL}


def test_relabel_dispatches_label_task_to_ingest(rec, client):
    rec.on("POST", "/tasks/label", lambda r: {"status": "queued", "sha256": SHA, "type": "label"})
    r = client.post(f"/images/{SHA}/relabel")
    assert r.status_code == 202 and r.json()["type"] == "label"
    assert _bases(rec) == {clients.INGEST_URL}


# ---------------------------------------------------------------------------
# (6b) GET /fs/browse proxies the folder picker listing to ingest
# ---------------------------------------------------------------------------
def test_fs_browse_proxies_to_ingest_with_path(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["path"] = request.url.params.get("path")
        return {"path": "/data/pics", "parent": "/data", "separator": "/", "entries": [], "roots": []}

    rec.on("GET", "/fs/browse", handler)

    r = client.get("/fs/browse", params={"path": "/data/pics"})
    assert r.status_code == 200
    assert r.json()["path"] == "/data/pics"
    assert _bases(rec) == {clients.INGEST_URL}
    assert seen["path"] == "/data/pics"


def test_fs_browse_roots_view_omits_path(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["path"] = request.url.params.get("path")
        return {"path": None, "parent": None, "separator": "/", "entries": [], "roots": [{"label": "/", "path": "/"}]}

    rec.on("GET", "/fs/browse", handler)

    r = client.get("/fs/browse")
    assert r.status_code == 200
    assert r.json()["path"] is None
    # No path param forwarded for the roots view.
    assert seen["path"] is None


def test_fs_browse_passes_through_400(rec, client):
    rec.on("GET", "/fs/browse", lambda r: httpx.Response(400, json={"detail": "Folder not found: /nope"}))
    r = client.get("/fs/browse", params={"path": "/nope"})
    # User-correctable filesystem error stays a 400 the picker shows inline.
    assert r.status_code == 400
    assert "not found" in r.json()["detail"].lower()


def test_fs_browse_502_when_ingest_down(rec, client):
    rec.on("GET", "/fs/browse", lambda r: httpx.Response(500))
    r = client.get("/fs/browse", params={"path": "/data"})
    assert r.status_code == 502


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
    # search_images encodes the text via vision, then queries search (same hop
    # as the REST /search route).
    rec.on("POST", "/embed/text", lambda r: {"embedding": [0.1, 0.2, 0.3]})
    rec.on("POST", "/embed/sparse", lambda r: {"indices": [1], "values": [0.5]})
    rec.on("POST", "/query", lambda r: {"hits": [{"sha256": "e" * 64, "score": 0.3}], "fusion": "rrf"})
    r = client.post("/mcp", json={
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "search_images", "arguments": {"query": "cat", "limit": 5}},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["isError"] is False
    assert _bases(rec) == {clients.VISION_URL, clients.SEARCH_URL}
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
# (7b) Expanded MCP surface — retrieval, library info, agent tasks
# ---------------------------------------------------------------------------
def _call(client, name, arguments, rpc_id=100):
    return client.post("/mcp", json={
        "jsonrpc": "2.0", "id": rpc_id, "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    })


def test_mcp_tools_list_advertises_expanded_surface(rec, client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = {t["name"] for t in r.json()["result"]["tools"]}
    # Retrieval + library info + agent tasks are all exposed.
    assert {
        "get_image", "get_image_detail", "get_library_stats",
        "list_collections", "get_image_collections", "create_collection",
        "set_collection_images", "list_image_notes",
        "list_jobs", "browse_folders", "delete_image",
    } <= names


def test_mcp_get_image_returns_image_content_block(rec, client):
    # Image retrieval: the tool streams the thumbnail bytes from catalog and
    # emits them as a base64 MCP `image` content block (not JSON text).
    png = b"\x89PNG\r\n\x1a\nFAKEWEBP"
    rec.on(
        "GET", f"/blobs/{SHA}/thumbnail",
        lambda r: httpx.Response(200, content=png, headers={"content-type": "image/webp"}),
    )
    r = _call(client, "get_image", {"image_id": SHA})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is False
    block = result["content"][0]
    assert block["type"] == "image"
    assert block["mimeType"] == "image/webp"
    assert base64.b64decode(block["data"]) == png
    assert result["structuredContent"]["bytes"] == len(png)
    assert _bases(rec) == {clients.CATALOG_URL}


def test_mcp_get_image_detail_fans_out(rec, client):
    rec.on("GET", f"/images/{SHA}", lambda r: {"sha256": SHA, "prompt": "knight"})
    rec.on("POST", "/similar", lambda r: {"hits": [{"sha256": "b" * 64, "score": 0.9}]})
    rec.on("GET", f"/neighbors/{SHA}", lambda r: {"neighbors": [{"sha256": "c" * 64}]})

    r = _call(client, "get_image_detail", {"image_id": SHA})
    assert r.status_code == 200
    sc = r.json()["result"]["structuredContent"]
    assert sc["image"]["prompt"] == "knight"
    assert sc["similar"][0]["sha256"] == "b" * 64
    assert sc["neighbors"][0]["sha256"] == "c" * 64
    assert _bases(rec) == {clients.CATALOG_URL, clients.SEARCH_URL, clients.GRAPH_URL}


def test_mcp_get_library_stats(rec, client):
    rec.on("GET", "/stats", lambda r: {"images": 42, "tags": 7, "collections": 3, "notes": 5})
    r = _call(client, "get_library_stats", {})
    assert r.status_code == 200
    assert r.json()["result"]["structuredContent"]["images"] == 42
    assert _bases(rec) == {clients.CATALOG_URL}


def test_mcp_list_collections(rec, client):
    rec.on("GET", "/collections", lambda r: [{"id": "c1", "name": "Knights", "images": []}])
    r = _call(client, "list_collections", {})
    assert r.json()["result"]["structuredContent"]["collections"][0]["id"] == "c1"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_mcp_create_collection_posts_to_catalog(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return {"id": "c9", "name": "Mine", "images": [SHA]}

    rec.on("POST", "/collections", handler)
    r = _call(client, "create_collection", {"name": "Mine", "image_ids": [SHA]})
    assert r.json()["result"]["structuredContent"]["id"] == "c9"
    assert seen["body"] == {"name": "Mine", "images": [SHA]}


def test_mcp_set_collection_images_replaces_membership(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(204)

    rec.on("PUT", "/collections/c1/images", handler)
    r = _call(client, "set_collection_images", {"collection_id": "c1", "image_ids": [SHA]})
    assert r.json()["result"]["structuredContent"]["status"] == "ok"
    assert seen["body"] == {"images": [SHA]}


def test_mcp_list_image_notes(rec, client):
    rec.on("GET", f"/notes/by-image/{SHA}", lambda r: [{"id": "n1", "title": "idea"}])
    r = _call(client, "list_image_notes", {"image_id": SHA})
    assert r.json()["result"]["structuredContent"]["notes"][0]["id"] == "n1"
    assert _bases(rec) == {clients.CATALOG_URL}


def test_mcp_list_jobs_proxies_ingest(rec, client):
    rec.on("GET", "/jobs", lambda r: [{"id": "job1", "status": "running"}])
    r = _call(client, "list_jobs", {})
    assert r.json()["result"]["structuredContent"]["jobs"][0]["id"] == "job1"
    assert _bases(rec) == {clients.INGEST_URL}


def test_mcp_browse_folders_proxies_ingest(rec, client):
    seen = {}

    def handler(request: httpx.Request):
        seen["path"] = request.url.params.get("path")
        return {"path": "/data", "entries": [], "roots": []}

    rec.on("GET", "/fs/browse", handler)
    r = _call(client, "browse_folders", {"path": "/data"})
    assert r.json()["result"]["structuredContent"]["path"] == "/data"
    assert seen["path"] == "/data"
    assert _bases(rec) == {clients.INGEST_URL}


def test_mcp_delete_image_unindexes_across_stores(rec, client):
    rec.on("DELETE", f"/images/{SHA}", lambda r: {"status": "ok", "deleted": 1})
    rec.on("DELETE", f"/points/{SHA}", lambda r: {"status": "ok"})
    r = _call(client, "delete_image", {"image_id": SHA})
    sc = r.json()["result"]["structuredContent"]
    assert sc == {"status": "ok", "sha256": SHA, "catalog": True, "search": True, "graph": True}
    assert _bases(rec) == {clients.CATALOG_URL, clients.SEARCH_URL, clients.GRAPH_URL}
    # Catalog (the source of truth) is deleted FIRST, before the projections.
    assert rec.calls[0][0] == clients.CATALOG_URL


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
    assert names == {"catalog", "search", "graph", "ingest", "vision", "metadata"}
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
