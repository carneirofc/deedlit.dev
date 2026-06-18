"""FastAPI routers for the catalog service (per contracts/catalog.openapi.yaml)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from catalog import object_store, repository
from catalog.schemas import (
    BatchDeleteRequest,
    Collection,
    CollectionImages,
    CollectionRename,
    CollectionUpsert,
    CountResult,
    FavoriteBody,
    FolderReport,
    Image,
    ImagePatch,
    ImageUpsert,
    Job,
    JobUpsert,
    Note,
    NoteUpsert,
    RatingBody,
    Setting,
    SettingPut,
    SourceFolder,
    SourceFolderPatch,
    SourceFolderUpsert,
    StatsReport,
    TagReport,
    Task,
    TaskUpsert,
)

SHA256 = Path(pattern=r"^[a-f0-9]{64}$")

router = APIRouter()


# --- images ----------------------------------------------------------------


@router.post("/images", response_model=Image)
def create_image(payload: ImageUpsert) -> Image:
    return repository.upsert_image(payload)


@router.get("/images", response_model=list[Image])
def list_images(
    tag: list[str] | None = Query(default=None),
    exclude_tag: list[str] | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    rating_gte: int | None = Query(default=None, ge=0, le=5),
    safety: list[str] | None = Query(default=None),
    path: str | None = Query(default=None),
    sort: str = Query(default="newest"),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
) -> list[Image]:
    # `tag`/`exclude_tag` are repeatable (?tag=a&tag=b). A single ?tag=a still
    # arrives as a one-element list, so legacy single-tag callers keep working.
    # `path` is a separator-insensitive substring match on the on-disk file path.
    return repository.list_images(
        tags=tag,
        exclude_tags=exclude_tag,
        favorite=favorite,
        rating_gte=rating_gte,
        safety=safety,
        path=path,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/tags", response_model=list[str])
def suggest_tags(
    prefix: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=50),
) -> list[str]:
    """Tag-name autocomplete: names matching ``prefix``, most-used first."""
    return repository.suggest_tags(prefix=prefix, limit=limit)


@router.get("/tags/report", response_model=TagReport)
def tags_report(
    prefix: str = Query(default=""),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> TagReport:
    """Full tag inventory with per-tag image counts, paged (report surface).

    Unlike /tags (a capped autocomplete of bare names) this returns every tag
    plus how many distinct live images carry it, most-used first, with a ``total``
    so a tool can page the whole inventory.
    """
    return repository.tag_report(prefix=prefix, limit=limit, offset=offset)


# Registered BEFORE /images/{sha256}: a literal segment ("count"/"unlabeled") is
# not a 64-hex sha, so the parameterized route would 422 it. The literal wins.
@router.get("/images/count", response_model=CountResult)
def count_images(
    tag: list[str] | None = Query(default=None),
    exclude_tag: list[str] | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    rating_gte: int | None = Query(default=None, ge=0, le=5),
    safety: list[str] | None = Query(default=None),
    path: str | None = Query(default=None),
) -> CountResult:
    """Total images matching the same filters as GET /images (no sort/paging).

    Lets a report/export tool size the work set before paging through /images.
    """
    return CountResult(
        count=repository.count_images(
            tags=tag,
            exclude_tags=exclude_tag,
            favorite=favorite,
            rating_gte=rating_gte,
            safety=safety,
            path=path,
        )
    )


@router.get("/images/unlabeled")
def list_unlabeled(
    limit: int = Query(default=500), offset: int = Query(default=0)
) -> dict:
    """sha256 of images missing a labelagent description — the label-backfill
    work set for deedlit.ingest. Returns ``{sha256: [...]}``."""
    return {"sha256": repository.list_unlabeled_sha256(limit=limit, offset=offset)}


@router.get("/images/{sha256}", response_model=Image)
def read_image(sha256: str = SHA256) -> Image:
    img = repository.get_image(sha256)
    if img is None:
        raise HTTPException(status_code=404, detail="image not found")
    return img


@router.patch("/images/{sha256}", response_model=Image)
def patch_image(payload: ImagePatch, sha256: str = SHA256) -> Image:
    img = repository.patch_image(sha256, payload)
    if img is None:
        raise HTTPException(status_code=404, detail="image not found")
    return img


# Registered BEFORE /images/{sha256}: "batch-delete" is a literal segment, not a
# 64-hex sha, so the parameterized route would reject it. The literal wins.
@router.post("/images/batch-delete")
def batch_delete_images(body: BatchDeleteRequest) -> dict:
    """Hard-delete MANY images' catalog records + blobs in ONE call.

    Two set-based SQL deletes (vs two per image) then per-blob object-store cleanup
    for exactly the records that existed. Returns the ``deleted`` + ``missing``
    sha256s so the caller can clean projections for the former and report the rest.
    """
    requested = list(dict.fromkeys(body.sha256s))  # de-dupe, keep order
    deleted = repository.delete_images(requested)
    for sha in deleted:
        for kind in object_store.BLOB_KINDS:
            object_store.delete_blob(sha, kind)
    gone = set(deleted)
    missing = [s for s in requested if s not in gone]
    return {"status": "ok", "deleted": deleted, "missing": missing}


@router.delete("/images/{sha256}")
def delete_image(sha256: str = SHA256) -> dict:
    """Hard-delete an image's catalog record (NOT the source file on disk).

    Removes the Postgres row (FK children cascade) plus the per-image asset
    references, then drops the sha256-keyed RustFS blobs (thumbnail + cached
    embedding). The image row is already gone before blob cleanup runs, so a
    lingering or already-missing blob never fails the delete.
    """
    if not repository.delete_image(sha256):
        raise HTTPException(status_code=404, detail="image not found")
    for kind in object_store.BLOB_KINDS:
        object_store.delete_blob(sha256, kind)
    return {"status": "ok"}


@router.put("/images/{sha256}/rating")
def set_rating(payload: RatingBody, sha256: str = SHA256) -> dict:
    if not repository.set_rating(sha256, payload.rating):
        raise HTTPException(status_code=404, detail="image not found")
    return {"status": "ok"}


@router.put("/images/{sha256}/favorite")
def set_favorite(payload: FavoriteBody, sha256: str = SHA256) -> dict:
    if not repository.set_favorite(sha256, payload.favorite):
        raise HTTPException(status_code=404, detail="image not found")
    return {"status": "ok"}


# --- blobs -----------------------------------------------------------------


@router.get("/blobs/{sha256}/{kind}")
def get_blob(sha256: str = SHA256, kind: str = Path(...)) -> Response:
    if kind not in object_store.BLOB_KINDS:
        raise HTTPException(status_code=422, detail="invalid blob kind")
    data = object_store.get_blob(sha256, kind)
    if data is None:
        raise HTTPException(status_code=404, detail="blob not found")
    return Response(
        content=data, media_type=object_store.content_type_for(kind)
    )


@router.put("/blobs/{sha256}/{kind}")
async def put_blob(
    request: Request, sha256: str = SHA256, kind: str = Path(...)
) -> dict:
    if kind not in object_store.BLOB_KINDS:
        raise HTTPException(status_code=422, detail="invalid blob kind")
    body = await request.body()
    uri = object_store.put_blob(sha256, kind, body)
    return {"status": "ok", "uri": uri}


# --- notes -----------------------------------------------------------------


@router.post("/notes", response_model=Note)
def create_note(payload: NoteUpsert) -> Note:
    return repository.create_note(payload)


@router.get("/notes/by-image/{sha256}", response_model=list[Note])
def notes_by_image(sha256: str = SHA256) -> list[Note]:
    return repository.notes_by_image(sha256)


@router.get("/notes/{id}", response_model=Note)
def read_note(id: str = Path(...)) -> Note:
    note = repository.get_note(id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


@router.put("/notes/{id}", response_model=Note)
def update_note(payload: NoteUpsert, id: str = Path(...)) -> Note:
    note = repository.update_note(id, payload)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


@router.get("/notes/{id}/export", response_model=Note)
def export_note(id: str = Path(...)) -> Note:
    note = repository.export_note(id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


# --- collections -----------------------------------------------------------


@router.post("/collections", response_model=Collection)
def create_collection(payload: CollectionUpsert) -> Collection:
    return repository.create_collection(payload.name, payload.images)


@router.get("/collections", response_model=list[Collection])
def list_collections() -> list[Collection]:
    return repository.list_collections()


@router.get("/collections/by-image/{sha256}", response_model=list[Collection])
def collections_by_image(sha256: str = SHA256) -> list[Collection]:
    return repository.collections_by_image(sha256)


@router.get("/collections/{id}", response_model=Collection)
def read_collection(id: str = Path(...)) -> Collection:
    col = repository.get_collection(id)
    if col is None:
        raise HTTPException(status_code=404, detail="collection not found")
    return col


@router.put("/collections/{id}", response_model=Collection)
def rename_collection(payload: CollectionRename, id: str = Path(...)) -> Collection:
    col = repository.rename_collection(id, payload.name)
    if col is None:
        raise HTTPException(status_code=404, detail="collection not found")
    return col


@router.delete("/collections/{id}")
def delete_collection(id: str = Path(...)) -> dict:
    if not repository.delete_collection(id):
        raise HTTPException(status_code=404, detail="collection not found")
    return {"status": "ok"}


@router.put("/collections/{id}/images")
def set_collection_images(payload: CollectionImages, id: str = Path(...)) -> dict:
    if not repository.set_collection_images(id, payload.images):
        raise HTTPException(status_code=404, detail="collection not found")
    return {"status": "ok"}


# --- source folders --------------------------------------------------------


@router.post("/folders", response_model=SourceFolder)
def create_folder(payload: SourceFolderUpsert) -> SourceFolder:
    return repository.create_folder(payload)


@router.get("/folders", response_model=list[SourceFolder])
def list_folders() -> list[SourceFolder]:
    return repository.list_folders()


@router.get("/folders/{id}", response_model=SourceFolder)
def read_folder(id: str = Path(...)) -> SourceFolder:
    folder = repository.get_folder(id)
    if folder is None:
        raise HTTPException(status_code=404, detail="folder not found")
    return folder


@router.patch("/folders/{id}", response_model=SourceFolder)
def patch_folder(payload: SourceFolderPatch, id: str = Path(...)) -> SourceFolder:
    folder = repository.patch_folder(id, payload)
    if folder is None:
        raise HTTPException(status_code=404, detail="folder not found")
    return folder


@router.delete("/folders/{id}")
def delete_folder(id: str = Path(...)) -> dict:
    if not repository.delete_folder(id):
        raise HTTPException(status_code=404, detail="folder not found")
    return {"status": "ok"}


# --- tasks ledger (ADR 0001) -----------------------------------------------
@router.post("/tasks", response_model=Task)
def upsert_task(payload: TaskUpsert) -> Task:
    """Record an async task lifecycle transition (best-effort, called by ingest)."""
    return repository.upsert_task(payload)


@router.get("/tasks", response_model=list[Task])
def list_tasks(
    sha256: str | None = Query(default=None),
    type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[Task]:
    return repository.list_tasks(
        sha256=sha256, type=type, status=status, limit=limit, offset=offset
    )


@router.get("/tasks/{id}", response_model=Task)
def read_task(id: str = Path(...)) -> Task:
    task = repository.get_task(id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


# --- jobs (durable projection of the ingest JobStore) ----------------------
# Registered BEFORE /jobs/{id}: the literal "interrupt-stale" segment must win
# over the parameterized route.
@router.post("/jobs/interrupt-stale")
def interrupt_stale_jobs() -> dict:
    """Mark every job still queued/running as interrupted (ingest startup).

    A job in those states belongs to a process whose in-memory worker is gone,
    so it can never settle itself. Returns the ids flipped."""
    return {"interrupted": repository.interrupt_stale_jobs()}


@router.post("/jobs", response_model=Job)
def upsert_job(payload: JobUpsert) -> Job:
    """Record a job-state snapshot (best-effort, called by ingest)."""
    return repository.upsert_job(payload)


@router.get("/jobs", response_model=list[Job])
def list_jobs(
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[Job]:
    return repository.list_jobs(limit=limit, offset=offset)


@router.get("/jobs/{id}", response_model=Job)
def read_job(id: str = Path(...)) -> Job:
    job = repository.get_job(id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


# --- settings (generic KV; holds the ingest producer config) ---------------
@router.get("/settings/{key}", response_model=Setting)
def read_setting(key: str = Path(...)) -> Setting:
    setting = repository.get_setting(key)
    if setting is None:
        raise HTTPException(status_code=404, detail="setting not found")
    return setting


@router.put("/settings/{key}", response_model=Setting)
def write_setting(payload: SettingPut, key: str = Path(...)) -> Setting:
    return repository.put_setting(key, payload.value)


# --- reports ---------------------------------------------------------------
# Read-only extraction surfaces for building tools on top of the platform. The
# per-image data (filepath/tags/params/...) already rides GET /images; these add
# the aggregates: library summary, full tag inventory, per-folder coverage.


@router.get("/stats", response_model=StatsReport)
def stats() -> StatsReport:
    """Aggregate library counts (images/tags/collections/notes/folders, content-
    safety breakdown, labeled vs unlabeled). Backs the gateway GET /stats."""
    return repository.library_stats()


@router.get("/reports/folders", response_model=list[FolderReport])
def reports_folders() -> list[FolderReport]:
    """Per-folder coverage: path + label + image/labeled/unlabeled counts."""
    return repository.folder_reports()
