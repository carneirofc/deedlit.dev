# deedlit.search — Vector Search

## Purpose
- FastAPI service (port 8002): hybrid vector search over Qdrant — dense (1024-dim CLIP) + sparse (SPLADE) with RRF fusion, plus a description vector.

## Ownership
- Sole writer of the Qdrant `images` collection (named vectors `dense` / `sparse` / `description`).
- A rebuildable projection of `catalog` truth: reads catalog only during `POST /rebuild`; never writes catalog, never calls `graph`.

## Local Contracts
- Canonical HTTP contract: [`../contracts/search.openapi.yaml`](../contracts/search.openapi.yaml).
- `app.py`: routes + an in-process upsert micro-batcher. `search/store.py` is the only Qdrant-talking code; `search/rebuild.py` pulls `GET /images` from catalog; `id_scheme.py` derives the `uuid5` point id.
- Endpoints: `POST /points`, `DELETE /points/{sha256}`, `POST /points/batch-delete`, `POST /query`, `POST /similar`, `POST /by-image`, `POST /rebuild` (202), `GET /health`.
- No migrations — the collection is created idempotently in `store.ensure_collection()` via FastAPI `lifespan`.

## Work Guidance
- Treat the index as reconstructible: correctness lives in catalog, so a rebuild must fully reproduce state.

## Verification
- `uv run --directory deedlit.search pytest`

## Child Guides
- None.
