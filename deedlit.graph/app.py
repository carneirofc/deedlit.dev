"""deedlit.graph — relationship graph over Neo4j.

Edges are derived from references (shared checkpoint/lora/embedding/vae/
controlnet/upscaler), tag co-occurrence, and lineage (variant/upscale/inpaint).
This is an OWNING service: it never calls search, and only reads the catalog
during ``POST /rebuild``. See contracts/graph.openapi.yaml and graph/repository.py
for the graph model + name-normalization rule.
"""
if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from activity import install_activity
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
            path = str(args[2])
            return "/health" not in path and "/activity" not in path
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.graph", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
install_activity(app)


@app.get("/health")
def health() -> dict:
    ready = neo4j_ready()
    return {"status": "ok" if ready else "degraded", "neo4j_ready": ready}


app.include_router(router)
