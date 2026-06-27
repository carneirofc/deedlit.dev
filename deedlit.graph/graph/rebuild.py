"""Rebuild the graph projection from the catalog service.

The catalog (env ``CATALOG_URL``, default http://localhost:8001) is the source of
truth. ``rebuild_from_catalog`` reads every image (with its references, tags and
lineage) and re-upserts the edges. The HTTP call is isolated here so tests can
mock it without a running catalog.

Catalog read contract (best-effort, tolerant of shape): ``GET /images`` returns a
list of image objects, each carrying ``sha256``, ``references`` (AssetRef list),
``tags`` (string list), and optionally ``lineage`` ([{parent, kind}]). Pagination
via ``limit``/``offset`` is followed until a short/empty page is returned.
"""
from __future__ import annotations

import httpx

from graph.config import get_config
from graph.models import AssetRef, EdgeUpsert, LineageRef
from graph.repository import ensure_schema, upsert_edges

_PAGE = 200


def _fetch_images(client: httpx.Client, base_url: str) -> list[dict]:
    images: list[dict] = []
    offset = 0
    while True:
        resp = client.get(
            f"{base_url}/images", params={"limit": _PAGE, "offset": offset}
        )
        resp.raise_for_status()
        body = resp.json()
        page = body if isinstance(body, list) else body.get("images", [])
        if not page:
            break
        images.extend(page)
        if len(page) < _PAGE:
            break
        offset += len(page)
    return images


def _to_edge(image: dict) -> EdgeUpsert:
    references = [
        AssetRef(kind=r["kind"], name=r["name"], hash=r.get("hash"))
        for r in (image.get("references") or [])
    ]
    lineage = [
        LineageRef(parent=l["parent"], kind=l["kind"])
        for l in (image.get("lineage") or [])
    ]
    return EdgeUpsert(
        sha256=image["sha256"],
        references=references,
        tags=list(image.get("tags") or []),
        lineage=lineage,
    )


def rebuild_from_catalog(client: httpx.Client | None = None) -> dict:
    """Read all images from the catalog and upsert their edges. Returns counts."""
    cfg = get_config()
    own_client = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        ensure_schema()  # MERGE lookup indexes before the bulk rebuild
        images = _fetch_images(client, cfg.catalog_url)
        upserted = 0
        for image in images:
            upsert_edges(_to_edge(image))
            upserted += 1
        return {"images": len(images), "edges_upserted": upserted}
    finally:
        if own_client:
            client.close()
