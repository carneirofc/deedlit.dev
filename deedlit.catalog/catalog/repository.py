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
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from catalog.db import get_engine
from catalog.schemas import (
    AssetRef,
    Collection,
    Image,
    ImagePatch,
    ImageUpsert,
    Note,
    NoteUpsert,
    Params,
)

# ---------------------------------------------------------------------------
# images
# ---------------------------------------------------------------------------


def upsert_image(payload: ImageUpsert) -> Image:
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO images (
                    file_path, filename, sha256_hash, perceptual_hash,
                    width, height, source_tool, prompt, negative_prompt,
                    workflow_json, metadata_json
                ) VALUES (
                    :file_path, :filename, :sha256, :phash,
                    :width, :height, :source_tool, :prompt, :negative,
                    CAST(:workflow_json AS JSONB), CAST(:metadata_json AS JSONB)
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
                    modified_at     = now()
                """
            ),
            {
                "file_path": f"s3://images/{payload.sha256}",
                "filename": payload.sha256,
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
            },
        )

        if payload.tags:
            _set_tags(conn, payload.sha256, payload.tags)
        if payload.params is not None:
            _set_params(conn, payload.sha256, payload.params)
        if payload.references:
            _set_references(conn, payload.sha256, payload.references)

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
                SELECT id, sha256_hash, perceptual_hash, width, height,
                       source_tool, prompt, negative_prompt, rating, favorite,
                       workflow_json, metadata_json, imported_at
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

        metadata = row["metadata_json"] or {}
        api_prompt_json = (
            metadata.get("api_prompt_json") if isinstance(metadata, dict) else None
        )

        return Image(
            sha256=row["sha256_hash"],
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
            created_at=row["imported_at"],
        )


def list_images(
    *, tag: str | None, favorite: bool | None, limit: int, offset: int
) -> list[Image]:
    eng = get_engine()
    clauses = ["i.deleted = false"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    join = ""
    if tag is not None:
        join = (
            " JOIN image_tags it ON it.image_id = i.id"
            " JOIN tags t ON t.id = it.tag_id"
        )
        clauses.append("t.normalized_name = :tag")
        params["tag"] = _normalize_tag(tag)
    if favorite is not None:
        clauses.append("i.favorite = :favorite")
        params["favorite"] = favorite

    where = " AND ".join(clauses)
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT DISTINCT i.sha256_hash, i.imported_at
                FROM images i{join}
                WHERE {where}
                ORDER BY i.imported_at DESC
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
