"""deedlit.search — vector search over Qdrant (dense + sparse hybrid).

Named vectors: ``dense`` (1024-dim, cosine) + ``sparse`` (SPLADE). Hybrid query
fuses a dense prefetch and a sparse prefetch via RRF (Qdrant Query API).

This is an OWNING service: the only cross-service call it makes is reading the
catalog during ``POST /rebuild``. It never calls graph and never writes catalog.
See contracts/search.openapi.yaml.
"""
from __future__ import annotations

if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status

from activity import install_activity
from search.config import get_config
from search.rebuild import rebuild_from_catalog
from search.schemas import (
    Health,
    HybridQuery,
    QueryResponse,
    SimilarQuery,
    UpsertPoint,
)
from search.store import SearchStore

_config = get_config()
_store = SearchStore(_config)


def get_store() -> SearchStore:
    """Accessor so tests can monkeypatch the live store with a throwaway one."""
    return _store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Best-effort: create the collection so the service is usable out of the box.
    # Never fail startup just because Qdrant is briefly unreachable.
    try:
        get_store().ensure_collection()
    except Exception:  # pragma: no cover - exercised only when Qdrant is down
        pass
    yield


# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact.
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            path = str(args[2])
            return "/health" not in path and "/activity" not in path
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.search", version="0.1.0", lifespan=lifespan)
install_activity(app)


@app.get("/health", response_model=Health)
def health() -> Health:
    try:
        ready = get_store().collection_exists()
    except Exception:
        return Health(status="degraded", collection_ready=False)
    return Health(status="ok", collection_ready=ready)


@app.post("/points")
def upsert_point(point: UpsertPoint) -> dict:
    store = get_store()
    store.ensure_collection()
    point_id = store.upsert_point(
        sha256=point.sha256,
        dense=point.dense,
        sparse=point.sparse,
        payload=point.payload,
    )
    return {"status": "ok", "id": point_id, "sha256": point.sha256.lower()}


@app.delete("/points/{sha256}")
def delete_point(sha256: str) -> dict:
    """Delete the point for ``sha256`` (keyed by uuid5). Idempotent.

    Part of un-indexing an image: the gateway calls this after the catalog
    record is gone. Deleting a missing point is not an error, so this always
    returns ``ok`` for a well-formed sha256.
    """
    store = get_store()
    store.ensure_collection()
    point_id = store.delete_point(sha256)
    return {"status": "ok", "id": point_id, "sha256": sha256.lower()}


@app.post("/query", response_model=QueryResponse)
def query(body: HybridQuery) -> QueryResponse:
    if body.dense is None and body.sparse is None:
        raise HTTPException(
            status_code=422, detail="at least one of dense/sparse is required"
        )
    fusion, hits = get_store().query_hybrid(
        dense=body.dense,
        sparse=body.sparse,
        limit=body.limit,
        query_filter=body.filter,
    )
    return QueryResponse(fusion=fusion, hits=hits)


@app.post("/similar", response_model=QueryResponse)
def similar(body: SimilarQuery) -> QueryResponse:
    hits = get_store().query_similar(body.sha256, body.limit)
    return QueryResponse(fusion="dense", hits=hits)


@app.post("/by-image", response_model=QueryResponse)
def by_image(body: SimilarQuery) -> QueryResponse:
    # Image-to-image search reuses a stored point's dense vector, which is
    # exactly the "nearest to this point" operation.
    hits = get_store().query_similar(body.sha256, body.limit)
    return QueryResponse(fusion="dense", hits=hits)


@app.post("/rebuild", status_code=status.HTTP_202_ACCEPTED)
def rebuild() -> dict:
    store = get_store()
    upserted = rebuild_from_catalog(store, store.config)
    return {"status": "ok", "upserted": upserted}
