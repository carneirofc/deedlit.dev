"""Shared ingest test fixtures.

The catalog tasks ledger (#27) is written best-effort over HTTP from the publish
fast path + the worker. To keep the suite offline/deterministic, stub
``ledger.record_task`` by default so no test accidentally talks to a catalog.
Tests that want to assert ledger writes can request the ``stub_ledger`` fixture
and inspect the recorded calls.
"""
from __future__ import annotations

import pytest

import ledger


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
