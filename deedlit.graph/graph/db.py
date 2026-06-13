"""Neo4j driver lifecycle for the graph service.

A single driver is held per process and rebuilt if the configured connection
details change (so tests can repoint the service). The driver is created lazily
so importing the app never requires a live database.
"""
from __future__ import annotations

from neo4j import Driver, GraphDatabase

from graph.config import get_config

_driver: Driver | None = None
_driver_key: tuple[str, str, str] | None = None


def get_driver() -> Driver:
    global _driver, _driver_key
    cfg = get_config()
    key = (cfg.neo4j_uri, cfg.neo4j_user, cfg.neo4j_password)
    if _driver is None or _driver_key != key:
        if _driver is not None:
            _driver.close()
        _driver = GraphDatabase.driver(
            cfg.neo4j_uri, auth=(cfg.neo4j_user, cfg.neo4j_password)
        )
        _driver_key = key
    return _driver


def reset_driver() -> None:
    """Close and forget the cached driver (used by tests)."""
    global _driver, _driver_key
    if _driver is not None:
        _driver.close()
    _driver = None
    _driver_key = None


def get_database() -> str:
    return get_config().neo4j_database


def neo4j_ready() -> bool:
    try:
        get_driver().verify_connectivity()
        return True
    except Exception:
        return False
