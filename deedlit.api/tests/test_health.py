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
    assert {s["name"] for s in body["services"]} == {"catalog", "search", "graph", "ingest"}


def test_openapi_served(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert r.json()["openapi"].startswith("3.")
