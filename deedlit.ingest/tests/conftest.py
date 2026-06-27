"""Shared ingest test fixtures.

The catalog tasks ledger (#27) is written best-effort over HTTP from the publish
fast path + the worker. To keep the suite offline/deterministic, stub
``ledger.record_task`` by default so no test accidentally talks to a catalog.
Tests that want to assert ledger writes can request the ``stub_ledger`` fixture
and inspect the recorded calls.
"""
from __future__ import annotations

import pytest

import config
import job_ledger
import ledger
import settings_client


@pytest.fixture(autouse=True)
def stub_job_persistence(monkeypatch):
    """Keep the job/config write-through offline + fast in tests.

    The startup hydrate (interrupt-stale + list) and the PUT /config persist call
    catalog over HTTP best-effort (5s timeout each). Stub them so the suite never
    blocks on a missing catalog. The returned list records job snapshots for
    tests that want to assert what would have been persisted.
    """
    recorded: list[dict] = []

    async def _record_job(snapshot):
        recorded.append(snapshot)
        return True

    async def _list_jobs(limit: int = 200):
        return []

    async def _interrupt_stale():
        return []

    async def _settings_load():
        return {}

    async def _settings_save(overrides):
        return True

    monkeypatch.setattr(job_ledger, "record_job", _record_job)
    monkeypatch.setattr(job_ledger, "list_jobs", _list_jobs)
    monkeypatch.setattr(job_ledger, "interrupt_stale", _interrupt_stale)
    monkeypatch.setattr(settings_client, "load", _settings_load)
    monkeypatch.setattr(settings_client, "save", _settings_save)
    return recorded


@pytest.fixture(autouse=True)
def reset_runtime_config():
    """Drop live config overrides before+after each test so a PUT /config in one
    test never leaks its producer knobs into another (config is a module global)."""
    config.reset()
    yield
    config.reset()


@pytest.fixture(autouse=True)
def stub_ledger(monkeypatch):
    """Replace the best-effort ledger writer with an in-memory recorder.

    Each recorded call is a dict: {sha256, type, status, attempts, error,
    parent_op_id}. Autouse so the ledger never reaches out over HTTP in tests.
    """
    calls: list[dict] = []

    def _record(sha256, task_type, status, attempts=None, error=None, parent_op_id=None):
        calls.append(
            {
                "sha256": sha256,
                "type": task_type,
                "status": status,
                "attempts": attempts,
                "error": error,
                "parent_op_id": parent_op_id,
            }
        )
        return True

    monkeypatch.setattr(ledger, "record_task", _record)
    return calls
