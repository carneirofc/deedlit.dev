"""Runtime configuration for deedlit.graph.

All values come from the environment with the docker-compose defaults baked in so
the service runs out of the box against the repo's ``docker compose up neo4j``.
Tests may override ``NEO4J_DATABASE`` to isolate a throwaway database and
``CATALOG_URL`` to point ``/rebuild`` at a mock.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    neo4j_database: str
    catalog_url: str


def get_config() -> Config:
    return Config(
        neo4j_uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        neo4j_user=os.environ.get("NEO4J_USER", "neo4j"),
        neo4j_password=os.environ.get("NEO4J_PASSWORD", "password"),
        # The community edition only ships the default "neo4j" database, so we
        # scope everything to it and rely on label/property cleanup in tests.
        neo4j_database=os.environ.get("NEO4J_DATABASE", "neo4j"),
        catalog_url=os.environ.get("CATALOG_URL", "http://localhost:8001").rstrip("/"),
    )
