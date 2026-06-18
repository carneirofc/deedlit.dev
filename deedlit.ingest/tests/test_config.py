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
    monkeypatch.delenv("INGEST_LLM_ENABLED", raising=False)
    config.reset()
    r = config.runtime()
    # LLM enrichment is ON by default (the labelagent must also be configured).
    assert r == {"ingest_concurrency": 32, "ingest_via_queue": False, "llm_enabled": True}


def test_llm_enabled_env_default_then_override(monkeypatch):
    monkeypatch.setenv("INGEST_LLM_ENABLED", "false")
    config.reset()
    assert config.runtime()["llm_enabled"] is False  # env default
    assert jobs_module.llm_enabled() is False

    config.update({"llm_enabled": True})
    assert config.runtime()["llm_enabled"] is True  # override wins
    assert jobs_module.llm_enabled() is True


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
        assert set(got) == {"ingest_concurrency", "ingest_via_queue", "llm_enabled"}

        put = client.put(
            "/config",
            json={"ingest_concurrency": 5, "ingest_via_queue": True, "llm_enabled": False},
        )
        assert put.status_code == 200
        assert put.json() == {
            "ingest_concurrency": 5,
            "ingest_via_queue": True,
            "llm_enabled": False,
        }

        # Persisted for the next read (same process).
        reread = client.get("/config").json()
        assert reread["ingest_concurrency"] == 5
        assert reread["llm_enabled"] is False


def test_put_config_persists_to_catalog(monkeypatch):
    """A UI config change is written through to the catalog settings store so it
    survives an ingest restart (best-effort; the in-memory override applies now)."""
    import settings_client

    saved: list[dict] = []

    async def _save(overrides):
        saved.append(overrides)
        return True

    monkeypatch.setattr(settings_client, "save", _save)
    with TestClient(app_module.app) as client:
        client.put("/config", json={"ingest_concurrency": 7})
    assert saved and saved[-1]["ingest_concurrency"] == 7


def test_post_ingest_skips_label_when_llm_disabled(monkeypatch):
    """The producer skips publishing the ``label`` stage when the LLM master
    switch is off — the image is still cataloged + projected (dense/sparse/graph)."""
    import asyncio

    called: list[str] = []

    def fake(name):
        async def f(sha256, parent_op_id=None, **kw):
            called.append(name)
            return True
        return f

    monkeypatch.setattr(jobs_module, "_publish_embed_dense_best_effort", fake("dense"))
    monkeypatch.setattr(jobs_module, "_publish_embed_sparse_best_effort", fake("sparse"))
    monkeypatch.setattr(jobs_module, "_publish_index_graph_best_effort", fake("graph"))
    monkeypatch.setattr(jobs_module, "_publish_label_best_effort", fake("label"))

    config.update({"llm_enabled": False})
    asyncio.run(jobs_module._publish_post_ingest_best_effort("a" * 64, parent_op_id="op"))
    assert set(called) == {"dense", "sparse", "graph"}  # label skipped

    called.clear()
    config.update({"llm_enabled": True})
    asyncio.run(jobs_module._publish_post_ingest_best_effort("a" * 64, parent_op_id="op"))
    assert "label" in called


def test_startup_seeds_config_from_persisted_overrides(monkeypatch):
    """On boot the live config is seeded from the persisted overrides, so a knob
    set from the UI is back in effect after a restart (not the env default)."""
    import settings_client

    async def _load():
        return {"ingest_concurrency": 9, "ingest_via_queue": True}

    monkeypatch.setattr(settings_client, "load", _load)
    config.reset()
    with TestClient(app_module.app) as client:
        got = client.get("/config").json()
    assert got["ingest_concurrency"] == 9
    assert got["ingest_via_queue"] is True
