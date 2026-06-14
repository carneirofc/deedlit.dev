"""FastAPI routers for the catalog service (per contracts/catalog.openapi.yaml)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from catalog import object_store, repository
from catalog.schemas import (
    Collection,
    CollectionImages,
    CollectionRename,
    CollectionUpsert,
    FavoriteBody,
    Image,
    ImagePatch,
    ImageUpsert,
    Note,
    NoteUpsert,
    RatingBody,
)

SHA256 = Path(pattern=r"^[a-f0-9]{64}$")

router = APIRouter()


# --- images ----------------------------------------------------------------


@router.post("/images", response_model=Image)
def create_image(payload: ImageUpsert) -> Image:
    return repository.upsert_image(payload)


@router.get("/images", response_model=list[Image])
def list_images(
    tag: str | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    safety: list[str] | None = Query(default=None),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
) -> list[Image]:
    return repository.list_images(
        tag=tag, favorite=favorite, safety=safety, limit=limit, offset=offset
    )


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
    for kind in ("thumbnail", "embedding"):
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
    if kind not in ("thumbnail", "embedding"):
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
    if kind not in ("thumbnail", "embedding"):
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
