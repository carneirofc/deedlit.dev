"""deedlit.catalog — source-of-truth catalog over Postgres + RustFS.

Images, tags, params, references, ratings, favorites, notes, collections, and
blob I/O for thumbnails / cached embeddings. This is an OWNING service: it owns
the Alembic migrations and NEVER calls search (Qdrant) or graph (Neo4j).

See contracts/catalog.openapi.yaml.
"""
from fastapi import FastAPI

from catalog import object_store
from catalog.db import db_ready
from catalog.routers import router

app = FastAPI(title="deedlit.catalog", version="0.1.0")


@app.get("/health")
def health() -> dict:
    db = db_ready()
    blob = object_store.blob_ready()
    status = "ok" if (db and blob) else "degraded"
    return {"status": status, "db_ready": db, "blob_ready": blob}


app.include_router(router)
