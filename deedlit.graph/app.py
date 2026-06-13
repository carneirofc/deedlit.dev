"""deedlit.graph — health-only stub.

relationship graph over Neo4j. This stub exposes only ``GET /health`` (plus FastAPI's
``/openapi.json``) so the full topology is runnable while the service fills in.
See contracts/graph.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.graph", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
