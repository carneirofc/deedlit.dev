"""FastAPI routes for deedlit.graph (see contracts/graph.openapi.yaml)."""
from __future__ import annotations

from fastapi import APIRouter, Query

from graph import repository
from graph.models import (
    EdgeUpsert,
    Neighbor,
    NeighborResponse,
    RelatedTag,
)
from graph.rebuild import rebuild_from_catalog

router = APIRouter()


@router.post("/edges")
def post_edges(edge: EdgeUpsert) -> dict:
    return repository.upsert_edges(edge)


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
