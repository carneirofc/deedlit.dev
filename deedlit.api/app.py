"""deedlit.api — health-only stub.

BFF gateway aggregating catalog/search/graph + MCP + job dispatch (no DB). This stub exposes only ``GET /health`` (plus FastAPI's
``/openapi.json``) so the full topology is runnable while the service fills in.
See contracts/api.openapi.yaml.
"""
from fastapi import FastAPI

app = FastAPI(title="deedlit.api", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
