"""Pydantic DTOs mirroring contracts/search.openapi.yaml."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SHA256_PATTERN = r"^[a-f0-9]{64}$"


class SparseVector(BaseModel):
    indices: list[int]
    values: list[float]


class UpsertPoint(BaseModel):
    sha256: str = Field(pattern=SHA256_PATTERN)
    dense: list[float] = Field(description="1024-dim CLIP image vector")
    description: list[float] | None = Field(
        default=None,
        description="1024-dim CLIP text vector of the AI description (optional).",
    )
    sparse: SparseVector | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class HybridQuery(BaseModel):
    dense: list[float] | None = None
    description: list[float] | None = Field(
        default=None,
        description="CLIP text vector to match against description vectors (optional).",
    )
    sparse: SparseVector | None = None
    limit: int = 24
    filter: dict[str, Any] | None = None


class SimilarQuery(BaseModel):
    sha256: str = Field(pattern=SHA256_PATTERN)
    limit: int = 24


class Hit(BaseModel):
    sha256: str = Field(pattern=SHA256_PATTERN)
    score: float = Field(description="RRF-fused score when hybrid")
    payload: dict[str, Any] | None = None


class QueryResponse(BaseModel):
    fusion: Literal["rrf", "dense", "description", "sparse"]
    hits: list[Hit] = Field(default_factory=list)


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    collection_ready: bool | None = None
