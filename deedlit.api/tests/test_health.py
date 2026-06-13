from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_openapi_served():
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert r.json()["openapi"].startswith("3.")
