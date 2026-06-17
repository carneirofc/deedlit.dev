"""Data-access layer over the catalog Postgres schema.

Targets the exact ported table/column names from the #4 Alembic baseline
(``deedlit.catalog/alembic/versions/0001_catalog_baseline.py``). The ``images``
table has a UUID surrogate primary key plus a UNIQUE ``sha256_hash`` column; the
cross-service id is that full sha256 hex (see id-scheme/README.md), so every
catalog API operation is keyed on ``sha256_hash`` and upserts via
``ON CONFLICT (sha256_hash)``.

This layer touches ONLY Postgres. It never imports a Qdrant or Neo4j driver.
"""
from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from catalog.db import get_engine
from catalog.schemas import (
    AssetRef,
    Collection,
    FolderReport,
    Image,
    ImagePatch,
    ImageUpsert,
    Job,
    JobUpsert,
    Note,
    NoteUpsert,
    Params,
    SafetyBreakdown,
    Setting,
    SourceFolder,
    SourceFolderPatch,
    SourceFolderUpsert,
    StatsReport,
    TagCount,
    TagReport,
    Task,
    TaskUpsert,
)

# ---------------------------------------------------------------------------
# images
# ---------------------------------------------------------------------------


def _basename(path: str) -> str:
    """Last path segment, OS-agnostic.

    Ingest may run on Windows (backslash separators) while the catalog runs on
    Linux, so ``os.path.basename`` alone would not split a ``C:\\a\\b.png`` path.
    Normalize both separators before taking the final segment.
    """
    return os.path.basename(path.replace("\\", "/")) or path


def upsert_image(payload: ImageUpsert) -> Image:
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO images (
                    file_path, filename, sha256_hash, perceptual_hash,
                    width, height, source_tool, prompt, negative_prompt,
                    workflow_json, metadata_json, safety, created_at
                ) VALUES (
                    :file_path, :filename, :sha256, :phash,
                    :width, :height, :source_tool, :prompt, :negative,
                    CAST(:workflow_json AS JSONB), CAST(:metadata_json AS JSONB), :safety,
                    :created_at
                )
                ON CONFLICT (sha256_hash) DO UPDATE SET
                    perceptual_hash = COALESCE(EXCLUDED.perceptual_hash, images.perceptual_hash),
                    width           = COALESCE(EXCLUDED.width, images.width),
                    height          = COALESCE(EXCLUDED.height, images.height),
                    source_tool     = COALESCE(EXCLUDED.source_tool, images.source_tool),
                    prompt          = COALESCE(EXCLUDED.prompt, images.prompt),
                    negative_prompt = COALESCE(EXCLUDED.negative_prompt, images.negative_prompt),
                    workflow_json   = COALESCE(EXCLUDED.workflow_json, images.workflow_json),
                    metadata_json   = COALESCE(EXCLUDED.metadata_json, images.metadata_json),
                    -- Re-derivable AI classification: refresh when re-ingest
                    -- supplies one, keep the existing value when it doesn't.
                    safety          = COALESCE(EXCLUDED.safety, images.safety),
                    modified_at     = now()
                """
            ),
            {
                # Original source path of the file when ingest captured it, so a
                # human can identify the image (the cross-service id is the
                # opaque sha256). Falls back to the object-store URI when the
                # path is unknown. Both columns are NOT NULL and set INSERT-only
                # (absent from the ON CONFLICT update below), so a later reindex
                # — which has no original path — never clobbers the real one.
                "file_path": payload.filepath or f"s3://images/{payload.sha256}",
                "filename": _basename(payload.filepath) if payload.filepath else payload.sha256,
                "sha256": payload.sha256,
                "phash": payload.phash,
                "width": payload.width,
                "height": payload.height,
                "source_tool": payload.sourceTool,
                "prompt": payload.prompt,
                "negative": payload.negative,
                "workflow_json": json.dumps(payload.workflow_json)
                if payload.workflow_json is not None
                else None,
                "metadata_json": json.dumps({"api_prompt_json": payload.api_prompt_json})
                if payload.api_prompt_json is not None
                else None,
                "safety": payload.safety,
                # INSERT-only (absent from the ON CONFLICT update above) so a
                # reindex from stored bytes — which carries no mtime — never
                # clobbers the creation time captured on first ingest.
                "created_at": payload.createdAt,
            },
        )

        if payload.tags:
            _set_tags(conn, payload.sha256, payload.tags)
        if payload.params is not None:
            _set_params(conn, payload.sha256, payload.params)
        if payload.references:
            _set_references(conn, payload.sha256, payload.references)
        # Only persist a description when one is supplied — a reindex with the
        # labelagent off carries None and must NOT wipe the existing (expensive)
        # one, mirroring the COALESCE behavior of the scalar columns above.
        if payload.description:
            _set_description(conn, payload.sha256, payload.description)

    img = get_image(payload.sha256)
    assert img is not None
    return img


def _image_uuid(conn: Connection, sha256: str) -> str | None:
    row = conn.execute(
        text("SELECT id FROM images WHERE sha256_hash = :sha"),
        {"sha": sha256},
    ).first()
    return str(row[0]) if row else None


def get_image(sha256: str) -> Image | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, sha256_hash, file_path, perceptual_hash, width, height,
                       source_tool, prompt, negative_prompt, rating, favorite,
                       safety, workflow_json, metadata_json, created_at, imported_at
                FROM images WHERE sha256_hash = :sha
                """
            ),
            {"sha": sha256},
        ).mappings().first()
        if row is None:
            return None

        image_id = str(row["id"])
        tags = _get_tags(conn, image_id)
        params = _get_params(conn, image_id)
        references = _get_references(conn, sha256)
        description = _get_description(conn, image_id)

        metadata = row["metadata_json"] or {}
        api_prompt_json = (
            metadata.get("api_prompt_json") if isinstance(metadata, dict) else None
        )

        return Image(
            sha256=row["sha256_hash"],
            filepath=row["file_path"],
            phash=row["perceptual_hash"],
            width=row["width"],
            height=row["height"],
            sourceTool=row["source_tool"],
            prompt=row["prompt"],
            negative=row["negative_prompt"],
            tags=tags,
            params=params,
            references=references,
            workflow_json=row["workflow_json"],
            api_prompt_json=api_prompt_json,
            rating=row["rating"],
            favorite=row["favorite"],
            safety=row["safety"],
            description=description,
            # created_at = captured file mtime; fall back to the import time for
            # rows ingested before mtime capture existed (keeps it non-null).
            created_at=row["created_at"] or row["imported_at"],
            imported_at=row["imported_at"],
        )


# Browse sort orders. WHITELISTED: the `sort` key is looked up here and never
# interpolated from caller input, so the ORDER BY clause can be safely embedded
# in the SQL string. `name_*` sorts by the OS-agnostic basename of file_path
# (strip everything up to the last / or \) so "name" means filename, not folder.
#
# Every clause ENDS in `i.sha256_hash` — a unique key — so the order is TOTAL.
# Without it, ties on the primary key (a bulk ingest stamps many rows with the
# same `imported_at`; ratings/names collide freely) leave row order undefined,
# and LIMIT/OFFSET paging over an undefined order repeats some rows on the next
# page and skips others. That surfaced as duplicate React keys in the grid.
_NAME_EXPR = r"lower(regexp_replace(i.file_path, '^.*[/\\]', ''))"
# `newest`/`oldest` order by INGESTION time (imported_at); `created_*` order by
# the source file's CREATION time, coalescing to imported_at for rows whose mtime
# was never captured so legacy images interleave sensibly instead of sinking last.
_CREATED_EXPR = "COALESCE(i.created_at, i.imported_at)"
_ORDER_BY: dict[str, str] = {
    "newest": "i.imported_at DESC, i.sha256_hash DESC",
    "oldest": "i.imported_at ASC, i.sha256_hash ASC",
    "created_desc": f"{_CREATED_EXPR} DESC, i.sha256_hash DESC",
    "created_asc": f"{_CREATED_EXPR} ASC, i.sha256_hash ASC",
    "rating_desc": "i.rating DESC NULLS LAST, i.imported_at DESC, i.sha256_hash DESC",
    "rating_asc": "i.rating ASC NULLS LAST, i.imported_at DESC, i.sha256_hash DESC",
    "name_asc": f"{_NAME_EXPR} ASC, i.imported_at DESC, i.sha256_hash DESC",
    "name_desc": f"{_NAME_EXPR} DESC, i.imported_at DESC, i.sha256_hash DESC",
}


def _image_filters(
    *,
    tags: list[str] | None,
    exclude_tags: list[str] | None,
    favorite: bool | None,
    rating_gte: int | None,
    safety: list[str] | None,
) -> tuple[str, dict[str, Any]]:
    """Build the shared WHERE clause + bind params for the browse filters.

    Used by both ``list_images`` (paged rows) and ``count_images`` (the matching
    total for the report/export tooling), so the two never drift. Tag membership
    uses correlated EXISTS subqueries so the row set never multiplies (no
    JOIN/DISTINCT) and a count is an honest one-row-per-image tally.
    """
    clauses = ["i.deleted = false"]
    params: dict[str, Any] = {}

    # Include tags — image must carry EVERY requested tag (AND semantics).
    for idx, tag in enumerate(tags or []):
        key = f"tag{idx}"
        clauses.append(
            f"EXISTS (SELECT 1 FROM image_tags it{idx}"
            f" JOIN tags tg{idx} ON tg{idx}.id = it{idx}.tag_id"
            f" WHERE it{idx}.image_id = i.id AND tg{idx}.normalized_name = :{key})"
        )
        params[key] = _normalize_tag(tag)

    # Exclude tags — image must carry NONE of these.
    for idx, tag in enumerate(exclude_tags or []):
        key = f"xtag{idx}"
        clauses.append(
            f"NOT EXISTS (SELECT 1 FROM image_tags xt{idx}"
            f" JOIN tags xg{idx} ON xg{idx}.id = xt{idx}.tag_id"
            f" WHERE xt{idx}.image_id = i.id AND xg{idx}.normalized_name = :{key})"
        )
        params[key] = _normalize_tag(tag)

    if favorite is not None:
        clauses.append("i.favorite = :favorite")
        params["favorite"] = favorite
    if rating_gte is not None:
        clauses.append("i.rating >= :rating_gte")
        params["rating_gte"] = rating_gte
    if safety:
        # Multi-select content-safety filter: keep rows whose class is among the
        # requested set. Unclassified (NULL) rows are excluded by an explicit
        # filter, which is what the UI's "show these classes" chips intend.
        clauses.append("i.safety = ANY(:safety)")
        params["safety"] = list(safety)

    return " AND ".join(clauses), params


def list_images(
    *,
    tags: list[str] | None = None,
    exclude_tags: list[str] | None = None,
    favorite: bool | None = None,
    rating_gte: int | None = None,
    limit: int,
    offset: int,
    safety: list[str] | None = None,
    sort: str = "newest",
) -> list[Image]:
    """Browse the catalog with AND-combined filters and a whitelisted sort.

    `tags` matches images carrying EVERY listed tag; `exclude_tags` drops images
    carrying ANY of them. Tag membership uses correlated EXISTS subqueries so the
    row set never multiplies (no JOIN/DISTINCT) and the ORDER BY can reference the
    image columns directly. Unknown `sort` falls back to newest-first.
    """
    eng = get_engine()
    where, params = _image_filters(
        tags=tags,
        exclude_tags=exclude_tags,
        favorite=favorite,
        rating_gte=rating_gte,
        safety=safety,
    )
    params.update({"limit": limit, "offset": offset})
    order_by = _ORDER_BY.get(sort, _ORDER_BY["newest"])
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT i.sha256_hash
                FROM images i
                WHERE {where}
                ORDER BY {order_by}
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    out: list[Image] = []
    for r in rows:
        img = get_image(r["sha256_hash"])
        if img is not None:
            out.append(img)
    return out


def count_images(
    *,
    tags: list[str] | None = None,
    exclude_tags: list[str] | None = None,
    favorite: bool | None = None,
    rating_gte: int | None = None,
    safety: list[str] | None = None,
) -> int:
    """Total images matching the same filters as ``list_images``.

    Lets a report/export tool size the work set (how many pages of GET /images to
    pull) without walking every page. Shares ``_image_filters`` with the browse
    list so the count can never disagree with what listing returns.
    """
    where, params = _image_filters(
        tags=tags,
        exclude_tags=exclude_tags,
        favorite=favorite,
        rating_gte=rating_gte,
        safety=safety,
    )
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT count(*) AS n FROM images i WHERE {where}"), params
        ).first()
    return int(row[0]) if row else 0


def suggest_tags(*, prefix: str, limit: int) -> list[str]:
    """Tag names matching ``prefix`` (case-insensitive), most-used first.

    Backs the filter autocomplete: matches on ``normalized_name`` (so "red eyes"
    and "red_eyes" behave the same) and ranks by how many distinct images carry
    each tag, so common tags surface first. An empty prefix returns the globally
    most-used tags. The prefix is escaped so a literal ``_``/``%`` in a tag name
    is not treated as a LIKE wildcard.
    """
    eng = get_engine()
    norm = _normalize_tag(prefix)
    params: dict[str, Any] = {"limit": limit}
    where = ""
    if norm:
        escaped = norm.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where = "WHERE t.normalized_name LIKE :pfx ESCAPE '\\'"
        params["pfx"] = f"{escaped}%"
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT t.name
                FROM tags t
                LEFT JOIN image_tags it ON it.tag_id = t.id
                {where}
                GROUP BY t.id, t.name, t.normalized_name
                ORDER BY COUNT(DISTINCT it.image_id) DESC, t.normalized_name ASC
                LIMIT :limit
                """
            ),
            params,
        ).all()
    return [r[0] for r in rows]


def tag_report(*, prefix: str = "", limit: int, offset: int) -> TagReport:
    """Full tag inventory with per-tag image counts, paged.

    Unlike ``suggest_tags`` (a capped autocomplete that returns bare names), this
    is the report surface: every tag, its display + normalized name, and how many
    distinct non-deleted images carry it, ordered most-used first. ``total`` is
    the count of tags matching the (optional) prefix so a tool can page the whole
    inventory. The prefix is escaped so a literal ``_``/``%`` is not a wildcard.
    """
    eng = get_engine()
    norm = _normalize_tag(prefix)
    where = ""
    bind: dict[str, Any] = {}
    if norm:
        escaped = norm.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where = "WHERE t.normalized_name LIKE :pfx ESCAPE '\\'"
        bind["pfx"] = f"{escaped}%"
    with eng.connect() as conn:
        total = conn.execute(
            text(f"SELECT count(*) FROM tags t {where}"), bind
        ).scalar_one()
        rows = conn.execute(
            text(
                f"""
                SELECT t.name, t.normalized_name,
                       count(DISTINCT it.image_id) FILTER (
                           WHERE i.id IS NOT NULL AND i.deleted = false
                       ) AS image_count
                FROM tags t
                LEFT JOIN image_tags it ON it.tag_id = t.id
                LEFT JOIN images i ON i.id = it.image_id
                {where}
                GROUP BY t.id, t.name, t.normalized_name
                ORDER BY image_count DESC, t.normalized_name ASC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**bind, "limit": limit, "offset": offset},
        ).mappings().all()
    items = [
        TagCount(
            name=r["name"],
            normalized_name=r["normalized_name"],
            image_count=int(r["image_count"] or 0),
        )
        for r in rows
    ]
    return TagReport(total=int(total), items=items)


def patch_image(sha256: str, patch: ImagePatch) -> Image | None:
    eng = get_engine()
    with eng.begin() as conn:
        if _image_uuid(conn, sha256) is None:
            return None
        sets = []
        params: dict[str, Any] = {"sha": sha256}
        if patch.rating is not None:
            sets.append("rating = :rating")
            params["rating"] = patch.rating
        if patch.favorite is not None:
            sets.append("favorite = :favorite")
            params["favorite"] = patch.favorite
        if patch.safety is not None:
            sets.append("safety = :safety")
            params["safety"] = patch.safety
        if patch.prompt is not None:
            sets.append("prompt = :prompt")
            params["prompt"] = patch.prompt
        if patch.negative is not None:
            sets.append("negative_prompt = :negative")
            params["negative"] = patch.negative
        if sets:
            conn.execute(
                text(
                    f"UPDATE images SET {', '.join(sets)}, modified_at = now() "
                    "WHERE sha256_hash = :sha"
                ),
                params,
            )
        if patch.tags is not None:
            _set_tags(conn, sha256, patch.tags, replace=True)
    return get_image(sha256)


def delete_image(sha256: str) -> bool:
    """Hard-delete an image and its catalog-owned rows. False if it was absent.

    The image row's FK children (image_tags, generation_params, image_loras,
    image_variants, image_descriptions) cascade via ``ON DELETE CASCADE``.
    ``image_references`` is keyed by the cross-service sha256 (no FK to
    ``images.id``), so it is removed explicitly here. Note / collection
    membership refs are *user curation* — also keyed by sha256, but intentionally
    left intact so a later re-ingest re-attaches the image to the same notes and
    collections. Blob cleanup is the caller's concern (see the router).
    """
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text("DELETE FROM image_references WHERE sha256 = :sha"),
            {"sha": sha256},
        )
        res = conn.execute(
            text("DELETE FROM images WHERE sha256_hash = :sha"),
            {"sha": sha256},
        )
        return res.rowcount > 0


def set_rating(sha256: str, rating: int) -> bool:
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text(
                "UPDATE images SET rating = :rating, modified_at = now() "
                "WHERE sha256_hash = :sha"
            ),
            {"rating": rating, "sha": sha256},
        )
        return res.rowcount > 0


def set_favorite(sha256: str, favorite: bool) -> bool:
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text(
                "UPDATE images SET favorite = :favorite, modified_at = now() "
                "WHERE sha256_hash = :sha"
            ),
            {"favorite": favorite, "sha": sha256},
        )
        return res.rowcount > 0


# ---------------------------------------------------------------------------
# tags
# ---------------------------------------------------------------------------


def _normalize_tag(name: str) -> str:
    return name.strip().lower().replace(" ", "_")


def _set_tags(
    conn: Connection, sha256: str, tags: list[str], *, replace: bool = False
) -> None:
    image_id = _image_uuid(conn, sha256)
    if image_id is None:
        return
    if replace:
        conn.execute(
            text(
                "DELETE FROM image_tags WHERE image_id = :iid AND source = 'manual'"
            ),
            {"iid": image_id},
        )
    for name in tags:
        norm = _normalize_tag(name)
        if not norm:
            continue
        tag_row = conn.execute(
            text(
                """
                INSERT INTO tags (name, normalized_name)
                VALUES (:name, :norm)
                ON CONFLICT (normalized_name) DO UPDATE SET name = tags.name
                RETURNING id
                """
            ),
            {"name": name, "norm": norm},
        ).first()
        tag_id = tag_row[0]
        conn.execute(
            text(
                """
                INSERT INTO image_tags (image_id, tag_id, source)
                VALUES (:iid, :tid, 'manual')
                ON CONFLICT (image_id, tag_id, source) DO NOTHING
                """
            ),
            {"iid": image_id, "tid": tag_id},
        )


def _get_tags(conn: Connection, image_id: str) -> list[str]:
    rows = conn.execute(
        text(
            """
            SELECT t.name
            FROM image_tags it JOIN tags t ON t.id = it.tag_id
            WHERE it.image_id = :iid
            ORDER BY t.name
            """
        ),
        {"iid": image_id},
    ).all()
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# generation params
# ---------------------------------------------------------------------------


def _set_params(conn: Connection, sha256: str, params: Params) -> None:
    image_id = _image_uuid(conn, sha256)
    if image_id is None:
        return
    conn.execute(
        text(
            """
            INSERT INTO generation_params (
                image_id, seed, steps, cfg_scale, sampler, scheduler,
                denoise, width, height, clip_skip
            ) VALUES (
                :iid, :seed, :steps, :cfg, :sampler, :scheduler,
                :denoise, :width, :height, :clipskip
            )
            ON CONFLICT (image_id) DO UPDATE SET
                seed = EXCLUDED.seed, steps = EXCLUDED.steps,
                cfg_scale = EXCLUDED.cfg_scale, sampler = EXCLUDED.sampler,
                scheduler = EXCLUDED.scheduler, denoise = EXCLUDED.denoise,
                width = EXCLUDED.width, height = EXCLUDED.height,
                clip_skip = EXCLUDED.clip_skip
            """
        ),
        {
            "iid": image_id,
            "seed": params.seed,
            "steps": params.steps,
            "cfg": params.cfg,
            "sampler": params.sampler,
            "scheduler": params.scheduler,
            "denoise": params.denoise,
            "width": params.width,
            "height": params.height,
            "clipskip": params.clipskip,
        },
    )


def _get_params(conn: Connection, image_id: str) -> Params | None:
    row = conn.execute(
        text(
            """
            SELECT seed, steps, cfg_scale, sampler, scheduler, denoise,
                   width, height, clip_skip
            FROM generation_params WHERE image_id = :iid
            """
        ),
        {"iid": image_id},
    ).mappings().first()
    if row is None:
        return None
    return Params(
        seed=row["seed"],
        steps=row["steps"],
        cfg=row["cfg_scale"],
        sampler=row["sampler"],
        scheduler=row["scheduler"],
        denoise=row["denoise"],
        clipskip=row["clip_skip"],
        width=row["width"],
        height=row["height"],
    )


# ---------------------------------------------------------------------------
# references (keyed by sha256 directly)
# ---------------------------------------------------------------------------


def _set_references(conn: Connection, sha256: str, refs: list[AssetRef]) -> None:
    conn.execute(
        text("DELETE FROM image_references WHERE sha256 = :sha"),
        {"sha": sha256},
    )
    for pos, ref in enumerate(refs):
        conn.execute(
            text(
                """
                INSERT INTO image_references (sha256, kind, name, hash, position)
                VALUES (:sha, :kind, :name, :hash, :pos)
                ON CONFLICT (sha256, kind, name) DO UPDATE SET
                    hash = EXCLUDED.hash, position = EXCLUDED.position
                """
            ),
            {
                "sha": sha256,
                "kind": ref.kind,
                "name": ref.name,
                "hash": ref.hash,
                "pos": pos,
            },
        )


def _get_references(conn: Connection, sha256: str) -> list[AssetRef]:
    rows = conn.execute(
        text(
            "SELECT kind, name, hash FROM image_references "
            "WHERE sha256 = :sha ORDER BY position, kind, name"
        ),
        {"sha": sha256},
    ).mappings().all()
    return [AssetRef(kind=r["kind"], name=r["name"], hash=r["hash"]) for r in rows]


# ---------------------------------------------------------------------------
# descriptions (AI enrichment, kept in image_descriptions — separate from the
# canonical images row)
# ---------------------------------------------------------------------------

# The producing system for AI descriptions; recorded as the provenance
# ``provider`` so a future second source (or a manual description) is
# distinguishable and replaceable independently.
_DESCRIPTION_PROVIDER = "deedlit.labelagent"


def _set_description(
    conn: Connection, sha256: str, description: str, *, provider: str = _DESCRIPTION_PROVIDER
) -> None:
    """Store the latest AI description for an image (one row per provider).

    The table has no natural unique key, so a re-ingest would otherwise pile up
    duplicate rows on every run. We keep a single current description per
    provider: drop the prior one, then insert. This makes a reindex REFRESH the
    description (matching the scalar columns' COALESCE-on-supply semantics)
    rather than accumulate history.
    """
    image_id = _image_uuid(conn, sha256)
    if image_id is None:
        return
    conn.execute(
        text(
            "DELETE FROM image_descriptions "
            "WHERE image_id = :iid AND provider = :provider"
        ),
        {"iid": image_id, "provider": provider},
    )
    conn.execute(
        text(
            """
            INSERT INTO image_descriptions (image_id, description, provider)
            VALUES (:iid, :description, :provider)
            """
        ),
        {"iid": image_id, "description": description, "provider": provider},
    )


def _get_description(conn: Connection, image_id: str) -> str | None:
    """Return the most recent description text for an image, or None."""
    row = conn.execute(
        text(
            "SELECT description FROM image_descriptions "
            "WHERE image_id = :iid ORDER BY created_at DESC LIMIT 1"
        ),
        {"iid": image_id},
    ).first()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# notes
# ---------------------------------------------------------------------------


def create_note(payload: NoteUpsert) -> Note:
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text(
                """
                INSERT INTO notes (title, positive, negative, blocks)
                VALUES (:title, :positive, :negative, CAST(:blocks AS JSONB))
                RETURNING id, created_at
                """
            ),
            {
                "title": payload.title,
                "positive": payload.positive,
                "negative": payload.negative,
                "blocks": json.dumps(payload.blocks),
            },
        ).mappings().first()
        note_id = str(row["id"])
        _set_note_refs(conn, note_id, payload.imageRefs)
    note = get_note(note_id)
    assert note is not None
    return note


def update_note(note_id: str, payload: NoteUpsert) -> Note | None:
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text(
                """
                UPDATE notes SET title = :title, positive = :positive,
                    negative = :negative, blocks = CAST(:blocks AS JSONB),
                    updated_at = now()
                WHERE id = :id
                """
            ),
            {
                "id": note_id,
                "title": payload.title,
                "positive": payload.positive,
                "negative": payload.negative,
                "blocks": json.dumps(payload.blocks),
            },
        )
        if res.rowcount == 0:
            return None
        _set_note_refs(conn, note_id, payload.imageRefs)
    return get_note(note_id)


def _set_note_refs(conn: Connection, note_id: str, refs: list[str]) -> None:
    conn.execute(
        text("DELETE FROM note_image_refs WHERE note_id = :nid"),
        {"nid": note_id},
    )
    for pos, sha in enumerate(refs):
        conn.execute(
            text(
                "INSERT INTO note_image_refs (note_id, sha256, position) "
                "VALUES (:nid, :sha, :pos)"
            ),
            {"nid": note_id, "sha": sha, "pos": pos},
        )


def get_note(note_id: str) -> Note | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(
                "SELECT id, title, positive, negative, blocks, created_at "
                "FROM notes WHERE id = :id"
            ),
            {"id": note_id},
        ).mappings().first()
        if row is None:
            return None
        refs = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT sha256 FROM note_image_refs WHERE note_id = :nid "
                    "ORDER BY position"
                ),
                {"nid": note_id},
            ).all()
        ]
        return Note(
            id=str(row["id"]),
            title=row["title"],
            positive=row["positive"],
            negative=row["negative"],
            blocks=row["blocks"],
            imageRefs=refs,
            created_at=row["created_at"],
        )


def export_note(note_id: str) -> Note | None:
    """Return the full note payload for export (same shape as get_note)."""
    return get_note(note_id)


def notes_by_image(sha256: str) -> list[Note]:
    eng = get_engine()
    with eng.connect() as conn:
        ids = [
            str(r[0])
            for r in conn.execute(
                text(
                    "SELECT DISTINCT note_id FROM note_image_refs WHERE sha256 = :sha"
                ),
                {"sha": sha256},
            ).all()
        ]
    return [n for nid in ids if (n := get_note(nid)) is not None]


# ---------------------------------------------------------------------------
# collections
# ---------------------------------------------------------------------------


def create_collection(name: str, images: list[str]) -> Collection:
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text("INSERT INTO collections (name) VALUES (:name) RETURNING id"),
            {"name": name},
        ).first()
        cid = str(row[0])
        _set_collection_images(conn, cid, images)
    col = get_collection(cid)
    assert col is not None
    return col


def list_collections() -> list[Collection]:
    eng = get_engine()
    with eng.connect() as conn:
        ids = [
            str(r[0])
            for r in conn.execute(
                text("SELECT id FROM collections ORDER BY created_at DESC")
            ).all()
        ]
    return [c for cid in ids if (c := get_collection(cid)) is not None]


def get_collection(cid: str) -> Collection | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text("SELECT id, name FROM collections WHERE id = :id"),
            {"id": cid},
        ).mappings().first()
        if row is None:
            return None
        images = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT sha256 FROM collection_images WHERE collection_id = :cid "
                    "ORDER BY position"
                ),
                {"cid": cid},
            ).all()
        ]
        return Collection(id=str(row["id"]), name=row["name"], images=images)


def rename_collection(cid: str, name: str) -> Collection | None:
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text(
                "UPDATE collections SET name = :name, updated_at = now() "
                "WHERE id = :id"
            ),
            {"name": name, "id": cid},
        )
        if res.rowcount == 0:
            return None
    return get_collection(cid)


def delete_collection(cid: str) -> bool:
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text("DELETE FROM collections WHERE id = :id"), {"id": cid}
        )
        return res.rowcount > 0


def collections_by_image(sha256: str) -> list[Collection]:
    eng = get_engine()
    with eng.connect() as conn:
        ids = [
            str(r[0])
            for r in conn.execute(
                text(
                    "SELECT DISTINCT collection_id FROM collection_images "
                    "WHERE sha256 = :sha"
                ),
                {"sha": sha256},
            ).all()
        ]
    return [c for cid in ids if (c := get_collection(cid)) is not None]


def set_collection_images(cid: str, images: list[str]) -> bool:
    eng = get_engine()
    with eng.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM collections WHERE id = :id"), {"id": cid}
        ).first()
        if exists is None:
            return False
        _set_collection_images(conn, cid, images)
        return True


def _set_collection_images(conn: Connection, cid: str, images: list[str]) -> None:
    conn.execute(
        text("DELETE FROM collection_images WHERE collection_id = :cid"),
        {"cid": cid},
    )
    for pos, sha in enumerate(images):
        conn.execute(
            text(
                "INSERT INTO collection_images (collection_id, sha256, position) "
                "VALUES (:cid, :sha, :pos)"
            ),
            {"cid": cid, "sha": sha, "pos": pos},
        )


# ---------------------------------------------------------------------------
# source folders — the configured-ingest-folder registry (#folders feature).
#
# image_count / labeled_count are DERIVED on read from images.file_path prefixes
# (+ the labelagent description provider), not stored, so there is no folder_id
# on images to keep in sync. Paths are compared separator-insensitively
# (ingest may run on Windows and store backslash paths while the folder was
# registered with forward slashes, or vice-versa).
# ---------------------------------------------------------------------------


def _folder_counts(conn: Connection, path: str) -> tuple[int, int]:
    """Return ``(image_count, labeled_count)`` for images under ``path``.

    ``starts_with`` (PG11+) avoids LIKE metacharacter/escape issues with the
    backslashes and ``%``/``_`` that real Windows paths contain. Both sides are
    normalized to forward slashes so a folder registered with one separator
    still matches files ingested with the other.
    """
    row = conn.execute(
        text(
            """
            SELECT
              count(*) AS image_count,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM image_descriptions d
                  WHERE d.image_id = i.id AND d.provider = :provider
                )
              ) AS labeled_count
            FROM images i
            WHERE i.deleted = false
              AND starts_with(replace(i.file_path, '\\', '/'), replace(:path, '\\', '/'))
            """
        ),
        {"path": path, "provider": _DESCRIPTION_PROVIDER},
    ).mappings().first()
    if row is None:
        return 0, 0
    return int(row["image_count"] or 0), int(row["labeled_count"] or 0)


def _folder_from_row(conn: Connection, row: Any) -> SourceFolder:
    image_count, labeled_count = _folder_counts(conn, row["path"])
    return SourceFolder(
        id=str(row["id"]),
        path=row["path"],
        label=row["label"],
        enabled=row["enabled"],
        recursive=row["recursive"],
        scan_interval_seconds=row["scan_interval_seconds"],
        last_scan_at=row["last_scan_at"],
        last_scan_status=row["last_scan_status"],
        last_scan_job_id=row["last_scan_job_id"],
        last_error=row["last_error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        image_count=image_count,
        labeled_count=labeled_count,
        unlabeled_count=max(image_count - labeled_count, 0),
    )


_FOLDER_COLUMNS = (
    "id, path, label, enabled, recursive, scan_interval_seconds, "
    "last_scan_at, last_scan_status, last_scan_job_id, last_error, "
    "created_at, updated_at"
)


def create_folder(payload: SourceFolderUpsert) -> SourceFolder:
    """Register a folder. Re-adding the same path updates its settings (the
    UNIQUE(path) makes this idempotent rather than a 409)."""
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text(
                f"""
                INSERT INTO source_folders
                    (path, label, enabled, recursive, scan_interval_seconds)
                VALUES (:path, :label, :enabled, :recursive, :interval)
                ON CONFLICT (path) DO UPDATE SET
                    label = EXCLUDED.label,
                    enabled = EXCLUDED.enabled,
                    recursive = EXCLUDED.recursive,
                    scan_interval_seconds = EXCLUDED.scan_interval_seconds,
                    updated_at = now()
                RETURNING {_FOLDER_COLUMNS}
                """
            ),
            {
                "path": payload.path,
                "label": payload.label,
                "enabled": payload.enabled,
                "recursive": payload.recursive,
                "interval": payload.scan_interval_seconds,
            },
        ).mappings().first()
        return _folder_from_row(conn, row)


def list_folders() -> list[SourceFolder]:
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_FOLDER_COLUMNS} FROM source_folders "
                "ORDER BY created_at DESC"
            )
        ).mappings().all()
        return [_folder_from_row(conn, r) for r in rows]


def folder_reports() -> list[FolderReport]:
    """Per-folder coverage report: path, label, and image/labeled/unlabeled
    counts for every registered source folder.

    A trimmed projection of ``list_folders`` (drops the scan-config/scan-state
    noise) so a reporting tool gets just the where-are-my-images-and-are-they-
    labeled breakdown. Reuses the same derived counts, so it never disagrees with
    the folders admin view.
    """
    return [
        FolderReport(
            path=f.path,
            label=f.label,
            image_count=f.image_count,
            labeled_count=f.labeled_count,
            unlabeled_count=f.unlabeled_count,
        )
        for f in list_folders()
    ]


def get_folder(folder_id: str) -> SourceFolder | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT {_FOLDER_COLUMNS} FROM source_folders WHERE id = :id"),
            {"id": folder_id},
        ).mappings().first()
        if row is None:
            return None
        return _folder_from_row(conn, row)


def patch_folder(folder_id: str, patch: SourceFolderPatch) -> SourceFolder | None:
    """Apply a partial update. Supplied fields are written; ``touch_last_scan_at``
    stamps ``last_scan_at`` to the catalog clock (the ingest scheduler uses this
    to record when a scan started/finished)."""
    eng = get_engine()
    sets: list[str] = []
    params: dict[str, Any] = {"id": folder_id}
    for field in (
        "label",
        "enabled",
        "recursive",
        "scan_interval_seconds",
        "last_scan_status",
        "last_scan_job_id",
        "last_error",
    ):
        value = getattr(patch, field)
        if value is not None:
            sets.append(f"{field} = :{field}")
            params[field] = value
    if patch.touch_last_scan_at:
        sets.append("last_scan_at = now()")
    with eng.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM source_folders WHERE id = :id"), {"id": folder_id}
        ).first()
        if exists is None:
            return None
        if sets:
            conn.execute(
                text(
                    f"UPDATE source_folders SET {', '.join(sets)}, updated_at = now() "
                    "WHERE id = :id"
                ),
                params,
            )
    return get_folder(folder_id)


def delete_folder(folder_id: str) -> bool:
    """Remove a folder from the registry. Does NOT delete its images — they stay
    cataloged (the registry is just the scan config)."""
    eng = get_engine()
    with eng.begin() as conn:
        res = conn.execute(
            text("DELETE FROM source_folders WHERE id = :id"), {"id": folder_id}
        )
        return res.rowcount > 0


# ---------------------------------------------------------------------------
# library stats — the aggregate report (backs gateway GET /stats).
# ---------------------------------------------------------------------------
def library_stats() -> StatsReport:
    """One-shot aggregate counts over the catalog (the report summary).

    All counts exclude soft-deleted images. ``safety`` breaks the live images
    down by content-safety class (``unclassified`` = NULL safety); ``labeled`` /
    ``unlabeled`` split them by whether a deedlit.labelagent description exists.
    Computed in a single round-trip of small aggregate queries.
    """
    eng = get_engine()
    with eng.connect() as conn:
        images = conn.execute(
            text("SELECT count(*) FROM images WHERE deleted = false")
        ).scalar_one()
        favorites = conn.execute(
            text("SELECT count(*) FROM images WHERE deleted = false AND favorite = true")
        ).scalar_one()
        tags = conn.execute(text("SELECT count(*) FROM tags")).scalar_one()
        collections = conn.execute(text("SELECT count(*) FROM collections")).scalar_one()
        notes = conn.execute(text("SELECT count(*) FROM notes")).scalar_one()
        folders = conn.execute(text("SELECT count(*) FROM source_folders")).scalar_one()

        # Content-safety histogram over live images; NULL -> unclassified.
        safety_rows = conn.execute(
            text(
                """
                SELECT COALESCE(safety, 'unclassified') AS klass, count(*) AS n
                FROM images WHERE deleted = false
                GROUP BY COALESCE(safety, 'unclassified')
                """
            )
        ).mappings().all()
        counts = {r["klass"]: int(r["n"]) for r in safety_rows}
        safety = SafetyBreakdown(
            sfw=counts.get("sfw", 0),
            nsfw=counts.get("nsfw", 0),
            explicit=counts.get("explicit", 0),
            unclassified=counts.get("unclassified", 0),
        )

        # Labeled = has a labelagent description; the rest of the live set is the
        # backfill work (mirrors list_unlabeled_sha256 / folder coverage).
        labeled = conn.execute(
            text(
                """
                SELECT count(*) FROM images i
                WHERE i.deleted = false AND EXISTS (
                    SELECT 1 FROM image_descriptions d
                    WHERE d.image_id = i.id AND d.provider = :provider
                )
                """
            ),
            {"provider": _DESCRIPTION_PROVIDER},
        ).scalar_one()

    return StatsReport(
        images=int(images),
        tags=int(tags),
        collections=int(collections),
        notes=int(notes),
        folders=int(folders),
        favorites=int(favorites),
        labeled=int(labeled),
        unlabeled=max(int(images) - int(labeled), 0),
        safety=safety,
    )


# ---------------------------------------------------------------------------
# tasks — the async queue ledger (ADR 0001).
#
# Best-effort history projection of the per-image index/label tasks. One row per
# (sha256, type), UPSERTed to its latest lifecycle state; the broker remains the
# source of truth for outstanding work.
# ---------------------------------------------------------------------------
_TASK_COLUMNS = (
    "id, sha256, type, status, attempts, error, parent_op_id, created_at, updated_at"
)


def _task_from_row(row: Any) -> Task:
    return Task(
        id=str(row["id"]),
        sha256=row["sha256"],
        type=row["type"],
        status=row["status"],
        attempts=int(row["attempts"] or 0),
        error=row["error"],
        parent_op_id=row["parent_op_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def upsert_task(payload: TaskUpsert) -> Task:
    """Record a lifecycle transition for ``(sha256, type)``, upserting one row.

    ``attempts`` keeps the existing value when not supplied (publishers don't
    reset the retry chain); ``error`` is written as given (null clears it on
    success); ``parent_op_id`` is sticky (a later update without one keeps the
    original producer).
    """
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text(
                f"""
                INSERT INTO tasks (sha256, type, status, attempts, error, parent_op_id)
                VALUES (:sha256, :type, :status, COALESCE(:attempts, 0), :error, :parent_op_id)
                ON CONFLICT (sha256, type) DO UPDATE SET
                    status = EXCLUDED.status,
                    attempts = COALESCE(:attempts, tasks.attempts),
                    error = EXCLUDED.error,
                    parent_op_id = COALESCE(EXCLUDED.parent_op_id, tasks.parent_op_id),
                    updated_at = now()
                RETURNING {_TASK_COLUMNS}
                """
            ),
            {
                "sha256": payload.sha256,
                "type": payload.type,
                "status": payload.status,
                "attempts": payload.attempts,
                "error": payload.error,
                "parent_op_id": payload.parent_op_id,
            },
        ).mappings().first()
        return _task_from_row(row)


def list_tasks(
    *,
    sha256: str | None = None,
    type: str | None = None,
    status: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[Task]:
    """List tasks (newest-updated first), filtered by sha256/type/status."""
    clauses: list[str] = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if sha256:
        clauses.append("sha256 = :sha256")
        params["sha256"] = sha256
    if type:
        clauses.append("type = :type")
        params["type"] = type
    if status:
        clauses.append("status = :status")
        params["status"] = status
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_TASK_COLUMNS} FROM tasks {where} "
                "ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).mappings().all()
        return [_task_from_row(r) for r in rows]


def get_task(task_id: str) -> Task | None:
    """Fetch a single task by row id, or None (also None on a malformed id)."""
    eng = get_engine()
    try:
        with eng.connect() as conn:
            row = conn.execute(
                text(f"SELECT {_TASK_COLUMNS} FROM tasks WHERE id = :id"),
                {"id": task_id},
            ).mappings().first()
    except Exception:  # malformed UUID etc. -> treat as not found
        return None
    return _task_from_row(row) if row is not None else None


def list_unlabeled_sha256(limit: int, offset: int) -> list[str]:
    """sha256 of cataloged images with no labelagent description — the set the
    label-backfill sweep relabels. Newest-first so a backfill prioritizes recent
    imports; paged like list_images."""
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT i.sha256_hash
                FROM images i
                WHERE i.deleted = false
                  AND NOT EXISTS (
                    SELECT 1 FROM image_descriptions d
                    WHERE d.image_id = i.id AND d.provider = :provider
                  )
                ORDER BY i.imported_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"provider": _DESCRIPTION_PROVIDER, "limit": limit, "offset": offset},
        ).all()
        return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# jobs — durable projection of the ingest JobStore (coarse ops).
#
# ingest write-throughs each job snapshot here best-effort and hydrates the list
# back on restart; the in-memory worker stays the source of truth for live
# progress. UPSERT keyed on the ingest-supplied ``id``.
# ---------------------------------------------------------------------------
_JOB_COLUMNS = (
    "id, type, status, folder_path, source_folder_id, total, done, skipped, "
    "failed, error, current_stage, stage_counts, report, created_at, "
    "started_at, finished_at, updated_at"
)


def _job_from_row(row: Any) -> Job:
    return Job(
        id=str(row["id"]),
        type=row["type"],
        status=row["status"],
        folder_path=row["folder_path"],
        source_folder_id=row["source_folder_id"],
        total=int(row["total"] or 0),
        done=int(row["done"] or 0),
        skipped=int(row["skipped"] or 0),
        failed=int(row["failed"] or 0),
        error=row["error"],
        current_stage=row["current_stage"],
        # JSONB round-trips as a dict already; coerce defensively.
        stage_counts=row["stage_counts"] or {},
        report=row["report"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        updated_at=row["updated_at"],
    )


def upsert_job(payload: JobUpsert) -> Job:
    """Upsert one job row to its latest snapshot (ON CONFLICT (id)).

    Timestamps are sticky: ``created_at`` is INSERT-only, and ``started_at`` /
    ``finished_at`` keep an existing non-null value when the incoming snapshot
    omits it, so an out-of-order write can't blank a lifecycle stamp.
    """
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text(
                f"""
                INSERT INTO jobs (
                    id, type, status, folder_path, source_folder_id,
                    total, done, skipped, failed, error, current_stage,
                    stage_counts, report, started_at, finished_at
                ) VALUES (
                    :id, :type, :status, :folder_path, :source_folder_id,
                    :total, :done, :skipped, :failed, :error, :current_stage,
                    CAST(:stage_counts AS JSONB), CAST(:report AS JSONB),
                    :started_at, :finished_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    type = EXCLUDED.type,
                    status = EXCLUDED.status,
                    folder_path = COALESCE(EXCLUDED.folder_path, jobs.folder_path),
                    source_folder_id =
                        COALESCE(EXCLUDED.source_folder_id, jobs.source_folder_id),
                    total = EXCLUDED.total,
                    done = EXCLUDED.done,
                    skipped = EXCLUDED.skipped,
                    failed = EXCLUDED.failed,
                    error = EXCLUDED.error,
                    current_stage = EXCLUDED.current_stage,
                    stage_counts = EXCLUDED.stage_counts,
                    report = COALESCE(EXCLUDED.report, jobs.report),
                    started_at = COALESCE(EXCLUDED.started_at, jobs.started_at),
                    finished_at = COALESCE(EXCLUDED.finished_at, jobs.finished_at),
                    updated_at = now()
                RETURNING {_JOB_COLUMNS}
                """
            ),
            {
                "id": payload.id,
                "type": payload.type,
                "status": payload.status,
                "folder_path": payload.folder_path,
                "source_folder_id": payload.source_folder_id,
                "total": payload.total,
                "done": payload.done,
                "skipped": payload.skipped,
                "failed": payload.failed,
                "error": payload.error,
                "current_stage": payload.current_stage,
                "stage_counts": json.dumps(payload.stage_counts or {}),
                "report": json.dumps(payload.report) if payload.report is not None else None,
                "started_at": payload.started_at,
                "finished_at": payload.finished_at,
            },
        ).mappings().first()
        return _job_from_row(row)


def list_jobs(*, limit: int = 200, offset: int = 0) -> list[Job]:
    """List jobs (newest-updated first) — backs the ingest restart hydrate."""
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_JOB_COLUMNS} FROM jobs "
                "ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
            ),
            {"limit": limit, "offset": offset},
        ).mappings().all()
        return [_job_from_row(r) for r in rows]


def get_job(job_id: str) -> Job | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT {_JOB_COLUMNS} FROM jobs WHERE id = :id"),
            {"id": job_id},
        ).mappings().first()
    return _job_from_row(row) if row is not None else None


def interrupt_stale_jobs() -> list[str]:
    """Flip every job still ``queued``/``running`` to ``interrupted``.

    Called by ingest on startup: a job in those states belongs to a previous
    process whose in-memory worker is gone, so it can never settle on its own.
    Returns the ids it changed (stamps ``finished_at`` so the UI shows it ended).
    """
    eng = get_engine()
    with eng.begin() as conn:
        rows = conn.execute(
            text(
                """
                UPDATE jobs
                   SET status = 'interrupted',
                       finished_at = COALESCE(finished_at, now()),
                       updated_at = now()
                 WHERE status IN ('queued', 'running')
                RETURNING id
                """
            )
        ).all()
        return [str(r[0]) for r in rows]


# ---------------------------------------------------------------------------
# settings — generic key/value store (one JSON blob per key).
# ---------------------------------------------------------------------------
def get_setting(key: str) -> Setting | None:
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text("SELECT key, value, updated_at FROM settings WHERE key = :key"),
            {"key": key},
        ).mappings().first()
    if row is None:
        return None
    return Setting(key=row["key"], value=row["value"] or {}, updated_at=row["updated_at"])


def put_setting(key: str, value: dict[str, Any]) -> Setting:
    eng = get_engine()
    with eng.begin() as conn:
        row = conn.execute(
            text(
                """
                INSERT INTO settings (key, value)
                VALUES (:key, CAST(:value AS JSONB))
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = now()
                RETURNING key, value, updated_at
                """
            ),
            {"key": key, "value": json.dumps(value or {})},
        ).mappings().first()
        return Setting(key=row["key"], value=row["value"] or {}, updated_at=row["updated_at"])
