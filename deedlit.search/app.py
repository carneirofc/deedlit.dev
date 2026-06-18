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

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from activity import install_activity
from search.config import get_config
from search.rebuild import rebuild_from_catalog
from search.schemas import (
    BatchDeletePoints,
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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
install_activity(app)


@app.get("/health", response_model=Health)
def health() -> Health:
    try:
        ready = get_store().collection_exists()
    except Exception:
        return Health(status="degraded", collection_ready=False)
    return Health(status="ok", collection_ready=ready)


# --- Upsert micro-batcher -------------------------------------------------
# The ingest hot path POSTs /points one point per image; a scaled index.search
# worker pool lands hundreds concurrently. On Qdrant each single-point upsert is
# its own round-trip + WAL flush — the index.search bottleneck. The batcher
# coalesces concurrent /points calls that arrive within a short window into ONE
# `upsert(points=[...])`, amortising the round-trip + flush over the whole batch.
# Each caller still awaits its flush (which runs wait=True), so read-after-write
# holds: the point is queryable the moment the POST returns.
#   SEARCH_UPSERT_BATCH_MAX:     max points per Qdrant upsert.
#   SEARCH_UPSERT_BATCH_WAIT_MS: how long the first waiter accumulates a batch.
UPSERT_BATCH_MAX = max(1, int(os.getenv("SEARCH_UPSERT_BATCH_MAX", "64")))
UPSERT_BATCH_WAIT_MS = max(0.0, float(os.getenv("SEARCH_UPSERT_BATCH_WAIT_MS", "10")))

# Loop-bound (recreated if the running loop changes, e.g. across TestClient
# requests) so a Future is never awaited on a foreign loop.
_upsert_queue: asyncio.Queue | None = None
_upsert_task: asyncio.Task | None = None
_upsert_loop: Any = None


async def _upsert_batch_loop(queue: asyncio.Queue) -> None:
    """Drain ``queue`` forever, flushing each coalesced batch in one Qdrant upsert."""
    loop = asyncio.get_running_loop()
    store = get_store()
    while True:
        item, fut = await queue.get()
        batch: list[tuple[tuple, asyncio.Future]] = [(item, fut)]
        deadline = loop.time() + UPSERT_BATCH_WAIT_MS / 1000.0
        while len(batch) < UPSERT_BATCH_MAX:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                batch.append(await asyncio.wait_for(queue.get(), remaining))
            except asyncio.TimeoutError:
                break

        items = [it for it, _ in batch]

        def _flush() -> list[str]:
            store.ensure_collection()  # cached after first call (no round-trip)
            return store.upsert_points(items)

        try:
            ids = await asyncio.to_thread(_flush)
            for (_, f), pid in zip(batch, ids):
                if not f.done():
                    f.set_result(pid)
        except Exception as exc:  # propagate the same failure to every waiter
            for _, f in batch:
                if not f.done():
                    f.set_exception(exc)


def _get_upsert_queue() -> asyncio.Queue:
    """Return (lazily creating) the per-loop upsert queue + its drain task."""
    global _upsert_queue, _upsert_task, _upsert_loop
    loop = asyncio.get_running_loop()
    if _upsert_queue is None or _upsert_loop is not loop:
        _upsert_queue = asyncio.Queue()
        _upsert_loop = loop
        _upsert_task = loop.create_task(_upsert_batch_loop(_upsert_queue))
    return _upsert_queue


@app.post("/points")
async def upsert_point(point: UpsertPoint) -> dict:
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    await _get_upsert_queue().put((
        (point.sha256, point.dense, point.sparse, point.payload, point.description),
        fut,
    ))
    point_id = await fut
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


@app.post("/points/batch-delete")
def delete_points(body: BatchDeletePoints) -> dict:
    """Delete MANY points in ONE Qdrant call (bulk un-index). Idempotent.

    The gateway calls this after the catalog records are gone, with the sha256s
    that actually existed. Missing points are no-ops. Returns the deleted count."""
    store = get_store()
    store.ensure_collection()
    ids = store.delete_points(body.sha256s)
    return {"status": "ok", "count": len(ids)}


@app.post("/query", response_model=QueryResponse)
def query(body: HybridQuery) -> QueryResponse:
    if body.dense is None and body.sparse is None and body.description is None:
        raise HTTPException(
            status_code=422,
            detail="at least one of dense/description/sparse is required",
        )
    fusion, hits = get_store().query_hybrid(
        dense=body.dense,
        sparse=body.sparse,
        limit=body.limit,
        query_filter=body.filter,
        description=body.description,
        offset=body.offset,
    )
    return QueryResponse(fusion=fusion, hits=hits)


@app.post("/similar", response_model=QueryResponse)
def similar(body: SimilarQuery) -> QueryResponse:
    hits = get_store().query_similar(
        body.sha256, body.limit, query_filter=body.filter, offset=body.offset
    )
    return QueryResponse(fusion="dense", hits=hits)


@app.post("/by-image", response_model=QueryResponse)
def by_image(body: SimilarQuery) -> QueryResponse:
    # Image-to-image search reuses a stored point's dense vector, which is
    # exactly the "nearest to this point" operation. ``filter`` (when supplied)
    # applies the same payload filter as /query so by-image honours the UI filter.
    hits = get_store().query_similar(
        body.sha256, body.limit, query_filter=body.filter, offset=body.offset
    )
    return QueryResponse(fusion="dense", hits=hits)


@app.post("/rebuild", status_code=status.HTTP_202_ACCEPTED)
def rebuild() -> dict:
    store = get_store()
    upserted = rebuild_from_catalog(store, store.config)
    return {"status": "ok", "upserted": upserted}
