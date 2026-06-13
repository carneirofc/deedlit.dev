"""deedlit.graph — relationship graph over Neo4j.

Edges are derived from references (shared checkpoint/lora/embedding/vae/
controlnet/upscaler), tag co-occurrence, and lineage (variant/upscale/inpaint).
This is an OWNING service: it never calls search, and only reads the catalog
during ``POST /rebuild``. See contracts/graph.openapi.yaml and graph/repository.py
for the graph model + name-normalization rule.
"""
from fastapi import FastAPI

from graph.db import neo4j_ready
from graph.routers import router

app = FastAPI(title="deedlit.graph", version="0.1.0")


@app.get("/health")
def health() -> dict:
    ready = neo4j_ready()
    return {"status": "ok" if ready else "degraded", "neo4j_ready": ready}


app.include_router(router)
