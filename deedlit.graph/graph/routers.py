"""FastAPI routes for deedlit.graph (see contracts/graph.openapi.yaml)."""
from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from graph import repository
from graph.models import (
    EdgeUpsert,
    Neighbor,
    NeighborResponse,
    RelatedTag,
)
from graph.rebuild import rebuild_from_catalog

router = APIRouter()


class BatchDeleteRequest(BaseModel):
    """Bulk un-index body: the sha256s whose nodes to remove in one Cypher call."""

    sha256s: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/edges")
def post_edges(edge: EdgeUpsert) -> dict:
    return repository.upsert_edges(edge)


@router.post("/images/batch-delete")
def batch_delete_images(body: BatchDeleteRequest) -> dict:
    """Delete MANY image nodes + edges in one query (bulk un-index). Idempotent.

    Called by the gateway after the catalog records are gone. Missing nodes are a
    no-op. Returns the count of nodes removed."""
    deleted = repository.delete_images(body.sha256s)
    return {"status": "ok", "deleted": deleted}


@router.delete("/images/{sha256}")
def delete_image(sha256: str) -> dict:
    """Delete an image node + its edges from the graph projection. Idempotent.

    Returns ``{deleted: <count>}`` (0 when the node was not present). A missing
    node is not an error — the graph is a rebuildable projection, so the gateway
    treats this as best-effort cleanup once the catalog record is gone.
    """
    deleted = repository.delete_image(sha256)
    return {"status": "ok", "deleted": deleted}


@router.get("/neighbors/{sha256}", response_model=NeighborResponse)
def get_neighbors(
    sha256: str,
    relation: str = Query("any", pattern="^(shared_asset|tag_cooccurrence|any)$"),
    limit: int = Query(24, ge=1, le=200),
) -> NeighborResponse:
    rows = repository.neighbors(sha256, relation=relation, limit=limit)
    return NeighborResponse(neighbors=[Neighbor(**r) for r in rows])


@router.get("/lineage/{sha256}", response_model=NeighborResponse)
def get_lineage(sha256: str) -> NeighborResponse:
    rows = repository.lineage(sha256)
    return NeighborResponse(neighbors=[Neighbor(**r) for r in rows])


@router.get("/related-tags/{tag}", response_model=list[RelatedTag])
def get_related_tags(
    tag: str, limit: int = Query(24, ge=1, le=200)
) -> list[RelatedTag]:
    rows = repository.related_tags(tag, limit=limit)
    return [RelatedTag(**r) for r in rows]


@router.post("/rebuild", status_code=202)
def post_rebuild() -> dict:
    return rebuild_from_catalog()
