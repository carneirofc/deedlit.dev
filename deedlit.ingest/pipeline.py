"""Per-file ingest pipeline + outbound clients.

The pipeline for one image file:

    read bytes -> sha256 (dedup key) -> phash -> dims -> WebP thumbnail (Pillow)
      -> metadata POST /extract
      -> vision POST /embed/image (dense)
      -> vision POST /embed/sparse (sparse, over the extracted prompt text)
      -> assemble a catalog-shaped record + a search point + graph edges
      -> fan out the writes DIRECTLY to the owning services (catalog/search/
         graph), catalog-first, per-store retry.

deedlit.ingest holds NO DB drivers. Persistence happens by HTTP fan-out to the
owning services (issue #17):

  - record    -> catalog  POST /images            (ImageUpsert shape)
  - thumbnail -> catalog  PUT  /blobs/{sha}/thumbnail
  - point     -> search   POST /points            (dense + sparse + payload)
  - edges     -> graph    POST /edges             (references/tags/lineage)

The fan-out used the TS app's write endpoints as an interim (issue #9); #17
re-points it at the owning service contracts (contracts/{catalog,search,graph}
.openapi.yaml) so the TS app is UI-only.

The outbound HTTP boundary lives in small module-level functions
(``extract_metadata``, ``embed_image``, ``embed_sparse``, ``fan_out_writes``)
so tests can monkeypatch them and stay offline/deterministic.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
import imagehash
from PIL import Image

from id_scheme import point_id_for_sha256

log = logging.getLogger("deedlit.ingest.pipeline")

# ---------------------------------------------------------------------------
# Configuration (all overridable via env)
# ---------------------------------------------------------------------------
METADATA_URL = os.getenv("METADATA_URL", "http://localhost:8005").rstrip("/")
VISION_URL = os.getenv("VISION_URL", "http://localhost:8000").rstrip("/")

# Per-service URLs for the fan-out (#17) AND the reconcile sweep (#21). The
# fan-out and reconcile both talk DIRECTLY to the owning service contracts
# (contracts/{catalog,search,graph}.openapi.yaml); the TS app is UI-only.
CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:8001").rstrip("/")
SEARCH_URL = os.getenv("SEARCH_URL", "http://localhost:8002").rstrip("/")
GRAPH_URL = os.getenv("GRAPH_URL", "http://localhost:8003").rstrip("/")

# Catalog RustFS blob kind that holds the raw original image bytes. The catalog
# contract enumerates only `thumbnail`/`embedding` blob kinds for I/O, but the
# original bytes live in the same sha256-keyed object store; reindex reads them
# from this kind. Overridable so deployments that key the original differently
# (or front the object store directly) can re-point without code changes.
CATALOG_ORIGINAL_BLOB_KIND = os.getenv("CATALOG_ORIGINAL_BLOB_KIND", "original")

HTTP_TIMEOUT = float(os.getenv("INGEST_HTTP_TIMEOUT", "30.0"))
FANOUT_RETRIES = int(os.getenv("INGEST_FANOUT_RETRIES", "3"))

# Catalog list page size for the reconcile sweep (GET /images is paginated).
CATALOG_PAGE_SIZE = int(os.getenv("RECONCILE_CATALOG_PAGE_SIZE", "500"))

SUPPORTED_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}

# Thumbnail geometry (longest edge, px). WebP output.
THUMBNAIL_MAX_EDGE = int(os.getenv("INGEST_THUMBNAIL_MAX_EDGE", "512"))
THUMBNAIL_QUALITY = int(os.getenv("INGEST_THUMBNAIL_QUALITY", "80"))


def _mime_for_extension(ext: str) -> str:
    ext = ext.lower()
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    return "application/octet-stream"


# ---------------------------------------------------------------------------
# Local pixel work (sha256 / phash / dims / thumbnail)
# ---------------------------------------------------------------------------
def compute_sha256(data: bytes) -> str:
    """Lowercase-hex SHA-256 of the raw image bytes — the cross-service id."""
    return hashlib.sha256(data).hexdigest()


def compute_phash(data: bytes) -> str | None:
    """64-bit perceptual hash (pHash) as a 16-char hex string, or None."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            return str(imagehash.phash(im))
    except Exception:
        return None


def compute_dims(data: bytes) -> tuple[int | None, int | None]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return im.width, im.height
    except Exception:
        return None, None


def make_webp_thumbnail(data: bytes, max_edge: int = THUMBNAIL_MAX_EDGE) -> bytes | None:
    """Downscale to fit ``max_edge`` and encode as WebP. Returns bytes or None."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            im.thumbnail((max_edge, max_edge))
            out = io.BytesIO()
            im.save(out, format="WEBP", quality=THUMBNAIL_QUALITY)
            return out.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Outbound clients (monkeypatched in tests)
# ---------------------------------------------------------------------------
def extract_metadata(data: bytes, filename: str, mime: str) -> dict[str, Any]:
    """POST image bytes to deedlit.metadata /extract; return the ExtractResult.

    A 422 (no recognized metadata) degrades to an empty-ish result rather than
    failing the file — the image is still cataloged with sha256/phash/dims.
    """
    files = {"file": (filename, data, mime)}
    resp = httpx.post(f"{METADATA_URL}/extract", files=files, timeout=HTTP_TIMEOUT)
    if resp.status_code == 422:
        return {
            "sourceTool": "unknown",
            "prompt": None,
            "negative": None,
            "tags": [],
            "params": {},
            "references": {},
            "workflow_json": None,
            "api_prompt_json": None,
        }
    resp.raise_for_status()
    return resp.json()


def embed_image(data: bytes, filename: str, mime: str) -> list[float]:
    """POST image bytes to deedlit.vision /embed/image; return the dense vector."""
    files = {"file": (filename, data, mime)}
    resp = httpx.post(f"{VISION_URL}/embed/image", files=files, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    body = resp.json()
    # The contract names the field `vector`; the live service returns `embedding`.
    return body.get("vector") or body.get("embedding") or []


def embed_sparse(text: str) -> dict[str, list]:
    """POST text to deedlit.vision /embed/sparse; return {indices, values}."""
    resp = httpx.post(
        f"{VISION_URL}/embed/sparse", json={"text": text}, timeout=HTTP_TIMEOUT
    )
    resp.raise_for_status()
    body = resp.json()
    return {"indices": body.get("indices", []), "values": body.get("values", [])}


# ---------------------------------------------------------------------------
# Maintenance boundary (read image bytes / trigger rebuilds) — monkeypatched
# ---------------------------------------------------------------------------
def fetch_image_bytes(sha256: str) -> tuple[bytes, str]:
    """GET the raw original bytes of an image by sha256 from catalog (#17).

    Used by the ``reindex-one-image`` maintenance job, which re-runs the per-file
    pipeline for a single already-cataloged image. The cross-service id is the
    sha256, so the blob read is keyed by it. Returns ``(bytes, mime)``.

    Reads the original bytes from the catalog's sha256-keyed RustFS object store
    via ``GET /blobs/{sha256}/{CATALOG_ORIGINAL_BLOB_KIND}`` (no longer the TS
    app). See ``CATALOG_ORIGINAL_BLOB_KIND`` for the blob-kind caveat.
    """
    url = f"{CATALOG_URL}/blobs/{sha256}/{CATALOG_ORIGINAL_BLOB_KIND}"
    resp = httpx.get(url, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    mime = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
    return resp.content, mime


def rebuild_thumbnails() -> dict[str, Any]:
    """Regenerate thumbnails from catalog originals (catalog-owned rebuild, #17).

    Thumbnails are catalog RustFS blobs, so the rebuild is owned by catalog. The
    catalog contract has no dedicated thumbnail-rebuild verb, so this drives the
    catalog ``POST /rebuild`` path (the owning-service rebuild entrypoint); the
    ingest job wraps it for the standard progress/cancel lifecycle.
    """
    resp = httpx.post(f"{CATALOG_URL}/rebuild", timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Reconcile boundary (issue #21) — catalog coverage + projection probes/repair
#
# These talk DIRECTLY to the per-service contracts (catalog/search/graph), not
# the TS app, because reconcile is the eventual-consistency backstop for the
# fan-out write model and must compare each store's actual coverage.
#
# All four are thin module-level wrappers so tests can monkeypatch them and stay
# offline/deterministic.
# ---------------------------------------------------------------------------
def list_catalog_sha256() -> list[str]:
    """List every sha256 the catalog holds — the set that SHOULD be projected.

    Pages through catalog ``GET /images`` (limit/offset) until a short page is
    returned. Catalog is the source of truth, so this is the reference set the
    search and graph projections are reconciled against.
    """
    out: list[str] = []
    offset = 0
    while True:
        resp = httpx.get(
            f"{CATALOG_URL}/images",
            params={"limit": CATALOG_PAGE_SIZE, "offset": offset},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        for row in rows:
            sha = row.get("sha256") if isinstance(row, dict) else None
            if sha:
                out.append(sha)
        if len(rows) < CATALOG_PAGE_SIZE:
            break
        offset += CATALOG_PAGE_SIZE
    return out


def search_has(sha256: str) -> bool:
    """Coverage probe: is ``sha256`` present in the search (Qdrant) projection?

    The search contract has no "list covered ids" endpoint, so we use the
    cheapest per-id probe available: ``POST /by-image`` does an image-to-image
    search using the *stored* point's dense vector. A 200 means the point exists
    (a missing point yields a 4xx); any other status / transport error is treated
    as "not covered" so reconcile repairs it rather than silently skipping.
    """
    try:
        resp = httpx.post(
            f"{SEARCH_URL}/by-image",
            json={"sha256": sha256, "limit": 1},
            timeout=HTTP_TIMEOUT,
        )
    except httpx.TransportError:
        return False
    return resp.status_code == 200


def graph_has(sha256: str) -> bool:
    """Coverage probe: is ``sha256`` present in the graph (Neo4j) projection?

    The graph contract has no "list covered ids" endpoint either, so we probe
    ``GET /neighbors/{sha256}``: a 200 means the node exists in the graph (even
    with zero neighbors); a 404 / error means it is missing and must be repaired.
    """
    try:
        resp = httpx.get(
            f"{GRAPH_URL}/neighbors/{sha256}",
            params={"limit": 1},
            timeout=HTTP_TIMEOUT,
        )
    except httpx.TransportError:
        return False
    return resp.status_code == 200


def rebuild_search() -> dict[str, Any]:
    """Rebuild the search projection from catalog (search ``POST /rebuild``)."""
    resp = httpx.post(f"{SEARCH_URL}/rebuild", timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {}


def rebuild_graph() -> dict[str, Any]:
    """Rebuild the graph projection from catalog (graph ``POST /rebuild``)."""
    resp = httpx.post(f"{GRAPH_URL}/rebuild", timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {}


def reindex_image(sha256: str) -> None:
    """Targeted per-image repair: re-run the full pipeline for one sha256.

    Used when only a few images drift (cheaper than a full collection rebuild).
    Fetches the original bytes, runs the per-file pipeline, and fans the writes
    back out — the same path :class:`reindex-one-image` takes — so both the
    search point and graph edges for that image are re-projected.
    """
    data, mime = fetch_image_bytes(sha256)
    filename = f"{sha256}{_reconcile_ext_for_mime(mime)}"
    rec = process_file(data, filename)
    fan_out_writes(rec)


def _reconcile_ext_for_mime(mime: str) -> str:
    return {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
    }.get(mime.lower(), ".png")


# ---------------------------------------------------------------------------
# Record assembly
# ---------------------------------------------------------------------------
def _references_list(references: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Flatten the metadata References object into catalog/graph AssetRef rows.

    Metadata returns ``{checkpoints:[...], loras:[...], ...}``; catalog/graph
    want a flat ``[{kind, name, hash}]`` list keyed by singular kind.
    """
    if not references:
        return []
    kind_for = {
        "checkpoints": "checkpoint",
        "loras": "lora",
        "embeddings": "embedding",
        "vae": "vae",
        "controlnets": "controlnet",
        "upscalers": "upscaler",
    }
    out: list[dict[str, Any]] = []
    for plural, kind in kind_for.items():
        for ref in references.get(plural, []) or []:
            out.append({"kind": kind, "name": ref.get("name"), "hash": ref.get("hash")})
    return out


@dataclass
class IngestRecord:
    """Assembled per-file result: a catalog record, a search point, graph edges."""

    sha256: str
    record: dict[str, Any]
    point: dict[str, Any]
    edges: dict[str, Any]
    thumbnail: bytes | None = None


def assemble_record(
    *,
    sha256: str,
    phash: str | None,
    width: int | None,
    height: int | None,
    extract: dict[str, Any],
    dense: list[float],
    sparse: dict[str, list],
    thumbnail: bytes | None,
) -> IngestRecord:
    references = _references_list(extract.get("references"))
    tags = extract.get("tags") or []
    params = extract.get("params") or {}

    record = {
        "sha256": sha256,
        "phash": phash,
        "width": width,
        "height": height,
        "sourceTool": (
            None if extract.get("sourceTool") in (None, "unknown") else extract.get("sourceTool")
        ),
        "prompt": extract.get("prompt"),
        "negative": extract.get("negative"),
        "tags": tags,
        "params": params,
        "references": references,
        "workflow_json": extract.get("workflow_json"),
        "api_prompt_json": extract.get("api_prompt_json"),
    }

    # search UpsertPoint: {sha256, dense, sparse?, payload?}. Search keys the
    # Qdrant point by uuid5(sha256) itself; we surface the derived id in the
    # payload so consumers that read points back can resolve it without
    # recomputing.
    point = {
        "sha256": sha256,
        "dense": dense,
        "sparse": sparse,
        "payload": {"sha256": sha256, "point_id": point_id_for_sha256(sha256), "tags": tags},
    }

    edges = {
        "sha256": sha256,
        "references": references,
        "tags": tags,
        "lineage": [],
    }

    return IngestRecord(
        sha256=sha256,
        record=record,
        point=point,
        edges=edges,
        thumbnail=thumbnail,
    )


# ---------------------------------------------------------------------------
# Per-file pipeline
# ---------------------------------------------------------------------------
def process_file(data: bytes, filename: str) -> IngestRecord:
    """Run the full single-file pipeline over raw image bytes.

    Computes sha256/phash/dims/thumbnail locally, then calls metadata + vision,
    then assembles the record/point/edges. Does NOT persist — see
    :func:`fan_out_writes`.
    """
    ext = os.path.splitext(filename)[1].lower()
    mime = _mime_for_extension(ext)

    sha256 = compute_sha256(data)
    phash = compute_phash(data)
    width, height = compute_dims(data)
    thumbnail = make_webp_thumbnail(data)

    extract = extract_metadata(data, filename, mime)
    log.debug("%s sha=%s tool=%s dims=%sx%s", filename, sha256[:12], extract.get("sourceTool"), width, height)
    dense = embed_image(data, filename, mime)
    # Sparse vector is over the prompt text (lexical/term weights for hybrid).
    prompt_text = extract.get("prompt") or " ".join(extract.get("tags") or [])
    sparse = embed_sparse(prompt_text) if prompt_text.strip() else {"indices": [], "values": []}
    log.debug("%s dense_dim=%d sparse_terms=%d", sha256[:12], len(dense), len(sparse.get("indices", [])))

    return assemble_record(
        sha256=sha256,
        phash=phash,
        width=width,
        height=height,
        extract=extract,
        dense=dense,
        sparse=sparse,
        thumbnail=thumbnail,
    )


# ---------------------------------------------------------------------------
# Fan-out (catalog-first, per-store retry)
# ---------------------------------------------------------------------------
def _request_with_retry(
    send,
    label: str,
    retries: int = FANOUT_RETRIES,
) -> None:
    """Run ``send`` with per-store retry on transient failure (5xx / network).

    ``send`` is a zero-arg callable returning an ``httpx.Response``; ``label`` is
    used only for the raised error message. A 5xx (or transport error) is
    retried; a 4xx fails fast (the request itself is wrong and won't recover).
    """
    last_exc: Exception | None = None
    for _attempt in range(retries):
        try:
            resp = send()
            if resp.status_code >= 500:
                last_exc = httpx.HTTPStatusError(
                    f"{label} -> {resp.status_code}", request=resp.request, response=resp
                )
                continue
            resp.raise_for_status()
            return
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            continue
    assert last_exc is not None
    raise last_exc


def _post_with_retry(url: str, json_body: dict[str, Any], retries: int = FANOUT_RETRIES) -> None:
    """POST JSON with per-store retry on transient failure (5xx / network)."""
    _request_with_retry(
        lambda: httpx.post(url, json=json_body, timeout=HTTP_TIMEOUT), url, retries
    )


def _put_blob_with_retry(
    url: str, data: bytes, content_type: str, retries: int = FANOUT_RETRIES
) -> None:
    """PUT raw blob bytes with per-store retry on transient failure."""
    _request_with_retry(
        lambda: httpx.put(
            url,
            content=data,
            headers={"content-type": content_type},
            timeout=HTTP_TIMEOUT,
        ),
        url,
        retries,
    )


def fan_out_writes(rec: IngestRecord) -> None:
    """Persist one record directly to the owning services (catalog/search/graph).

    Order is catalog/truth FIRST (the source of truth must land before the
    derived projections), then the search point, then graph edges. Each store
    gets its own retry. If catalog fails after retries the whole file fails
    (the derived stores would point at a missing record); search/graph failures
    propagate too so the file is recorded as failed and can be re-run.

    Targets (issue #17 — direct to owning services, no longer the TS app):
      1. catalog  POST /images                 record (ImageUpsert)
         catalog  PUT  /blobs/{sha}/thumbnail  thumbnail blob (if present)
      2. search   POST /points                 dense + sparse + payload
      3. graph    POST /edges                   references/tags/lineage
    """
    sha = rec.sha256
    # 1. catalog / truth FIRST: the record, then its thumbnail blob. The record
    #    must land before the blob (the blob hangs off the cataloged image) and
    #    before the derived projections.
    _post_with_retry(f"{CATALOG_URL}/images", rec.record)
    if rec.thumbnail is not None:
        _put_blob_with_retry(
            f"{CATALOG_URL}/blobs/{sha}/thumbnail", rec.thumbnail, "image/webp"
        )
    # 2. search: dense + sparse point (keyed by uuid5(sha256) inside search).
    _post_with_retry(f"{SEARCH_URL}/points", rec.point)
    # 3. graph: reference/tag/lineage edges.
    _post_with_retry(f"{GRAPH_URL}/edges", rec.edges)
    log.debug("fan-out OK %s -> catalog+search+graph", sha[:12])
