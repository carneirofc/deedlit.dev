"""Tests for the live producer config (ADR 0002): env defaults + overrides,
the jobs read-through, and the GET/PUT /config endpoints. The autouse
``reset_runtime_config`` fixture (conftest) clears overrides between tests.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import app as app_module
import config
import jobs as jobs_module


def test_runtime_defaults(monkeypatch):
    monkeypatch.delenv("INGEST_CONCURRENCY", raising=False)
    monkeypatch.delenv("INGEST_VIA_QUEUE", raising=False)
    config.reset()
    r = config.runtime()
    assert r == {"ingest_concurrency": 32, "ingest_via_queue": False}


def test_env_default_then_override(monkeypatch):
    monkeypatch.setenv("INGEST_CONCURRENCY", "2")
    config.reset()
    assert config.runtime()["ingest_concurrency"] == 2  # env default

    config.update({"ingest_concurrency": 12, "ingest_via_queue": True})
    assert config.runtime()["ingest_concurrency"] == 12  # override wins
    assert config.runtime()["ingest_via_queue"] is True
    # jobs reads the live config (no restart).
    assert jobs_module.ingest_concurrency() == 12
    assert jobs_module.ingest_via_queue() is True


def test_update_clamps_concurrency_to_at_least_one():
    config.update({"ingest_concurrency": 0})
    assert config.runtime()["ingest_concurrency"] == 1


def test_config_endpoints_round_trip():
    with TestClient(app_module.app) as client:
        got = client.get("/config").json()
        assert set(got) == {"ingest_concurrency", "ingest_via_queue"}

        put = client.put("/config", json={"ingest_concurrency": 5, "ingest_via_queue": True})
        assert put.status_code == 200
        assert put.json() == {"ingest_concurrency": 5, "ingest_via_queue": True}

        # Persisted for the next read (same process).
        assert client.get("/config").json()["ingest_concurrency"] == 5
