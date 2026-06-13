"""Shared fixtures: a throwaway migrated Postgres DB + a TestClient.

Mirrors the throwaway-database pattern in test_migration.py: a fresh database is
created on the docker-compose Postgres, the catalog's own Alembic baseline is run
against it, DATABASE_URL is pointed at it, and the engine/object-store caches are
reset so the app picks up the test config. Blobs use the live RustFS with a
sha256-keyed layout (test images use random sha256s, so no cleanup needed).
"""
from __future__ import annotations

import os
import uuid

import psycopg
import pytest
from psycopg import sql

ADMIN_URL = os.environ.get(
    "CATALOG_ADMIN_DATABASE_URL",
    "postgresql://imageapp:imageapp@localhost:5432/imageapp",
)


def _admin_conn() -> psycopg.Connection:
    return psycopg.connect(ADMIN_URL, autocommit=True)


@pytest.fixture()
def migrated_db() -> str:
    """Create + migrate a fresh database, yield its SQLAlchemy URL, drop it."""
    db_name = f"catalog_test_{uuid.uuid4().hex[:12]}"
    with _admin_conn() as conn, conn.cursor() as cur:
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))

    base, _, _ = ADMIN_URL.rpartition("/")
    sa_url = f"{base}/{db_name}".replace("postgresql://", "postgresql+psycopg://")

    from catalog.migrations import run_migrations

    run_migrations(sa_url)
    try:
        yield sa_url
    finally:
        with _admin_conn() as conn, conn.cursor() as cur:
            cur.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(db_name)
                )
            )


@pytest.fixture()
def client(migrated_db: str):
    from fastapi.testclient import TestClient

    prev_db = os.environ.get("DATABASE_URL")
    prev_bucket = os.environ.get("OBJECT_STORE_BUCKET")
    os.environ["DATABASE_URL"] = migrated_db
    # Use an isolated bucket for tests so we never touch prod blobs.
    os.environ["OBJECT_STORE_BUCKET"] = "deedlit-test"

    from catalog import db, object_store

    db.reset_engine()
    object_store.reset_client()

    import app as app_module

    try:
        with TestClient(app_module.app) as c:
            yield c
    finally:
        # Restore env so leakage never points other tests (e.g. the health
        # test) at this now-dropped throwaway database.
        if prev_db is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = prev_db
        if prev_bucket is None:
            os.environ.pop("OBJECT_STORE_BUCKET", None)
        else:
            os.environ["OBJECT_STORE_BUCKET"] = prev_bucket
        db.reset_engine()
        object_store.reset_client()
