"""deedlit.metadata — health-only stub.

stateless metadata extraction (no DB). This stub exposes only ``GET /health`` (plus FastAPI's
``/openapi.json``) so the full topology is runnable while the service fills in.
See contracts/metadata.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.metadata", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
