"""Gateway GET /activity: aggregates every downstream's /activity (in-flight /
throughput / current op) into one payload for the comfyhelper system-activity
board. Downstream HTTP is mocked so the test stays offline. Mirrors the /health
fan-out shape + graceful degradation.
"""
import httpx
from fastapi.testclient import TestClient

import app as app_module
import clients


def _client(monkeypatch, handler) -> TestClient:
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        clients,
        "make_async_client",
        lambda **kw: httpx.AsyncClient(transport=transport, timeout=5.0),
    )
    return TestClient(app_module.app)


def test_activity_aggregates_every_service_plus_the_gateway(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/activity"
        return httpx.Response(
            200,
            json={"inflight": 2, "per_min": 14.0, "busy": True, "last_op": "POST /embed/image"},
        )

    client = _client(monkeypatch, handler)
    body = client.get("/activity").json()
    names = {s["name"] for s in body["services"]}
    # The gateway's own row plus every probed downstream worker.
    assert "gateway" in names
    assert {"catalog", "search", "graph", "ingest", "vision", "metadata"} <= names

    # Each downstream row carries the snapshot fields + a reachable flag.
    vision = next(s for s in body["services"] if s["name"] == "vision")
    assert vision == {
        "name": "vision",
        "inflight": 2,
        "per_min": 14.0,
        "busy": True,
        "last_op": "POST /embed/image",
        "reachable": True,
    }

    # The gateway row is self-reported (reachable) and well-shaped.
    gw = next(s for s in body["services"] if s["name"] == "gateway")
    assert gw["reachable"] is True
    assert {"inflight", "per_min", "busy", "last_op"} <= set(gw)


def test_activity_degrades_to_idle_when_a_service_is_down(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        # search (port 8002) is unreachable; everyone else is idle.
        if request.url.port == 8002:
            raise httpx.ConnectError("connection refused")
        return httpx.Response(200, json={"inflight": 0, "per_min": 0.0, "busy": False, "last_op": None})

    client = _client(monkeypatch, handler)
    r = client.get("/activity")
    assert r.status_code == 200  # still 200 — the board shows the down row
    body = r.json()
    search = next(s for s in body["services"] if s["name"] == "search")
    assert search["reachable"] is False
    assert search["busy"] is False
    assert search["inflight"] == 0
    # other services are still present and reachable
    catalog = next(s for s in body["services"] if s["name"] == "catalog")
    assert catalog["reachable"] is True
