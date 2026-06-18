"""Graph persistence + queries over Neo4j.

GRAPH MODEL
-----------
Nodes:
  (:Image {sha256})            one per generated image, keyed by content hash
  (:Asset {kind, key, name})   a model/resource an image USES (checkpoint, lora,
                               embedding, vae, controlnet, upscaler)
  (:Tag {name})                a normalized tag

Relationships:
  (:Image)-[:USES]->(:Asset)               image references an asset
  (:Image)-[:TAGGED]->(:Tag)               image carries a tag
  (:Image)-[:DERIVED_FROM {kind}]->(:Image) lineage edge to a PARENT image,
                               kind in {variant, upscale, inpaint}

SHARES_ASSET / tag co-occurrence are NOT materialized. "Neighbors by shared
asset" and "related tags" are computed by traversal at query time (image -> asset
-> other image; tag -> image -> other tag). This keeps upserts cheap and the
projection always consistent, at the cost of a slightly heavier read query.

ASSET IDENTITY / NAME NORMALIZATION
-----------------------------------
ComfyUI assets usually have no hash, so an Asset's identity key is:
  - ("h:" + lowercased hash)            when a hash is present, else
  - ("n:" + normalized name)            keyed on the normalized NAME.
Two refs of the same kind that normalize to the same name (and both lack a hash)
collapse to a single Asset node. Normalization (`normalize_name`):
  - take the basename (strip any '/' or '\\' path components),
  - drop a single trailing file extension (e.g. ".safetensors", ".ckpt", ".pt"),
  - lowercase and strip surrounding whitespace.
So "SD/Foo.safetensors", "foo.ckpt", and "  FOO  " all normalize to "foo".
The original (first-seen) name is retained on the node as `name` for display;
matching/merging is always on (kind, key).
"""
from __future__ import annotations

import os
import re
from typing import Iterable

from neo4j import Driver

from graph.db import get_database, get_driver
from graph.models import AssetRef, EdgeUpsert, LineageRef


def normalize_name(name: str) -> str:
    """Normalize an asset name for identity: basename, no extension, lowercased."""
    base = os.path.basename(name.replace("\\", "/").strip())
    root, _ext = os.path.splitext(base)
    return (root or base).strip().lower()


# Danbooru/A1111 emphasis weight (e.g. "tag:1.2") and balanced/stray emphasis
# brackets ("(tag)", "((tag))", "[tag]") carry no tag identity. Stripping them so
# "(asd)", "(asd:12)" and "asd" all collapse to the SAME Tag node. Mirrors
# deedlit.metadata.prompt_tags._clean_prompt_tag so every tag source (prompt / AI
# labeller / manual edit) agrees on the canonical tag.
_TAG_WEIGHT_RE = re.compile(r":\s*\d+(?:\.\d+)?")
_TAG_LEAD_BRACKET_RE = re.compile(r"^[([{<]+")
_TAG_TRAIL_BRACKET_RE = re.compile(r"[)\]}>]+$")
_TAG_WS_RE = re.compile(r"\s+")


def clean_tag(raw: str) -> str:
    """Canonical lowercased danbooru tag: drop emphasis weight + emphasis brackets.

    "(asd)", "(asd:12)", "((asd))", "[asd]" -> "asd". Empty string when nothing is
    left. Used as the :Tag node identity so a weighted and unweighted spelling of
    the same booru tag never split into separate nodes."""
    t = _TAG_WEIGHT_RE.sub("", raw.replace("\\", "")).strip()
    while t and t[0] in "([{<" and t[-1] in ")]}>":
        t = t[1:-1].strip()
    opens = sum(t.count(c) for c in "([{")
    closes = sum(t.count(c) for c in ")]}")
    if opens != closes:
        t = _TAG_TRAIL_BRACKET_RE.sub("", _TAG_LEAD_BRACKET_RE.sub("", t)).strip()
    return _TAG_WS_RE.sub(" ", t).strip().lower()


# Lookup indexes the ingest MERGE path relies on. Without them every
# MERGE (:Tag {name}) / (:Asset {kind,key}) / (:Image {sha256}) is a FULL LABEL
# SCAN — O(nodes) per upserted tag/asset — which is the dominant write cost (and
# the lag) once the graph grows. Created idempotently; community-edition safe
# (plain indexes, not enterprise node-key constraints).
_SCHEMA_STATEMENTS = (
    "CREATE INDEX image_sha256 IF NOT EXISTS FOR (i:Image) ON (i.sha256)",
    "CREATE INDEX tag_name IF NOT EXISTS FOR (t:Tag) ON (t.name)",
    "CREATE INDEX asset_kind_key IF NOT EXISTS FOR (a:Asset) ON (a.kind, a.key)",
)


def ensure_schema() -> None:
    """Create the MERGE lookup indexes (idempotent). Call on startup / before a
    rebuild. Cheap when they already exist; turns the per-tag full scan into a seek."""
    with _driver().session(database=get_database()) as session:
        for stmt in _SCHEMA_STATEMENTS:
            session.run(stmt).consume()


def asset_key(ref: AssetRef) -> str:
    """Stable identity key for an asset: hash if present, else normalized name."""
    if ref.hash:
        return "h:" + ref.hash.strip().lower()
    return "n:" + normalize_name(ref.name)


def _driver() -> Driver:
    return get_driver()


def upsert_edges(edge: EdgeUpsert) -> dict:
    """Upsert the image node plus all USES / TAGGED / DERIVED_FROM edges."""
    references = [
        {"kind": r.kind, "name": r.name, "key": asset_key(r)} for r in edge.references
    ]
    tags = sorted({c for t in edge.tags if (c := clean_tag(t))})
    lineage = [{"parent": l.parent, "kind": l.kind} for l in edge.lineage]

    query = """
    MERGE (img:Image {sha256: $sha256})
    WITH img
    // assets
    CALL (img) {
        UNWIND $references AS ref
        MERGE (a:Asset {kind: ref.kind, key: ref.key})
          ON CREATE SET a.name = ref.name
        MERGE (img)-[:USES]->(a)
        RETURN count(*) AS _assets
    }
    // tags
    CALL (img) {
        UNWIND $tags AS tname
        MERGE (t:Tag {name: tname})
        MERGE (img)-[:TAGGED]->(t)
        RETURN count(*) AS _tags
    }
    // lineage (parent images may not be upserted yet — MERGE creates the stub)
    CALL (img) {
        UNWIND $lineage AS lin
        MERGE (p:Image {sha256: lin.parent})
        MERGE (img)-[d:DERIVED_FROM]->(p)
          SET d.kind = lin.kind
        RETURN count(*) AS _lineage
    }
    RETURN size($references) AS assets, size($tags) AS tags, size($lineage) AS lineage
    """
    params = {
        "sha256": edge.sha256,
        "references": references,
        "tags": tags,
        "lineage": lineage,
    }
    with _driver().session(database=get_database()) as session:
        # Managed write transaction: auto-retries transient errors / deadlocks
        # (which Neo4j throws under concurrent MERGE load) — see the driver perf
        # guide. The result is consumed inside the tx function.
        rec = session.execute_write(lambda tx: tx.run(query, **params).single())
        return {
            "sha256": edge.sha256,
            "assets": rec["assets"],
            "tags": rec["tags"],
            "lineage": rec["lineage"],
        }


def _edge_payload(edge: EdgeUpsert) -> dict:
    """Normalize one EdgeUpsert into the {sha256, references, tags, lineage} row
    shape the batched UNWIND query consumes (same normalization as upsert_edges)."""
    return {
        "sha256": edge.sha256,
        "references": [
            {"kind": r.kind, "name": r.name, "key": asset_key(r)} for r in edge.references
        ],
        "tags": sorted({c for t in edge.tags if (c := clean_tag(t))}),
        "lineage": [{"parent": ln.parent, "kind": ln.kind} for ln in edge.lineage],
    }


def upsert_edges_batch(edges: list[EdgeUpsert]) -> list[dict]:
    """Upsert MANY images' edges in ONE Neo4j transaction (UNWIND over the batch).

    The batch counterpart to :func:`upsert_edges`: the index.graph worker pool
    POSTs one /edges per image, and the service's micro-batcher coalesces the
    concurrent calls into this single transaction instead of one write tx per
    image — the dominant Neo4j write cost during bulk ingest / rebuild / reconcile,
    which otherwise floods Neo4j and starves the read queries the UI makes
    (neighbors / lineage / related-tags). Returns one result dict per input edge,
    in order. Idempotent (all MERGE), mirroring the per-image path.
    """
    if not edges:
        return []
    batch = [_edge_payload(e) for e in edges]
    query = """
    UNWIND $batch AS item
    MERGE (img:Image {sha256: item.sha256})
    WITH img, item
    CALL (img, item) {
        UNWIND item.references AS ref
        MERGE (a:Asset {kind: ref.kind, key: ref.key})
          ON CREATE SET a.name = ref.name
        MERGE (img)-[:USES]->(a)
    }
    CALL (img, item) {
        UNWIND item.tags AS tname
        MERGE (t:Tag {name: tname})
        MERGE (img)-[:TAGGED]->(t)
    }
    CALL (img, item) {
        UNWIND item.lineage AS lin
        MERGE (p:Image {sha256: lin.parent})
        MERGE (img)-[d:DERIVED_FROM]->(p)
          SET d.kind = lin.kind
    }
    RETURN item.sha256 AS sha256,
           size(item.references) AS assets,
           size(item.tags) AS tags,
           size(item.lineage) AS lineage
    """
    with _driver().session(database=get_database()) as session:
        # Managed write transaction (auto-retry transient/deadlock) for the whole
        # coalesced batch — one round-trip + retry boundary for many images.
        rows = session.execute_write(lambda tx: tx.run(query, batch=batch).data())
    return [
        {"sha256": r["sha256"], "assets": r["assets"], "tags": r["tags"], "lineage": r["lineage"]}
        for r in rows
    ]


def delete_image(sha256: str) -> int:
    """Remove an image node and all its edges (DETACH DELETE). Idempotent.

    Returns the number of Image nodes deleted (0 when it was not in the graph).
    Asset / Tag nodes are intentionally left in place: they may still be USED /
    TAGGED by other images. Any that are now orphaned are harmless and can be
    pruned by a rebuild-from-catalog or a future sweep.
    """
    q = """
    MATCH (img:Image {sha256: $sha256})
    DETACH DELETE img
    RETURN count(*) AS deleted
    """
    with _driver().session(database=get_database()) as session:
        rec = session.execute_write(lambda tx: tx.run(q, sha256=sha256).single())
        return int(rec["deleted"]) if rec else 0


def delete_images(sha256s: list[str]) -> int:
    """Remove MANY image nodes + their edges in ONE query (DETACH DELETE).

    The batch counterpart to :func:`delete_image`: a single ``WHERE sha256 IN``
    Cypher for the whole set instead of one round-trip per image. Asset/Tag nodes
    are left in place (still used by other images). Returns the count deleted.
    """
    if not sha256s:
        return 0
    q = """
    MATCH (img:Image) WHERE img.sha256 IN $shas
    DETACH DELETE img
    RETURN count(*) AS deleted
    """
    with _driver().session(database=get_database()) as session:
        rec = session.execute_write(lambda tx: tx.run(q, shas=sha256s).single())
        return int(rec["deleted"]) if rec else 0


def neighbors(sha256: str, relation: str = "any", limit: int = 24) -> list[dict]:
    """Related images by shared asset and/or tag co-occurrence (traversal)."""
    results: dict[str, dict] = {}

    if relation in ("shared_asset", "any"):
        q = """
        MATCH (i:Image {sha256: $sha256})-[:USES]->(a:Asset)<-[:USES]-(o:Image)
        WHERE o.sha256 <> $sha256
        RETURN o.sha256 AS sha256, count(DISTINCT a) AS weight
        ORDER BY weight DESC, sha256
        LIMIT $limit
        """
        with _driver().session(database=get_database()) as session:
            for rec in session.run(q, sha256=sha256, limit=limit):
                results[rec["sha256"]] = {
                    "sha256": rec["sha256"],
                    "relation": "shared_asset",
                    "weight": float(rec["weight"]),
                }

    if relation in ("tag_cooccurrence", "any"):
        q = """
        MATCH (i:Image {sha256: $sha256})-[:TAGGED]->(t:Tag)<-[:TAGGED]-(o:Image)
        WHERE o.sha256 <> $sha256
        RETURN o.sha256 AS sha256, count(DISTINCT t) AS weight
        ORDER BY weight DESC, sha256
        LIMIT $limit
        """
        with _driver().session(database=get_database()) as session:
            for rec in session.run(q, sha256=sha256, limit=limit):
                existing = results.get(rec["sha256"])
                if existing is None:
                    results[rec["sha256"]] = {
                        "sha256": rec["sha256"],
                        "relation": "tag_cooccurrence",
                        "weight": float(rec["weight"]),
                    }
                else:
                    # appears under both relations
                    existing["relation"] = "shared_asset+tag_cooccurrence"
                    existing["weight"] = (existing["weight"] or 0) + float(rec["weight"])

    ordered = sorted(
        results.values(), key=lambda n: (-(n["weight"] or 0), n["sha256"])
    )
    return ordered[:limit]


def lineage(sha256: str) -> list[dict]:
    """Full variant/upscale/inpaint chain: ancestors and descendants of the image."""
    q = """
    MATCH (i:Image {sha256: $sha256})-[:DERIVED_FROM*1..]->(anc:Image)
    RETURN DISTINCT anc.sha256 AS sha256, 'ancestor' AS relation
    UNION
    MATCH (desc:Image)-[:DERIVED_FROM*1..]->(i:Image {sha256: $sha256})
    RETURN DISTINCT desc.sha256 AS sha256, 'descendant' AS relation
    """
    seen: dict[str, dict] = {}
    with _driver().session(database=get_database()) as session:
        for rec in session.run(q, sha256=sha256):
            sha = rec["sha256"]
            if sha and sha != sha256 and sha not in seen:
                seen[sha] = {"sha256": sha, "relation": rec["relation"], "weight": None}
    return list(seen.values())


def related_tags(tag: str, limit: int = 24) -> list[dict]:
    """Tags that co-occur (share an image) with the given tag, by frequency."""
    norm = tag.strip().lower()
    q = """
    MATCH (t:Tag {name: $tag})<-[:TAGGED]-(i:Image)-[:TAGGED]->(o:Tag)
    WHERE o.name <> $tag
    RETURN o.name AS tag, count(DISTINCT i) AS weight
    ORDER BY weight DESC, tag
    LIMIT $limit
    """
    with _driver().session(database=get_database()) as session:
        return [
            {"tag": rec["tag"], "weight": float(rec["weight"])}
            for rec in session.run(q, tag=norm, limit=limit)
        ]


def wipe_all() -> None:
    """Delete every node + relationship. Used by tests for isolation."""
    with _driver().session(database=get_database()) as session:
        session.run("MATCH (n) DETACH DELETE n")


def upsert_many(edges: Iterable[EdgeUpsert]) -> int:
    count = 0
    for edge in edges:
        upsert_edges(edge)
        count += 1
    return count
