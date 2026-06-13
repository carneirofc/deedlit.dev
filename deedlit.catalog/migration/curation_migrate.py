"""One-time, idempotent curation migration into ``deedlit.catalog`` (#20).

Copies CURATION data — notes, collections, ratings, favorites — from the *old
TS Postgres* into the catalog's Postgres. Re-derivable data (images / tags /
generation_params / vectors / graph) is deliberately NOT migrated: it is
re-ingested by the ingest worker, so the catalog's ``images`` table is left
untouched here.

Re-keying
---------
Every curation row in the source references an image by the TS ``images.id``
(a UUID surrogate key). The cross-service id is the full sha256 hex, so the
migration first loads the source ``images.id -> sha256_hash`` map and re-keys
every reference to its sha256. Rows whose ``image_id`` cannot be resolved (e.g.
the image was hard-deleted while the curation row lived on) are skipped and
logged.

Idempotency
-----------
All writes are ``INSERT ... ON CONFLICT`` upserts keyed on stable identifiers:

* ``notes`` / ``collections``      -> upsert on the source ``id`` (UUID carried
  over verbatim, so re-running updates in place).
* ``note_image_refs`` / ``collection_images`` -> upsert on
  ``(parent_id, sha256)``; the set of refs for each parent is reconciled
  (stale rows pruned) so a re-run converges.
* ratings / favorites -> stored in ``image_references`` under the reserved
  ``kind`` values ``'rating'`` / ``'favorite'``, upserted on the table PK
  ``(sha256, kind, name)``.

Ratings / favorites storage
---------------------------
The catalog keeps rating/favorite as columns on ``images`` (re-derivable, wiped
on re-ingest). To preserve this curation across re-ingestion in a sha256-keyed
way without touching ``images``, the migration writes them as rows in
``image_references`` (``kind='rating'``, ``name=<0-5>``; ``kind='favorite'``,
``name='true'``). After re-ingest a small reconcile step can fold these back
onto the rebuilt ``images`` rows.

Run as a module::

    SOURCE_DATABASE_URL=postgresql://... DATABASE_URL=postgresql://... \\
        uv run --project deedlit.catalog python -m migration.curation_migrate

Add ``--reconcile`` to print a source-vs-dest row-count report instead of (or,
with ``--migrate --reconcile``, after) migrating.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger("catalog.curation_migrate")

# Reserved image_references.kind values used to durably park curation that the
# catalog otherwise stores as columns on the re-derivable images table.
RATING_KIND = "rating"
FAVORITE_KIND = "favorite"


# ---------------------------------------------------------------------------
# Engine helpers
# ---------------------------------------------------------------------------


def _engine(url: str) -> Engine:
    """Build a SQLAlchemy engine, normalising to the psycopg3 driver."""
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return create_engine(url, future=True, pool_pre_ping=True)


# ---------------------------------------------------------------------------
# Re-key map
# ---------------------------------------------------------------------------


def _load_sha_map(src: Connection) -> dict[str, str]:
    """Return ``{image_uuid: sha256_hash}`` from the source images table."""
    rows = src.execute(text("SELECT id, sha256_hash FROM images")).all()
    return {str(r[0]): r[1] for r in rows if r[1]}


def _resolve(sha_map: dict[str, str], image_id: Any, *, context: str) -> str | None:
    sha = sha_map.get(str(image_id))
    if sha is None:
        logger.warning("skip %s: image_id %s has no sha256 in source", context, image_id)
    return sha


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------


def _migrate_notes(src: Connection, dst: Connection, sha_map: dict[str, str]) -> None:
    notes = src.execute(
        text(
            "SELECT id, title, positive, negative, blocks, created_at, updated_at "
            "FROM notes"
        )
    ).mappings().all()

    for n in notes:
        note_id = str(n["id"])
        dst.execute(
            text(
                """
                INSERT INTO notes (id, title, positive, negative, blocks,
                                   created_at, updated_at)
                VALUES (:id, :title, :positive, :negative,
                        CAST(:blocks AS JSONB), :created_at, :updated_at)
                ON CONFLICT (id) DO UPDATE SET
                    title      = EXCLUDED.title,
                    positive   = EXCLUDED.positive,
                    negative   = EXCLUDED.negative,
                    blocks     = EXCLUDED.blocks,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "id": note_id,
                "title": n["title"],
                "positive": n["positive"],
                "negative": n["negative"],
                "blocks": _as_json(n["blocks"]),
                "created_at": n["created_at"],
                "updated_at": n["updated_at"],
            },
        )

        refs = src.execute(
            text(
                "SELECT image_id, position FROM note_images "
                "WHERE note_id = :nid ORDER BY position"
            ),
            {"nid": note_id},
        ).all()
        kept: list[str] = []
        for image_id, position in refs:
            sha = _resolve(sha_map, image_id, context=f"note_image {note_id}")
            if sha is None:
                continue
            kept.append(sha)
            dst.execute(
                text(
                    """
                    INSERT INTO note_image_refs (note_id, sha256, position)
                    VALUES (:nid, :sha, :pos)
                    ON CONFLICT (note_id, sha256) DO UPDATE SET
                        position = EXCLUDED.position
                    """
                ),
                {"nid": note_id, "sha": sha, "pos": position},
            )
        _prune(dst, "note_image_refs", "note_id", note_id, "sha256", kept)


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


def _migrate_collections(
    src: Connection, dst: Connection, sha_map: dict[str, str]
) -> None:
    cols = src.execute(
        text("SELECT id, name, created_at, updated_at FROM collections")
    ).mappings().all()

    for c in cols:
        cid = str(c["id"])
        dst.execute(
            text(
                """
                INSERT INTO collections (id, name, created_at, updated_at)
                VALUES (:id, :name, :created_at, :updated_at)
                ON CONFLICT (id) DO UPDATE SET
                    name       = EXCLUDED.name,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "id": cid,
                "name": c["name"],
                "created_at": c["created_at"],
                "updated_at": c["updated_at"],
            },
        )

        refs = src.execute(
            text(
                "SELECT image_id, position FROM collection_images "
                "WHERE collection_id = :cid ORDER BY position"
            ),
            {"cid": cid},
        ).all()
        kept: list[str] = []
        for image_id, position in refs:
            sha = _resolve(sha_map, image_id, context=f"collection_image {cid}")
            if sha is None:
                continue
            kept.append(sha)
            dst.execute(
                text(
                    """
                    INSERT INTO collection_images (collection_id, sha256, position)
                    VALUES (:cid, :sha, :pos)
                    ON CONFLICT (collection_id, sha256) DO UPDATE SET
                        position = EXCLUDED.position
                    """
                ),
                {"cid": cid, "sha": sha, "pos": position},
            )
        _prune(dst, "collection_images", "collection_id", cid, "sha256", kept)


# ---------------------------------------------------------------------------
# Ratings / favorites
# ---------------------------------------------------------------------------


def _migrate_ratings_favorites(
    src: Connection, dst: Connection, sha_map: dict[str, str]
) -> None:
    rows = src.execute(
        text("SELECT id, rating, favorite FROM images")
    ).mappings().all()

    for r in rows:
        sha = sha_map.get(str(r["id"]))
        if sha is None:
            continue
        if r["rating"] is not None:
            _upsert_ref(dst, sha, RATING_KIND, str(int(r["rating"])))
        if r["favorite"]:
            _upsert_ref(dst, sha, FAVORITE_KIND, "true")


def _upsert_ref(dst: Connection, sha: str, kind: str, name: str) -> None:
    dst.execute(
        text(
            """
            INSERT INTO image_references (sha256, kind, name, position)
            VALUES (:sha, :kind, :name, 0)
            ON CONFLICT (sha256, kind, name) DO UPDATE SET
                position = EXCLUDED.position
            """
        ),
        {"sha": sha, "kind": kind, "name": name},
    )


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _prune(
    dst: Connection,
    table: str,
    parent_col: str,
    parent_id: str,
    child_col: str,
    keep: list[str],
) -> None:
    """Delete child rows for a parent that are no longer present in the source.

    Keeps the migration convergent (idempotent) even if a ref was removed in the
    source between runs.
    """
    if keep:
        dst.execute(
            text(
                f"DELETE FROM {table} WHERE {parent_col} = :pid "
                f"AND {child_col} <> ALL(:keep)"
            ),
            {"pid": parent_id, "keep": keep},
        )
    else:
        dst.execute(
            text(f"DELETE FROM {table} WHERE {parent_col} = :pid"),
            {"pid": parent_id},
        )


def _as_json(value: Any) -> str:
    import json

    if value is None:
        return "{}"
    if isinstance(value, (str, bytes)):
        return value.decode() if isinstance(value, bytes) else value
    return json.dumps(value)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def migrate(source_url: str, dest_url: str) -> None:
    """Run the full curation migration from ``source_url`` into ``dest_url``."""
    src_engine = _engine(source_url)
    dst_engine = _engine(dest_url)
    try:
        with src_engine.connect() as src:
            sha_map = _load_sha_map(src)
            logger.info("loaded %d image id->sha256 mappings", len(sha_map))
            with dst_engine.begin() as dst:
                _migrate_notes(src, dst, sha_map)
                _migrate_collections(src, dst, sha_map)
                _migrate_ratings_favorites(src, dst, sha_map)
        logger.info("curation migration complete")
    finally:
        src_engine.dispose()
        dst_engine.dispose()


def reconcile(source_url: str, dest_url: str) -> dict[str, Any]:
    """Compare source vs destination curation row counts.

    Returns a report dict; for the ref tables it also reports how many source
    rows were *resolvable* (had a sha256), since unresolvable rows are expected
    to be absent in the destination.
    """
    src_engine = _engine(source_url)
    dst_engine = _engine(dest_url)
    try:
        with src_engine.connect() as src, dst_engine.connect() as dst:
            sha_map = _load_sha_map(src)

            def s_count(q: str) -> int:
                return int(src.execute(text(q)).scalar_one())

            def d_count(q: str) -> int:
                return int(dst.execute(text(q)).scalar_one())

            notes = {
                "source": s_count("SELECT count(*) FROM notes"),
                "dest": d_count("SELECT count(*) FROM notes"),
            }
            notes["ok"] = notes["source"] == notes["dest"]

            collections = {
                "source": s_count("SELECT count(*) FROM collections"),
                "dest": d_count("SELECT count(*) FROM collections"),
            }
            collections["ok"] = collections["source"] == collections["dest"]

            note_refs = _reconcile_refs(
                src, dst, sha_map, "note_images", "note_image_refs"
            )
            col_refs = _reconcile_refs(
                src, dst, sha_map, "collection_images", "collection_images"
            )

            # ratings/favorites: count source non-null ratings + favorites that
            # resolve, vs the parked image_references rows.
            rated_src = sum(
                1
                for r in src.execute(
                    text("SELECT id, rating FROM images WHERE rating IS NOT NULL")
                ).all()
                if str(r[0]) in sha_map
            )
            fav_src = sum(
                1
                for r in src.execute(
                    text("SELECT id FROM images WHERE favorite = true")
                ).all()
                if str(r[0]) in sha_map
            )
            ratings = {
                "source_resolvable": rated_src,
                "dest": d_count(
                    f"SELECT count(*) FROM image_references WHERE kind = '{RATING_KIND}'"
                ),
            }
            ratings["ok"] = ratings["source_resolvable"] == ratings["dest"]
            favorites = {
                "source_resolvable": fav_src,
                "dest": d_count(
                    f"SELECT count(*) FROM image_references WHERE kind = '{FAVORITE_KIND}'"
                ),
            }
            favorites["ok"] = favorites["source_resolvable"] == favorites["dest"]
    finally:
        src_engine.dispose()
        dst_engine.dispose()

    report: dict[str, Any] = {
        "notes": notes,
        "collections": collections,
        "note_image_refs": note_refs,
        "collection_images": col_refs,
        "ratings": ratings,
        "favorites": favorites,
    }
    report["all_ok"] = all(
        part["ok"] for part in report.values() if isinstance(part, dict)
    )
    return report


def _reconcile_refs(
    src: Connection,
    dst: Connection,
    sha_map: dict[str, str],
    src_table: str,
    dst_table: str,
) -> dict[str, Any]:
    src_rows = src.execute(text(f"SELECT image_id FROM {src_table}")).all()
    source = len(src_rows)
    resolvable = sum(1 for (image_id,) in src_rows if str(image_id) in sha_map)
    dest = int(dst.execute(text(f"SELECT count(*) FROM {dst_table}")).scalar_one())
    return {
        "source": source,
        "source_resolvable": resolvable,
        "dest": dest,
        "ok": resolvable == dest,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-url",
        default=os.environ.get("SOURCE_DATABASE_URL"),
        help="old TS Postgres URL (default: $SOURCE_DATABASE_URL)",
    )
    parser.add_argument(
        "--dest-url",
        default=os.environ.get("DATABASE_URL"),
        help="catalog Postgres URL (default: $DATABASE_URL)",
    )
    parser.add_argument("--migrate", action="store_true", help="run the migration")
    parser.add_argument(
        "--reconcile", action="store_true", help="print a source-vs-dest count report"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if not args.source_url or not args.dest_url:
        parser.error("both --source-url/$SOURCE_DATABASE_URL and "
                     "--dest-url/$DATABASE_URL are required")

    # Default behaviour: migrate then reconcile.
    do_migrate = args.migrate or not args.reconcile
    do_reconcile = args.reconcile or not args.migrate

    if do_migrate:
        migrate(args.source_url, args.dest_url)

    if do_reconcile:
        import json

        report = reconcile(args.source_url, args.dest_url)
        print(json.dumps(report, indent=2, default=str))
        if not report["all_ok"]:
            return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - manual entry point
    raise SystemExit(main())
