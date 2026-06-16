"""deedlit.catalog — source-of-truth catalog over Postgres + RustFS.

Images, tags, params, references, ratings, favorites, notes, collections, and
blob I/O for thumbnails / cached embeddings. This is an OWNING service: it owns
the Alembic migrations and NEVER calls search (Qdrant) or graph (Neo4j).

See contracts/catalog.openapi.yaml.
"""
if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from activity import install_activity
from catalog import object_store
from catalog.db import db_ready
from catalog.routers import router


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

app = FastAPI(title="deedlit.catalog", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
install_activity(app)


@app.get("/health")
def health() -> dict:
    db = db_ready()
    blob = object_store.blob_ready()
    status = "ok" if (db and blob) else "degraded"
    return {"status": status, "db_ready": db, "blob_ready": blob}


app.include_router(router)
