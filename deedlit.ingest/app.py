"""deedlit.ingest — health-only stub.

stateless ingest/index worker (no DB). This stub exposes only ``GET /health`` (plus FastAPI's
``/openapi.json``) so the full topology is runnable while the service fills in.
See contracts/ingest.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.ingest", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
