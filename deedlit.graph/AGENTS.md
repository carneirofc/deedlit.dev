# deedlit.graph — Relationship Graph

## Purpose
- FastAPI service (port 8003): relationship graph over Neo4j — edges from shared references (checkpoint/lora/embedding/vae/controlnet/upscaler), tag co-occurrence, and lineage (variant/upscale/inpaint).

## Ownership
- Sole writer of the Neo4j graph (default `neo4j` database).
- A rebuildable projection of `catalog` truth: reads catalog only during `POST /rebuild`; never calls `search`.

## Local Contracts
- Canonical HTTP contract: [`../contracts/graph.openapi.yaml`](../contracts/graph.openapi.yaml).
- `app.py`: routes + `lifespan` that ensures MERGE lookup indexes (Tag.name / Image.sha256 / Asset.kind,key). Module: `graph/db.py` (Neo4j driver lifecycle), `models.py`, `repository.py` (graph model + name normalization), `rebuild.py` (httpx pull from catalog), `routers.py`.
- Endpoints: `POST /edges`, `POST /images/batch-delete`, `DELETE /images/{sha256}`, `GET /neighbors/{sha256}`, `GET /lineage/{sha256}`, `GET /related-tags/{tag}`, `GET /entities`, `POST /rebuild` (202), `POST /prune`.
- No SQL migrations — schema is Neo4j indexes ensured at startup via `repository.ensure_schema()`.

## Work Guidance
- Treat the graph as reconstructible from catalog; keep name-normalization rules in `repository.py` authoritative.

## Verification
- `uv run --directory deedlit.graph pytest`

## Child Guides
- None.
