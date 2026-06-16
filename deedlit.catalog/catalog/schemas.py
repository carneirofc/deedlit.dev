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
    # Original on-disk creation time of the source file (ingest captures the
    # file mtime). Distinct from ``imported_at`` (when the catalog first saw it):
    # a bulk import of old images stamps a recent import but an old creation. Set
    # INSERT-only by the catalog, so a later reindex (which has no mtime) keeps it.
    createdAt: datetime | None = None
    # AI-generated description (deedlit.labelagent). An expensive vision-LLM
    # computation, so it is PERSISTED here (not just in the search payload) to be
    # retrievable/viewable without re-running the model. Stored in the dedicated
    # image_descriptions table; None = none supplied. Like ``safety`` it is
    # re-derivable, so a reindex without one keeps the existing value.
    description: str | None = None


class Image(ImageUpsert):
    rating: int | None = None
    favorite: bool = False
    # Best-known creation time: the captured file mtime, falling back to the
    # import time for rows ingested before mtime capture existed.
    created_at: datetime | None = None
    # When the catalog first recorded the image (ingestion date).
    imported_at: datetime | None = None


class ImagePatch(BaseModel):
    rating: int | None = None
    favorite: bool | None = None
    tags: list[str] | None = None
    safety: Safety | None = None
    # Power-user / debug edits (#30): correct a bad extracted prompt in place.
    prompt: str | None = None
    negative: str | None = None


# ---------------------------------------------------------------------------
# report DTOs — read-only extraction surfaces for external tooling (#report).
# Image rows already carry filepath/tags/params/etc via the Image schema; these
# add the aggregates a reporting tool needs: a sized total, the full tag
# inventory with counts, the library summary, and per-folder coverage.
# ---------------------------------------------------------------------------
class CountResult(BaseModel):
    """The total number of images matching a filter set (GET /images/count)."""

    count: int


class TagCount(BaseModel):
    name: str
    normalized_name: str
    image_count: int


class TagReport(BaseModel):
    """Full tag inventory with per-tag image counts, paged. ``total`` is every
    tag matching the prefix so a tool can page the whole set."""

    total: int
    items: list[TagCount] = Field(default_factory=list)


class SafetyBreakdown(BaseModel):
    """Live images per content-safety class; ``unclassified`` = NULL safety."""

    sfw: int = 0
    nsfw: int = 0
    explicit: int = 0
    unclassified: int = 0


class StatsReport(BaseModel):
    """Aggregate library counts (GET /stats). All counts exclude soft-deleted
    images; ``labeled``/``unlabeled`` split by AI-description coverage."""

    images: int = 0
    tags: int = 0
    collections: int = 0
    notes: int = 0
    folders: int = 0
    favorites: int = 0
    labeled: int = 0
    unlabeled: int = 0
    safety: SafetyBreakdown = Field(default_factory=SafetyBreakdown)


class FolderReport(BaseModel):
    """Per-folder coverage (path + label + derived image/labeled/unlabeled)."""

    path: str
    label: str | None = None
    image_count: int = 0
    labeled_count: int = 0
    unlabeled_count: int = 0


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


# ---------------------------------------------------------------------------
# source folders — the persistent registry of configured ingest folders.
#
# The catalog owns this table because it is the only DB service; deedlit.ingest
# (stateless) reads the list and writes scan-state back over HTTP. Image / label
# counts are derived on read (see repository.list_folders), not stored.
# ---------------------------------------------------------------------------
class SourceFolderUpsert(BaseModel):
    """Writable fields when adding a folder (POST /folders).

    Only ``path`` is required; the rest carry the user-confirmed defaults
    (auto-scan enabled, recursive, 15-min interval).
    """

    path: str
    label: str | None = None
    enabled: bool = True
    recursive: bool = True
    scan_interval_seconds: int = Field(default=900, ge=0)


class SourceFolderPatch(BaseModel):
    """Partial update (PATCH /folders/{id}).

    Carries both the user-editable controls (enabled / recursive / interval /
    label) AND the scan-state fields the ingest scheduler writes back after a
    scan (status / job id / error / timestamp). All optional — only supplied
    fields are written.
    """

    label: str | None = None
    enabled: bool | None = None
    recursive: bool | None = None
    scan_interval_seconds: int | None = Field(default=None, ge=0)
    last_scan_status: str | None = None
    last_scan_job_id: str | None = None
    last_error: str | None = None
    # When true, stamp last_scan_at to now() server-side (the scheduler can't
    # know the catalog clock). Not persisted as a column itself.
    touch_last_scan_at: bool = False


class SourceFolder(SourceFolderUpsert):
    id: str
    last_scan_at: datetime | None = None
    last_scan_status: str | None = None
    last_scan_job_id: str | None = None
    last_error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Derived coverage (computed on read from images.file_path + descriptions).
    image_count: int = 0
    labeled_count: int = 0
    unlabeled_count: int = 0


# Async task ledger (ADR 0001). Best-effort history of the per-image queue tasks;
# RabbitMQ stays the source of truth for outstanding work.
TaskType = Literal["index", "label"]
TaskStatus = Literal["queued", "running", "done", "failed", "dlq"]


class TaskUpsert(BaseModel):
    """A lifecycle transition written by the ingest publisher/workers (POST
    /tasks). Upserts the one row per ``(sha256, type)`` to its latest state.

    ``attempts`` is optional: when omitted the existing count is kept (a publisher
    recording ``queued`` doesn't reset the retry chain). ``error`` is written as
    given, so passing null clears a prior error on success.
    """

    sha256: str = Field(pattern=SHA256_PATTERN)
    type: TaskType
    status: TaskStatus
    attempts: int | None = Field(default=None, ge=0)
    error: str | None = None
    parent_op_id: str | None = None


class Task(BaseModel):
    id: str
    sha256: str
    type: TaskType
    status: TaskStatus
    attempts: int = 0
    error: str | None = None
    parent_op_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
