"""Environment-driven configuration for the deedlit.catalog service.

All values come from environment variables with local-dev defaults so the same
code runs locally, in docker-compose, and in CI. The catalog service talks to
exactly two datastores: PostgreSQL (canonical source of truth) and a RustFS /
S3-compatible object store (thumbnails + cached embeddings). It NEVER talks to
Qdrant or Neo4j.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _env(key: str, fallback: str) -> str:
    value = os.environ.get(key)
    if value is None or value.strip() == "":
        return fallback
    return value.strip()


@dataclass(frozen=True)
class ObjectStoreConfig:
    endpoint: str
    region: str
    access_key: str
    secret_key: str
    bucket: str
    force_path_style: bool


@dataclass(frozen=True)
class CatalogConfig:
    database_url: str
    object_store: ObjectStoreConfig


def get_config() -> CatalogConfig:
    """Resolve config fresh from the environment (no caching, so tests can
    mutate env between app constructions)."""
    return CatalogConfig(
        database_url=_env(
            "DATABASE_URL",
            "postgresql+psycopg://imageapp:imageapp@localhost:5432/imageapp",
        ),
        object_store=ObjectStoreConfig(
            endpoint=_env("OBJECT_STORE_ENDPOINT", "http://localhost:9000"),
            region=_env("OBJECT_STORE_REGION", "us-east-1"),
            access_key=_env("OBJECT_STORE_ACCESS_KEY", "rustfsadmin"),
            secret_key=_env("OBJECT_STORE_SECRET_KEY", "rustfsadmin"),
            bucket=_env("OBJECT_STORE_BUCKET", "deedlit"),
            force_path_style=True,
        ),
    )
