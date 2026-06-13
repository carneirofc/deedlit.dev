"""Run the catalog's own Alembic migrations programmatically.

The catalog service OWNS the migration tree (#4) and is the only service that
runs it. ``run_migrations(database_url)`` applies ``alembic upgrade head``
against the given URL (defaulting to the configured DATABASE_URL).
"""
from __future__ import annotations

from pathlib import Path

from catalog.config import get_config

CATALOG_DIR = Path(__file__).resolve().parent.parent


def run_migrations(database_url: str | None = None, revision: str = "head") -> None:
    from alembic import command
    from alembic.config import Config

    url = database_url or get_config().database_url

    cfg = Config(str(CATALOG_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(CATALOG_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, revision)


if __name__ == "__main__":  # pragma: no cover - manual entry point
    run_migrations()
