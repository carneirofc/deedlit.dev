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
import random
import re
import time
from typing import Any, Callable, TypeVar

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import OperationalError

from catalog.db import get_engine
from catalog.schemas import (
    AssetRef,
    Collection,
    DirectoryCount,
    FolderReport,
    Image,
    ImagePatch,
    ImageSummary,
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
# transaction helpers
# ---------------------------------------------------------------------------

_T = TypeVar("_T")

# Transient transaction failures worth retrying: deadlock_detected (40P01) and
# serialization_failure (40001). On both, Postgres has already rolled the whole
# transaction back, so re-running the unit of work from a fresh begin() is safe
# and normally succeeds once the contending transaction has committed.
_RETRYABLE_SQLSTATES = {"40P01", "40001"}


def _run_in_tx(fn: Callable[[Connection], _T], *, attempts: int = 5) -> _T:
    """Run ``fn(conn)`` inside one transaction, retrying the WHOLE transaction
    on a transient deadlock/serialization failure with exponential backoff.

    The callable must be idempotent across retries (every catalog upsert here is
    ``ON CONFLICT``-based, so it is). Concurrent tag ingest is ordered to avoid
    deadlocks in the first place (see ``_set_tags``); this is the backstop for
    any residual contention under heavy parallel ingest.
    """
    eng = get_engine()
    backoff = 0.05
    for attempt in range(1, attempts + 1):
        try:
            with eng.begin() as conn:
                return fn(conn)
        except OperationalError as exc:
            sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
            if sqlstate not in _RETRYABLE_SQLSTATES or attempt == attempts:
                raise
            time.sleep(backoff + random.uniform(0, backoff))
            backoff *= 2
    raise AssertionError("unreachable")  # loop returns or raises above


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


def _dirname(path: str) -> str:
    """Parent directory of a path, OS-agnostic (separators normalized to '/').

    Mirrors :func:`_basename`: ingest may pass Windows paths while the catalog
    runs on Linux. The catalog stores this as ``images.directory`` (the
    split-by-source-directory grouping key); SQL backfill in migration 0006 uses
    the same rule. Returns '' when the path has no separator."""
    norm = path.replace("\\", "/")
    idx = norm.rfind("/")
    return norm[:idx] if idx > 0 else ""


def upsert_image(payload: ImageUpsert) -> Image:
    def _tx(conn: Connection) -> None:
        conn.execute(
            text(
                """
                INSERT INTO images (
                    file_path, filename, directory, sha256_hash, perceptual_hash,
                    width, height, source_tool, prompt, negative_prompt,
                    workflow_json, metadata_json, safety, created_at
                ) VALUES (
                    :file_path, :filename, :directory, :sha256, :phash,
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
                # Parent directory grouping key. Derived from filepath, INSERT-only
                # (absent from the ON CONFLICT update above) like file_path/filename
                # so a reindex with no path never clobbers it.
                "directory": _dirname(payload.filepath) if payload.filepath else "",
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

    _run_in_tx(_tx)
    img = get_image(payload.sha256)
    assert img is not None
    return img


def _image_uuid(conn: Connection, sha256: str) -> str | None:
    row = conn.execute(
        text("SELECT id FROM images WHERE sha256_hash = :sha"),
        {"sha": sha256},
    ).first()
    return str(row[0]) if row else None


# The FULL image-row column list, used by the single-image detail fetch
# (get_image). Includes the heavy JSONB graph columns (workflow_json,
# metadata_json) and negative_prompt.
_IMAGE_COLUMNS = """
    id, sha256_hash, file_path, perceptual_hash, width, height,
    source_tool, prompt, negative_prompt, rating, favorite,
    safety, workflow_json, metadata_json, created_at, imported_at
"""

# The LIGHT column list for the browse list (list_images). Drops the two heavy
# JSONB graph columns (workflow_json, metadata_json) and negative_prompt — none
# are rendered on a grid card, and they dominate the row size (a full ComfyUI
# workflow graph is tens-to-hundreds of KB). A browse page of these is ~1 KB/row
# instead of ~100 KB/row. The full record (with those columns) is one
# GET /images/{sha256} away when a detail view opens.
_LIST_COLUMNS = """
    id, sha256_hash, file_path, directory, perceptual_hash, width, height,
    source_tool, prompt, rating, favorite, safety, created_at, imported_at
"""

# The LIGHT single-image column list (get_image light=True). Same as
# _IMAGE_COLUMNS but WITHOUT the two heavy JSONB graph columns (workflow_json,
# metadata_json/api_prompt_json). It keeps every curated scalar the detail panels
# render — including negative_prompt — plus the small tag/params/refs/description
# children. The Lightbox details panel, the detail page, and the per-image ingest
# stages read those light fields but never the workflow graphs, so they pull this
# instead of paying the ~100 KB JSONB on every (per-navigation) read. The full
# GET /images/{sha256} still serves the graphs for the raw-JSON inspector/export.
_DETAIL_LIGHT_COLUMNS = """
    id, sha256_hash, file_path, perceptual_hash, width, height,
    source_tool, prompt, negative_prompt, rating, favorite,
    safety, created_at, imported_at
"""


def _row_to_image(
    row: Any,
    *,
    tags: list[str],
    params: Params | None,
    references: list[AssetRef],
    description: str | None,
) -> Image:
    """Assemble an :class:`Image` from a raw image row + its already-loaded
    children. The single place the row→model mapping lives, so the per-image
    (:func:`get_image`) and batched (:func:`_hydrate_images`) paths agree."""
    # `.get()` (not `[...]`) so this also assembles a LIGHT row that omitted the
    # two heavy JSONB columns — there they read as None (see _DETAIL_LIGHT_COLUMNS).
    metadata = row.get("metadata_json") or {}
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
        workflow_json=row.get("workflow_json"),
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


def _row_to_summary(
    row: Any, *, tags: list[str], references: list[AssetRef]
) -> ImageSummary:
    """Assemble the lightweight browse :class:`ImageSummary` from a ``_LIST_COLUMNS``
    row + its (small) tag/reference children. No workflow/api-prompt/params/
    description — those ride only the full :class:`Image` from :func:`get_image`."""
    return ImageSummary(
        sha256=row["sha256_hash"],
        filepath=row["file_path"],
        directory=row["directory"],
        phash=row["perceptual_hash"],
        width=row["width"],
        height=row["height"],
        sourceTool=row["source_tool"],
        prompt=row["prompt"],
        tags=tags,
        references=references,
        rating=row["rating"],
        favorite=row["favorite"],
        safety=row["safety"],
        created_at=row["created_at"] or row["imported_at"],
        imported_at=row["imported_at"],
    )


def get_image(sha256: str, *, light: bool = False) -> Image | None:
    """Fetch one image's full record (the source of truth).

    ``light=True`` skips the two heavy JSONB graph columns (workflow_json,
    metadata_json/api_prompt_json) — see :data:`_DETAIL_LIGHT_COLUMNS` — for
    callers that render only curated fields (the detail panels) or read a couple
    of light fields (ingest projection), so a per-navigation detail fetch doesn't
    drag ~100 KB of workflow graph it never uses. The small tag/params/refs/
    description children are loaded either way."""
    eng = get_engine()
    columns = _DETAIL_LIGHT_COLUMNS if light else _IMAGE_COLUMNS
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT {columns} FROM images WHERE sha256_hash = :sha"),
            {"sha": sha256},
        ).mappings().first()
        if row is None:
            return None
        image_id = str(row["id"])
        return _row_to_image(
            row,
            tags=_get_tags(conn, image_id),
            params=_get_params(conn, image_id),
            references=_get_references(conn, sha256),
            description=_get_description(conn, image_id),
        )


def _hydrate_summaries(conn: Connection, rows: list[Any]) -> list[ImageSummary]:
    """Load the SUMMARY children (tags + references) for a PAGE of browse rows in
    two set-based queries instead of the per-image N+1.

    ``rows`` are ``_LIST_COLUMNS`` image-row mappings (must include ``id`` +
    ``sha256_hash``), in the desired output order. Only the children a grid card
    renders are loaded here: tags and asset references (for the checkpoint chip).
    The per-image generation_params and image_descriptions are deliberately NOT
    fetched — they belong to the full :class:`Image` (GET /images/{sha256}), so a
    browse page never pays for them. A page of 50 images is two round-trips.
    """
    if not rows:
        return []
    ids = [str(r["id"]) for r in rows]
    shas = [r["sha256_hash"] for r in rows]

    tag_rows = conn.execute(
        text(
            """
            SELECT it.image_id AS iid, t.name AS name
            FROM image_tags it JOIN tags t ON t.id = it.tag_id
            WHERE it.image_id IN :ids
            ORDER BY t.name
            """
        ).bindparams(bindparam("ids", expanding=True)),
        {"ids": ids},
    ).all()
    tags_by_id: dict[str, list[str]] = {}
    for iid, name in tag_rows:
        tags_by_id.setdefault(str(iid), []).append(name)

    ref_rows = conn.execute(
        text(
            "SELECT sha256, kind, name, hash FROM image_references "
            "WHERE sha256 IN :shas ORDER BY position, kind, name"
        ).bindparams(bindparam("shas", expanding=True)),
        {"shas": shas},
    ).mappings().all()
    refs_by_sha: dict[str, list[AssetRef]] = {}
    for r in ref_rows:
        refs_by_sha.setdefault(r["sha256"], []).append(
            AssetRef(kind=r["kind"], name=r["name"], hash=r["hash"])
        )

    return [
        _row_to_summary(
            r,
            tags=tags_by_id.get(str(r["id"]), []),
            references=refs_by_sha.get(r["sha256_hash"], []),
        )
        for r in rows
    ]


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
    path: str | None = None,
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
    needle = (path or "").strip()
    if needle:
        # Separator-insensitive SUBSTRING match over the on-disk path: lets the
        # caller filter by any folder/filename fragment regardless of the OS
        # separator the file was ingested with (Windows backslash vs forward
        # slash — see _folder_counts). strpos avoids the LIKE metacharacter /
        # escape pitfalls of the backslashes and %/_ that real paths contain.
        clauses.append(
            "strpos(lower(replace(i.file_path, '\\', '/')), lower(:path_q)) > 0"
        )
        params["path_q"] = needle.replace("\\", "/")

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
    path: str | None = None,
) -> list[ImageSummary]:
    """Browse the catalog with AND-combined filters and a whitelisted sort.

    Returns lightweight :class:`ImageSummary` rows (no workflow/api-prompt graphs,
    params, negative, or description) — the grid only needs the card fields, and
    the heavy columns dominated the page size. Open one image for its full record
    via :func:`get_image` (GET /images/{sha256}).

    `tags` matches images carrying EVERY listed tag; `exclude_tags` drops images
    carrying ANY of them. `path` keeps only images whose on-disk file path
    contains the given fragment (separator-insensitive). Tag membership uses
    correlated EXISTS subqueries so the row set never multiplies (no
    JOIN/DISTINCT) and the ORDER BY can reference the image columns directly.
    Unknown `sort` falls back to newest-first.
    """
    eng = get_engine()
    where, params = _image_filters(
        tags=tags,
        exclude_tags=exclude_tags,
        favorite=favorite,
        rating_gte=rating_gte,
        safety=safety,
        path=path,
    )
    params.update({"limit": limit, "offset": offset})
    order_by = _ORDER_BY.get(sort, _ORDER_BY["newest"])
    with eng.connect() as conn:
        # Select the LIGHT page of image rows up front (one query — no heavy JSONB
        # graph columns), then batch-load their summary children (tags +
        # references) in two more — see _hydrate_summaries. The old per-row
        # get_image() was an N+1: a 50-row page cost ~250 queries + 50 checkouts.
        rows = conn.execute(
            text(
                f"""
                SELECT {_LIST_COLUMNS}
                FROM images i
                WHERE {where}
                ORDER BY {order_by}
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
        return _hydrate_summaries(conn, list(rows))


def count_images(
    *,
    tags: list[str] | None = None,
    exclude_tags: list[str] | None = None,
    favorite: bool | None = None,
    rating_gte: int | None = None,
    safety: list[str] | None = None,
    path: str | None = None,
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
        path=path,
    )
    eng = get_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT count(*) AS n FROM images i WHERE {where}"), params
        ).first()
    return int(row[0]) if row else 0


def list_directories(*, limit: int = 2000) -> list[DirectoryCount]:
    """Distinct source directories with per-directory live-image counts.

    Backs the library's split-by-source-directory view: the grid groups its
    loaded page by ``directory`` but needs the TRUE total per folder for the
    section headers, which only a server-side aggregate can give. Soft-deleted
    rows are excluded (matching browse); the synthetic object-store fallback
    bucket (empty directory) is dropped. Ordered biggest-first so the most
    populated folders head the list, capped to bound the payload.
    """
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT directory, count(*) AS image_count
                FROM images
                WHERE deleted = false
                  AND directory IS NOT NULL
                  AND directory <> ''
                GROUP BY directory
                ORDER BY image_count DESC, directory ASC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [
        DirectoryCount(directory=r["directory"], image_count=int(r["image_count"]))
        for r in rows
    ]


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
    def _tx(conn: Connection) -> bool:
        if _image_uuid(conn, sha256) is None:
            return False
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
        return True

    if not _run_in_tx(_tx):
        return None
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


def delete_images(sha256s: list[str]) -> list[str]:
    """Hard-delete MANY images + their catalog-owned rows in ONE transaction.

    The batch counterpart to :func:`delete_image`: two SET-BASED deletes (asset
    references by sha, then the image rows — FK children cascade) instead of two
    queries per image, so un-indexing 100 images is 2 round-trips, not 200.
    Returns the sha256s that were actually present (``RETURNING``), so the caller
    cleans exactly their blobs and reports the misses. Curation refs
    (notes/collections) are left intact, mirroring :func:`delete_image`.
    """
    if not sha256s:
        return []
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text("DELETE FROM image_references WHERE sha256 IN :shas").bindparams(
                bindparam("shas", expanding=True)
            ),
            {"shas": sha256s},
        )
        rows = conn.execute(
            text(
                "DELETE FROM images WHERE sha256_hash IN :shas RETURNING sha256_hash"
            ).bindparams(bindparam("shas", expanding=True)),
            {"shas": sha256s},
        ).all()
    return [r[0] for r in rows]


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


# Danbooru/A1111 emphasis weight ("tag:1.2") + balanced/stray emphasis brackets
# ("(tag)", "((tag))", "[tag]") carry no tag identity. Stripping them so "(asd)",
# "(asd:12)" and "asd" collapse to ONE tag (same normalized_name). Mirrors
# deedlit.metadata.prompt_tags + deedlit.graph so every tag source agrees.
_TAG_WEIGHT_RE = re.compile(r":\s*\d+(?:\.\d+)?")
_TAG_LEAD_BRACKET_RE = re.compile(r"^[([{<]+")
_TAG_TRAIL_BRACKET_RE = re.compile(r"[)\]}>]+$")
_TAG_WS_RE = re.compile(r"\s+")
# Booru prompts separate tags by comma, newline, or the A1111 "BREAK" keyword.
_TAG_SPLIT_RE = re.compile(r"\bBREAK\b|[,\n\r]+")


def _clean_tag(name: str) -> str:
    """Cleaned DISPLAY form of a danbooru tag: drop emphasis weight + brackets,
    collapse whitespace. "(asd)"/"(asd:12)" -> "asd" (case + spaces preserved)."""
    t = _TAG_WEIGHT_RE.sub("", name.replace("\\", "")).strip()
    while t and t[0] in "([{<" and t[-1] in ")]}>":
        t = t[1:-1].strip()
    opens = sum(t.count(c) for c in "([{")
    closes = sum(t.count(c) for c in ")]}")
    if opens != closes:
        t = _TAG_TRAIL_BRACKET_RE.sub("", _TAG_LEAD_BRACKET_RE.sub("", t)).strip()
    return _TAG_WS_RE.sub(" ", t).strip()


def _split_tags(raw: str) -> list[str]:
    """Split a raw tag string on commas / newlines / the BREAK keyword."""
    return [p for p in _TAG_SPLIT_RE.split(raw) if p and p.strip()]


def _normalize_tag(name: str) -> str:
    """Identity key for a tag: cleaned, lowercased, spaces -> underscores. So
    "(asd)", "(asd:12)" and "asd" all share one normalized_name (and one tag)."""
    return _clean_tag(name).lower().replace(" ", "_")


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
    # Split each incoming value on comma / newline / BREAK, clean danbooru
    # weighting/brackets, and de-dupe by the normalized identity within this call,
    # keeping the first display form seen for each normalized name.
    pairs: dict[str, str] = {}
    for raw in tags:
        for piece in _split_tags(raw):
            norm = _normalize_tag(piece)
            if not norm or norm in pairs:
                continue
            pairs[norm] = _clean_tag(piece)
    if not pairs:
        return
    # Sort by normalized_name so every concurrent ingest transaction acquires
    # tag row/index locks in the SAME global order. Two workers upserting an
    # overlapping set of brand-new tags in opposite orders is exactly what
    # deadlocked here (Postgres 40P01); a deterministic order breaks the cycle.
    norms = sorted(pairs)
    names = [pairs[n] for n in norms]
    # One ordered batch upsert. DO NOTHING (not a no-op DO UPDATE) so already
    # existing tag rows are not needlessly row-locked. ORDER BY makes the insert
    # follow the sorted order inside the statement too.
    conn.execute(
        text(
            """
            INSERT INTO tags (name, normalized_name)
            SELECT name, normalized_name
            FROM unnest(cast(:names AS text[]), cast(:norms AS text[]))
                 AS t(name, normalized_name)
            ORDER BY normalized_name
            ON CONFLICT (normalized_name) DO NOTHING
            """
        ),
        {"names": names, "norms": norms},
    )
    # Link every (now-guaranteed-present) tag to the image in one statement,
    # resolving ids by normalized_name rather than round-tripping per tag.
    conn.execute(
        text(
            """
            INSERT INTO image_tags (image_id, tag_id, source)
            SELECT :iid, t.id, 'manual'
            FROM tags t
            WHERE t.normalized_name = ANY(cast(:norms AS text[]))
            ON CONFLICT (image_id, tag_id, source) DO NOTHING
            """
        ),
        {"iid": image_id, "norms": norms},
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
                WHERE i.safety IS NOT NULL
                  AND EXISTS (
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

        # Labeled = has a labelagent description AND a safety class. Mirrors the
        # backfill work set (list_unlabeled_sha256 = missing EITHER), so the
        # labeled/unlabeled split here stays consistent with what the sweep targets.
        labeled = conn.execute(
            text(
                """
                SELECT count(*) FROM images i
                WHERE i.deleted = false
                  AND i.safety IS NOT NULL
                  AND EXISTS (
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
    """sha256 of cataloged images that need (re)labeling by the AI agent.

    Targets images that are missing EITHER a description OR a safety class — the
    two fields the labelagent is responsible for. Using OR means:
      - images never labeled (no description, no safety) → new backfill work
      - images labeled before safety was added (0002 migration) that have a
        description but NULL safety → get relabeled to fill the gap

    Newest-first so a backfill prioritizes recent imports; paged like list_images.
    """
    eng = get_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT i.sha256_hash
                FROM images i
                WHERE i.deleted = false
                  AND (
                    i.safety IS NULL
                    OR NOT EXISTS (
                      SELECT 1 FROM image_descriptions d
                      WHERE d.image_id = i.id AND d.provider = :provider
                    )
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
