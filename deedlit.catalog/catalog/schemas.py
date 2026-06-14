"""Pydantic DTOs mirroring contracts/catalog.openapi.yaml."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SHA256_PATTERN = r"^[a-f0-9]{64}$"

# AI content-safety class (deedlit.labelagent). Stored on images.safety; drives
# the app's content-safety filter. None = unclassified.
Safety = Literal["sfw", "nsfw", "explicit"]


class AssetRef(BaseModel):
    kind: str
    name: str
    hash: str | None = None


class Params(BaseModel):
    seed: int | None = None
    steps: int | None = None
    cfg: float | None = None
    sampler: str | None = None
    scheduler: str | None = None
    denoise: float | None = None
    clipskip: int | None = None
    width: int | None = None
    height: int | None = None


class ImageUpsert(BaseModel):
    sha256: str = Field(pattern=SHA256_PATTERN)
    filepath: str | None = None
    phash: str | None = None
    width: int | None = None
    height: int | None = None
    sourceTool: str | None = None
    prompt: str | None = None
    negative: str | None = None
    tags: list[str] = Field(default_factory=list)
    params: Params | None = None
    references: list[AssetRef] = Field(default_factory=list)
    workflow_json: dict[str, Any] | None = None
    api_prompt_json: dict[str, Any] | None = None
    safety: Safety | None = None


class Image(ImageUpsert):
    rating: int | None = None
    favorite: bool = False
    created_at: datetime | None = None


class ImagePatch(BaseModel):
    rating: int | None = None
    favorite: bool | None = None
    tags: list[str] | None = None
    safety: Safety | None = None


class RatingBody(BaseModel):
    rating: int = Field(ge=0, le=5)


class FavoriteBody(BaseModel):
    favorite: bool


class NoteUpsert(BaseModel):
    title: str | None = None
    positive: str | None = None
    negative: str | None = None
    blocks: dict[str, Any]
    imageRefs: list[str] = Field(default_factory=list)


class Note(NoteUpsert):
    id: str
    created_at: datetime | None = None


class CollectionUpsert(BaseModel):
    name: str
    images: list[str] = Field(default_factory=list)


class Collection(CollectionUpsert):
    id: str


class CollectionImages(BaseModel):
    images: list[str]


class CollectionRename(BaseModel):
    name: str
