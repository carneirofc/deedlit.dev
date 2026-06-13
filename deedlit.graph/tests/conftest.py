"""Shared fixtures for graph tests.

Tests run against a LIVE Neo4j (docker compose up -d --wait neo4j). Each test
gets a clean graph: the `clean_graph` fixture wipes all nodes/relationships
before and after, so runs never leak into each other. If Neo4j is unreachable
the whole module is skipped with a clear message.
"""
from __future__ import annotations

import pytest

from graph import repository
from graph.db import neo4j_ready


@pytest.fixture(autouse=True)
def clean_graph():
    if not neo4j_ready():
        pytest.skip("Neo4j not reachable (run: docker compose up -d --wait neo4j)")
    repository.wipe_all()
    yield
    repository.wipe_all()


def sha(prefix: str) -> str:
    """Build a valid 64-hex sha256 from a short prefix for readable tests."""
    body = prefix.encode("ascii").hex()
    return (body + "0" * 64)[:64]
