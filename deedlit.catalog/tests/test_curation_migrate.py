"""Tests for the one-time curation migration (#20).

A throwaway SOURCE database is seeded with a minimal subset of the *old TS
Postgres* schema (an ``images`` table carrying ``id`` (UUID PK) + ``sha256_hash``
plus ``rating`` / ``favorite`` columns, and the curation tables
``notes`` / ``note_images`` / ``collections`` / ``collection_images``). A
throwaway DESTINATION database is migrated with the catalog Alembic baseline.

The migration must copy notes / collections / ratings / favorites into the
destination, re-keying every image reference from the source UUID id to its
sha256, idempotently, and must NOT populate the re-derivable tables
(images / tags / generation_params).
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


def _url_for(db_name: str) -> str:
    base, _, _ = ADMIN_URL.rpartition("/")
    return f"{base}/{db_name}"


# A minimal subset of the OLD TS Postgres schema, enough to exercise the
# curation migration. ``images`` mirrors the canonical schema.sql shape (UUID PK
# + UNIQUE sha256_hash + rating/favorite). The curation tables reference images
# by the UUID id (image_id), which the migration must re-key to sha256.
SOURCE_SCHEMA = """
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  sha256_hash TEXT NOT NULL UNIQUE,
  rating      INTEGER,
  favorite    BOOLEAN NOT NULL DEFAULT false,
  -- re-derivable noise that must NOT be migrated
  prompt      TEXT
);

CREATE TABLE notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT,
  positive   TEXT,
  negative   TEXT,
  blocks     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: image_id intentionally has NO FK to images. In the old TS app a
-- curation row could outlive its image (hard-deleted), so the migration must
-- tolerate (and skip) refs whose image_id no longer resolves to a sha256.
CREATE TABLE note_images (
  note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  image_id UUID NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, image_id)
);

CREATE TABLE collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection_images (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  image_id      UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, image_id)
);

-- re-derivable tables that must NOT be migrated
CREATE TABLE tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
"""


@pytest.fixture()
def source_db() -> str:
    """Create + seed a throwaway old-schema source DB; yield its URL; drop it."""
    db_name = f"curation_src_{uuid.uuid4().hex[:12]}"
    with _admin_conn() as conn, conn.cursor() as cur:
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))

    url = _url_for(db_name)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(SOURCE_SCHEMA)
        # Three images with distinct sha256 (64-hex). Two are referenced by
        # curation rows; one image id used by curation will be missing to
        # exercise the "unresolvable id is skipped" path.
        sha_a = "a" * 64
        sha_b = "b" * 64
        sha_c = "c" * 64
        id_a = str(uuid.uuid4())
        id_b = str(uuid.uuid4())
        id_c = str(uuid.uuid4())
        missing_id = str(uuid.uuid4())  # never inserted into images
        cur.executemany(
            "INSERT INTO images (id, file_path, filename, sha256_hash, rating, favorite) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            [
                (id_a, "/a.png", "a.png", sha_a, 5, True),
                (id_b, "/b.png", "b.png", sha_b, 3, False),
                (id_c, "/c.png", "c.png", sha_c, None, True),
            ],
        )
        # A note referencing image a (resolvable) and a missing id (skipped).
        note_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO notes (id, title, positive, negative, blocks) "
            "VALUES (%s, %s, %s, %s, %s::jsonb)",
            (note_id, "My Note", "masterpiece", "blurry", '{"blocks": []}'),
        )
        cur.executemany(
            "INSERT INTO note_images (note_id, image_id, position) VALUES (%s, %s, %s)",
            [(note_id, id_a, 0), (note_id, missing_id, 1)],
        )
        # A collection referencing images b and c (ordered).
        col_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO collections (id, name) VALUES (%s, %s)",
            (col_id, "Favourites"),
        )
        cur.executemany(
            "INSERT INTO collection_images (collection_id, image_id, position) "
            "VALUES (%s, %s, %s)",
            [(col_id, id_b, 0), (col_id, id_c, 1)],
        )
        conn.commit()

    try:
        yield url
    finally:
        with _admin_conn() as conn, conn.cursor() as cur:
            cur.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(db_name)
                )
            )


@pytest.fixture()
def dest_db() -> str:
    """Create + migrate a throwaway catalog destination DB; yield URL; drop it."""
    db_name = f"curation_dst_{uuid.uuid4().hex[:12]}"
    with _admin_conn() as conn, conn.cursor() as cur:
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))

    url = _url_for(db_name)
    from catalog.migrations import run_migrations

    run_migrations(url.replace("postgresql://", "postgresql+psycopg://"))
    try:
        yield url
    finally:
        with _admin_conn() as conn, conn.cursor() as cur:
            cur.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(db_name)
                )
            )


def _count(url: str, table: str, where: str = "") -> int:
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {table} {where}")
        return cur.fetchone()[0]


def test_migration_copies_curation(source_db: str, dest_db: str) -> None:
    from migration.curation_migrate import migrate

    migrate(source_db, dest_db)

    # notes + collections copied
    assert _count(dest_db, "notes") == 1
    assert _count(dest_db, "collections") == 1
    # note has one resolvable ref (the missing id is skipped)
    assert _count(dest_db, "note_image_refs") == 1
    # collection has both refs
    assert _count(dest_db, "collection_images") == 2

    # note fields copied
    with psycopg.connect(dest_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT title, positive, negative FROM notes")
        title, positive, negative = cur.fetchone()
    assert title == "My Note"
    assert positive == "masterpiece"
    assert negative == "blurry"

    # ratings + favorites copied (stored in image_references, sha256-keyed)
    assert _count(dest_db, "image_references", "WHERE kind = 'rating'") == 2  # a,b
    assert _count(dest_db, "image_references", "WHERE kind = 'favorite'") == 2  # a,c


def test_image_refs_rekeyed_to_sha256(source_db: str, dest_db: str) -> None:
    from migration.curation_migrate import migrate

    migrate(source_db, dest_db)

    with psycopg.connect(dest_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT sha256 FROM note_image_refs")
        note_shas = {r[0].strip() for r in cur.fetchall()}
        cur.execute("SELECT sha256 FROM collection_images ORDER BY position")
        col_shas = [r[0].strip() for r in cur.fetchall()]
        cur.execute(
            "SELECT sha256 FROM image_references WHERE kind = 'rating' "
            "AND name = '5'"
        )
        rated_5 = {r[0].strip() for r in cur.fetchall()}

    assert note_shas == {"a" * 64}
    assert col_shas == ["b" * 64, "c" * 64]
    assert rated_5 == {"a" * 64}
    # every stored sha is 64-hex
    for s in note_shas | set(col_shas) | rated_5:
        assert len(s) == 64
        int(s, 16)  # raises if not hex


def test_migration_is_idempotent(source_db: str, dest_db: str) -> None:
    from migration.curation_migrate import migrate

    migrate(source_db, dest_db)
    counts_1 = {
        t: _count(dest_db, t)
        for t in (
            "notes",
            "note_image_refs",
            "collections",
            "collection_images",
            "image_references",
        )
    }

    migrate(source_db, dest_db)
    counts_2 = {
        t: _count(dest_db, t)
        for t in (
            "notes",
            "note_image_refs",
            "collections",
            "collection_images",
            "image_references",
        )
    }
    assert counts_1 == counts_2, f"re-run changed counts: {counts_1} -> {counts_2}"


def test_reconcile_reports_matching_counts(source_db: str, dest_db: str) -> None:
    from migration.curation_migrate import migrate, reconcile

    migrate(source_db, dest_db)
    report = reconcile(source_db, dest_db)

    assert report["notes"] == {"source": 1, "dest": 1, "ok": True}
    assert report["collections"] == {"source": 1, "dest": 1, "ok": True}
    # note_images: source has 2 rows but 1 is unresolvable -> dest 1, resolvable 1
    assert report["note_image_refs"]["dest"] == 1
    assert report["note_image_refs"]["source_resolvable"] == 1
    assert report["note_image_refs"]["ok"] is True
    assert report["collection_images"] == {
        "source": 2,
        "source_resolvable": 2,
        "dest": 2,
        "ok": True,
    }
    assert report["all_ok"] is True


def test_rederivable_tables_not_populated(source_db: str, dest_db: str) -> None:
    from migration.curation_migrate import migrate

    migrate(source_db, dest_db)

    # The migration must not touch images / tags / generation_params.
    assert _count(dest_db, "images") == 0
    assert _count(dest_db, "tags") == 0
    assert _count(dest_db, "generation_params") == 0
