"""deedlit.graph — relationship graph over Neo4j.

Edges are derived from references (shared checkpoint/lora/embedding/vae/
controlnet/upscaler), tag co-occurrence, and lineage (variant/upscale/inpaint).
This is an OWNING service: it never calls search, and only reads the catalog
during ``POST /rebuild``. See contracts/graph.openapi.yaml and graph/repository.py
for the graph model + name-normalization rule.
"""
import logging

from fastapi import FastAPI

from graph.db import neo4j_ready
from graph.routers import router


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

app = FastAPI(title="deedlit.graph", version="0.1.0")


@app.get("/health")
def health() -> dict:
    ready = neo4j_ready()
    return {"status": "ok" if ready else "degraded", "neo4j_ready": ready}


app.include_router(router)
