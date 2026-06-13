"""SQLAlchemy Core engine for the catalog service.

The catalog uses SQLAlchemy Core (textual SQL via the engine) rather than the
ORM — the schema is hand-authored in the Alembic baseline (#4), so we target the
exact ported table/column names directly. A single lazily-created engine is held
per process and rebuilt if the configured DATABASE_URL changes (so tests can
point the app at a throwaway database).
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from catalog.config import get_config

_engine: Engine | None = None
_engine_url: str | None = None


def get_engine() -> Engine:
    global _engine, _engine_url
    url = get_config().database_url
    if _engine is None or _engine_url != url:
        _engine = create_engine(url, future=True, pool_pre_ping=True)
        _engine_url = url
    return _engine


def reset_engine() -> None:
    """Dispose the cached engine (used by tests after switching DATABASE_URL)."""
    global _engine, _engine_url
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _engine_url = None


def db_ready() -> bool:
    from sqlalchemy import text

    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
