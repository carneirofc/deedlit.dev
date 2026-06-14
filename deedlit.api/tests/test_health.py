"""Health + OpenAPI smoke tests.

GET /health is now a HealthDashboard that probes the four downstream services.
Downstream HTTP is mocked so the test stays offline; with every downstream
reporting ok the dashboard status is ok.
"""
import httpx
from fastapi.testclient import TestClient

import app as app_module
import clients


def _client(monkeypatch) -> TestClient:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"status": "ok"})
    )
    monkeypatch.setattr(
        clients,
        "make_async_client",
        lambda **kw: httpx.AsyncClient(transport=transport, timeout=5.0),
    )
    return TestClient(app_module.app)


def test_health_ok(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    # The dashboard probes the routable services plus the stateless workers.
    assert {s["name"] for s in body["services"]} == {
        "catalog",
        "search",
        "graph",
        "ingest",
        "vision",
        "metadata",
    }


def test_health_forwards_downstream_detail(monkeypatch):
    """Each service's readiness flags are forwarded for the status dashboard."""

    def handler(request: httpx.Request) -> httpx.Response:
        # catalog reports its datastore readiness; the gateway must surface it.
        return httpx.Response(200, json={"status": "ok", "db_ready": True, "blob_ready": False})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        clients,
        "make_async_client",
        lambda **kw: httpx.AsyncClient(transport=transport, timeout=5.0),
    )
    client = TestClient(app_module.app)
    body = client.get("/health").json()
    catalog = next(s for s in body["services"] if s["name"] == "catalog")
    assert catalog["detail"] == {"db_ready": True, "blob_ready": False}


def test_openapi_served(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert r.json()["openapi"].startswith("3.")
