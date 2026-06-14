"""deedlit.catalog — source-of-truth catalog over Postgres + RustFS.

Images, tags, params, references, ratings, favorites, notes, collections, and
blob I/O for thumbnails / cached embeddings. This is an OWNING service: it owns
the Alembic migrations and NEVER calls search (Qdrant) or graph (Neo4j).

See contracts/catalog.openapi.yaml.
"""
import logging

from fastapi import FastAPI

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
            return "/health" not in str(args[2])
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.catalog", version="0.1.0")


@app.get("/health")
def health() -> dict:
    db = db_ready()
    blob = object_store.blob_ready()
    status = "ok" if (db and blob) else "degraded"
    return {"status": status, "db_ready": db, "blob_ready": blob}


app.include_router(router)
