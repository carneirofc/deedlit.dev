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


class ImageSummary(BaseModel):
    """Lightweight browse row returned by GET /images (one per grid card).

    Deliberately a SUBSET of :class:`Image`: it carries only what the library
    grid renders (label/prompt, tags, checkpoint reference, rating, safety,
    dimensions). The heavy ``workflow_json`` / ``api_prompt_json`` ComfyUI graphs
    — tens-to-hundreds of KB EACH — plus the detail-only ``negative`` /
    ``params`` / ``description`` are OMITTED. A 50-image page otherwise dragged 50
    full workflow graphs across catalog→gateway→UI on every (auto-refresh) poll,
    which serialised slowly server-side and froze the browser. Fetch the full
    record (those fields included) via GET /images/{sha256} only when a detail
    view is actually opened.
    """

    sha256: str = Field(pattern=SHA256_PATTERN)
    filepath: str | None = None
    # Parent directory of ``filepath`` (separators normalized to '/'), the
    # grouping key for the library's split-by-source-directory view. Derived +
    # stored by the catalog (images.directory); None for legacy rows not yet
    # backfilled. Distinct from the unanchored ``path`` browse filter.
    directory: str | None = None
    phash: str | None = None
    width: int | None = None
    height: int | None = None
    sourceTool: str | None = None
    prompt: str | None = None
    tags: list[str] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)
    rating: int | None = None
    favorite: bool = False
    safety: Safety | None = None
    # Best-known creation time (captured file mtime, falling back to import time).
    created_at: datetime | None = None
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


class DirectoryCount(BaseModel):
    """One source directory + how many live images live directly under it.

    Backs the library's split-by-source-directory view: GET /images/directories
    returns the distinct ``images.directory`` values with per-directory totals so
    the grid can render folder section headers with true counts (not just the
    counts of the currently-loaded page)."""

    directory: str
    image_count: int


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


class BatchDeleteRequest(BaseModel):
    """Bulk un-index body: the sha256s to hard-delete in one call (capped)."""

    sha256s: list[str] = Field(min_length=1, max_length=1000)


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


# ---------------------------------------------------------------------------
# jobs — durable projection of deedlit.ingest's in-memory JobStore.
#
# ingest is stateless (no DB driver), so it write-throughs each coarse op's
# lifecycle here best-effort (like the tasks ledger) and hydrates the list back
# on restart. ``id`` is the uuid ingest generates (and stamps on tasks as
# ``parent_op_id``), so the catalog upserts ON CONFLICT (id) rather than minting
# its own. ``stage_counts``/``report`` are opaque JSON snapshots.
# ---------------------------------------------------------------------------
class JobUpsert(BaseModel):
    """A job-state snapshot written by ingest (POST /jobs), upserting one row.

    Sent on each lifecycle edge (queued → running → terminal); live per-file
    progress stays in ingest memory, so this is a coarse snapshot, not a stream.
    """

    id: str
    type: str
    status: str
    folder_path: str | None = None
    source_folder_id: str | None = None
    total: int = 0
    done: int = 0
    skipped: int = 0
    failed: int = 0
    error: str | None = None
    current_stage: str | None = None
    stage_counts: dict[str, int] = Field(default_factory=dict)
    report: dict[str, Any] | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class Job(JobUpsert):
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# settings — generic key/value store (one JSON blob per key).
#
# Currently holds ``ingest_config`` (the producer knobs the settings panel
# edits) so a UI change survives an ingest restart.
# ---------------------------------------------------------------------------
class SettingPut(BaseModel):
    value: dict[str, Any]


class Setting(BaseModel):
    key: str
    value: dict[str, Any]
    updated_at: datetime | None = None
