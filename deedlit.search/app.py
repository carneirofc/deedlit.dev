"""deedlit.search — health-only stub.

vector search over Qdrant (dense + sparse hybrid). This stub exposes only ``GET /health`` (plus FastAPI's
``/openapi.json``) so the full topology is runnable while the service fills in.
See contracts/search.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.search", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
