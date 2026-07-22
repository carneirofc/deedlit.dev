# deedlit.catalog — Canonical Catalog

## Purpose
- FastAPI service (port 8001): the source of truth for the image library — images, tags, params, references, ratings/favorites, notes, collections, folders, tasks/jobs/settings, and blob I/O.

## Ownership
- Sole writer of Postgres (`imageapp` DB) and the RustFS/S3 object store (thumbnails, dense/sparse embedding blobs).
- Owns the Alembic migration tree (`alembic/versions/`) — the schema of record.
- Never calls `search` (Qdrant) or `graph` (Neo4j); those are rebuildable projections of this truth.

## Local Contracts
- Canonical HTTP contract: [`../contracts/catalog.openapi.yaml`](../contracts/catalog.openapi.yaml).
- `catalog/routers.py`: `/images*` (CRUD, count, unlabeled, directories, batch-delete, rating/favorite), `/blobs/{sha256}/{kind}` (GET/PUT), `/notes/*`, `/collections/*`, `/folders/*`, `/tasks/*`, `/jobs/*`, `/settings/{key}`, `/stats`, `/reports/folders`.
- Module layout: `catalog/config.py`, `db.py` (SQLAlchemy Core engine), `object_store.py` (boto3 S3), `repository.py`, `schemas.py`, `migrations.py` (programmatic `alembic upgrade head`); one-off `migration/curation_migrate.py`.
- Cross-service id = SHA-256 hex of image bytes (primary key) — see [`../id-scheme/`](../id-scheme/AGENTS.md).

## Work Guidance
- Schema changes go through a new Alembic revision under `alembic/versions/`; apply with `npm run dev:migrate` from repo root.
- This service is the durability boundary — persist here before projections (`search`/`graph`) converge.

## Verification
- `uv run --directory deedlit.catalog pytest`

## Child Guides
- None.
