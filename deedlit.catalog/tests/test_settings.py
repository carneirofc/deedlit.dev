"""Tests for the catalog settings KV store (holds the ingest config overrides).

Uses the throwaway migrated-Postgres ``client`` fixture (see conftest.py), so
these exercise the real 0005_jobs_settings migration + repository SQL end-to-end.
"""
from __future__ import annotations


def test_put_then_get_roundtrip(client):
    r = client.put(
        "/settings/ingest_config",
        json={"value": {"ingest_concurrency": 8, "ingest_via_queue": True}},
    )
    assert r.status_code == 200
    assert r.json()["key"] == "ingest_config"
    assert r.json()["value"] == {"ingest_concurrency": 8, "ingest_via_queue": True}

    got = client.get("/settings/ingest_config")
    assert got.status_code == 200
    assert got.json()["value"]["ingest_concurrency"] == 8


def test_put_upserts_same_key(client):
    client.put("/settings/ingest_config", json={"value": {"ingest_concurrency": 2}})
    client.put("/settings/ingest_config", json={"value": {"ingest_concurrency": 16}})
    got = client.get("/settings/ingest_config").json()
    assert got["value"] == {"ingest_concurrency": 16}


def test_get_unknown_key_is_404(client):
    assert client.get("/settings/does_not_exist").status_code == 404
