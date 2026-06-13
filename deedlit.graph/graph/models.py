"""Pydantic request/response models mirroring contracts/graph.openapi.yaml."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AssetKind = Literal["checkpoint", "lora", "embedding", "vae", "controlnet", "upscaler"]
LineageKind = Literal["variant", "upscale", "inpaint"]

SHA256 = Field(pattern=r"^[a-f0-9]{64}$")


class AssetRef(BaseModel):
    kind: AssetKind
    name: str
    hash: str | None = None


class LineageRef(BaseModel):
    parent: str = Field(pattern=r"^[a-f0-9]{64}$")
    kind: LineageKind


class EdgeUpsert(BaseModel):
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    references: list[AssetRef] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    lineage: list[LineageRef] = Field(default_factory=list)


class Neighbor(BaseModel):
    sha256: str
    relation: str
    weight: float | None = None


class NeighborResponse(BaseModel):
    neighbors: list[Neighbor]


class RelatedTag(BaseModel):
    tag: str
    weight: float | None = None
