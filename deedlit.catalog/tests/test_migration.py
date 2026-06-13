"""Verify the Alembic baseline applies cleanly on a truly empty database.

Spins up a throwaway database (``catalog_migtest``) on the docker-compose
Postgres, runs ``alembic upgrade head`` against it, asserts the expected tables
exist via ``information_schema``, then drops the database. The main ``imageapp``
database is never touched.
"""
from __future__ import annotations

import os
from pathlib import Path

import psycopg
import pytest
from psycopg import sql

CATALOG_DIR = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get(
    "CATALOG_ADMIN_DATABASE_URL",
    "postgresql://imageapp:imageapp@localhost:5432/imageapp",
)
TEST_DB = "catalog_migtest"

# Every table the baseline migration must create.
EXPECTED_TABLES = {
    # ported from comfyhelper schema.sql
    "images",
    "models",
    "checkpoints",
    "loras",
    "image_loras",
    "tags",
    "image_tags",
    "tag_aliases",
    "generation_params",
    "image_variants",
    "image_descriptions",
    "ingestion_jobs",
    "ingestion_job_files",
    # new in the catalog service
    "notes",
    "note_image_refs",
    "collections",
    "collection_images",
    "image_references",
}


def _admin_conn() -> psycopg.Connection:
    # autocommit so CREATE/DROP DATABASE can run (no transaction block).
    return psycopg.connect(ADMIN_URL, autocommit=True)


def _test_db_url() -> str:
    base, _, _ = ADMIN_URL.rpartition("/")
    return f"{base}/{TEST_DB}"


@pytest.fixture()
def empty_db() -> str:
    """Create a fresh empty database, yield its URL, drop it afterward."""
    with _admin_conn() as conn, conn.cursor() as cur:
        cur.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                sql.Identifier(TEST_DB)
            )
        )
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    try:
        yield _test_db_url()
    finally:
        with _admin_conn() as conn, conn.cursor() as cur:
            cur.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(TEST_DB)
                )
            )


def test_migration_applies_on_empty_db(empty_db: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(CATALOG_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(CATALOG_DIR / "alembic"))
    # psycopg3 driver URL for SQLAlchemy.
    cfg.set_main_option(
        "sqlalchemy.url", empty_db.replace("postgresql://", "postgresql+psycopg://")
    )

    command.upgrade(cfg, "head")

    with psycopg.connect(empty_db) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public'"
        )
        present = {row[0] for row in cur.fetchall()}

    missing = EXPECTED_TABLES - present
    assert not missing, f"missing tables after migration: {sorted(missing)}"

    # image_references must be keyed by sha256 (the cross-service id): a CHAR(64)
    # / TEXT primary key holding the full sha256 hex.
    with psycopg.connect(empty_db) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = 'image_references'
              AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position
            """
        )
        pk_cols = [row[0] for row in cur.fetchall()]
    assert "sha256" in pk_cols, f"image_references PK must include sha256, got {pk_cols}"
