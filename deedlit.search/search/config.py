"""Environment-driven configuration for deedlit.search.

The search service talks to exactly one datastore: Qdrant (named dense+sparse
vectors, RRF hybrid). The only cross-service read it performs is pulling the
image catalog from deedlit.catalog during ``POST /rebuild``; it NEVER calls the
graph service and never writes back to catalog.

All values resolve from environment variables with local-dev defaults so the
same code runs locally, in docker-compose, and in CI.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# Dense vectors are deedlit.vision's vit_h CLIP embeddings: 1024-dim, cosine
# (the embeddings are L2-normalized, so cosine == dot product).
DENSE_DIM = 1024
DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "sparse"


def _env(key: str, fallback: str) -> str:
    value = os.environ.get(key)
    if value is None or value.strip() == "":
        return fallback
    return value.strip()


@dataclass(frozen=True)
class SearchConfig:
    qdrant_url: str
    collection: str
    catalog_url: str

    @property
    def dense_dim(self) -> int:
        return DENSE_DIM


def get_config() -> SearchConfig:
    """Resolve config fresh from the environment (no caching, so tests can
    point the service at a throwaway collection between app constructions)."""
    return SearchConfig(
        qdrant_url=_env("QDRANT_URL", "http://localhost:6333").rstrip("/"),
        collection=_env("QDRANT_COLLECTION", "images"),
        catalog_url=_env("CATALOG_URL", "http://localhost:8001").rstrip("/"),
    )
