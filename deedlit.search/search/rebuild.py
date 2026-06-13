"""Rebuild the Qdrant collection from the catalog service.

This is the ONLY cross-service read the search service performs. It pulls image
records from deedlit.catalog (``GET /images``) and upserts a point per image.

Each catalog item is expected to carry the vectors to index:
  - ``dense``  : list[float] (1024-dim CLIP embedding)
  - ``sparse`` : {indices, values} (optional SPLADE sparse vector)
  - ``payload``: optional extra payload to store alongside the point
Items without a ``dense`` vector are skipped (nothing to index on).

The catalog HTTP call is isolated in ``fetch_catalog_images`` so tests can mock
it without requiring a running catalog.
"""
from __future__ import annotations

from typing import Any

import httpx

from search.config import SearchConfig
from search.schemas import SparseVector
from search.store import SearchStore

# Pull the whole catalog in pages so a large library doesn't need one giant call.
PAGE_SIZE = 500


def fetch_catalog_images(config: SearchConfig) -> list[dict[str, Any]]:
    """Fetch all image records from the catalog service (paged)."""
    items: list[dict[str, Any]] = []
    offset = 0
    with httpx.Client(timeout=30.0) as client:
        while True:
            resp = client.get(
                f"{config.catalog_url}/images",
                params={"limit": PAGE_SIZE, "offset": offset},
            )
            resp.raise_for_status()
            page = resp.json()
            if not page:
                break
            items.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    return items


def _sparse_from(item: dict[str, Any]) -> SparseVector | None:
    sparse = item.get("sparse")
    if not sparse:
        return None
    return SparseVector(indices=sparse["indices"], values=sparse["values"])


def rebuild_from_catalog(store: SearchStore, config: SearchConfig) -> int:
    """Repopulate the collection from the catalog. Returns the count upserted.

    The collection is dropped and recreated so the rebuild is a clean,
    full repopulation (no stale points from a previous schema).
    """
    items = fetch_catalog_images(config)

    store.drop_collection()
    store.ensure_collection()

    upserted = 0
    for item in items:
        dense = item.get("dense")
        sha256 = item.get("sha256")
        if not dense or not sha256:
            continue
        store.upsert_point(
            sha256=sha256,
            dense=dense,
            sparse=_sparse_from(item),
            payload=item.get("payload") or {},
        )
        upserted += 1
    return upserted
