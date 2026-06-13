"""deedlit.catalog — health-only stub.

Source-of-truth catalog over Postgres + RustFS. This stub exposes only
``GET /health`` (plus FastAPI's ``/openapi.json``) so the full topology is
runnable while the service fills in. See contracts/catalog.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.catalog", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
