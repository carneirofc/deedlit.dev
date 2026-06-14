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
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
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

# Optional deedlit.labelagent — a vision LLM that describes/labels the image to
# enrich semantic indexing. DISABLED when unset (empty string), so ingest works
# unchanged without it; when set, a describe failure degrades to no AI text
# rather than failing the file (mirrors the metadata 422 degrade path).
LABELAGENT_URL = os.getenv("LABELAGENT_URL", "").rstrip("/")

# Browser-reachable base URL of the comfyhelper UI. The image/thumbnail proxy
# endpoints (/api/library/images/{sha}/file, /thumbnail) live here, so we embed
# absolute URLs to them in each search point's payload — a payload consumer (the
# Qdrant dashboard, or the UI rendering a hit) can show/open the image without a
# separate catalog lookup. Matches the TS app's COMFYHELPER_PUBLIC_URL so the
# embedded URLs line up with what that app actually serves.
COMFYHELPER_PUBLIC_URL = os.getenv("COMFYHELPER_PUBLIC_URL", "http://localhost:3000").rstrip("/")

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
THUMBNAIL_MAX_EDGE = int(os.getenv("INGEST_THUMBNAIL_MAX_EDGE", "1080"))
THUMBNAIL_QUALITY = int(os.getenv("INGEST_THUMBNAIL_QUALITY", "100"))


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


def describe_image(
    data: bytes, filename: str, mime: str, prompt_hint: str | None = None
) -> dict[str, Any]:
    """POST the image to deedlit.labelagent /describe; return ``{label,
    description, tags, safety}``.

    Now called ONLY by the async ``label`` task (ADR 0001), so the failure mode is
    deliberately STRICT: when ``LABELAGENT_URL`` is unset the call is skipped and
    ``{}`` is returned (a clean no-op the task treats as "nothing to patch"), but
    any transport/HTTP error PROPAGATES so the broker can retry with backoff and
    eventually dead-letter (``label.dlq``). ``prompt_hint`` (the extracted SD
    prompt) grounds the model.
    """
    if not LABELAGENT_URL:
        return {}
    files = {"file": (filename, data, mime)}
    form = {"prompt_hint": prompt_hint} if prompt_hint else None
    resp = httpx.post(
        f"{LABELAGENT_URL}/describe", files=files, data=form, timeout=HTTP_TIMEOUT
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Maintenance boundary (read image bytes / trigger rebuilds) — monkeypatched
# ---------------------------------------------------------------------------
def fetch_image_bytes(sha256: str) -> tuple[bytes, str]:
    """Read the raw original bytes of an image by sha256 (ADR 0001).

    Used by the index/label workers and the ``reindex-one-image`` job to re-run
    the pipeline for an already-cataloged image. Catalog stores only
    ``thumbnail``/``embedding`` blobs (NOT originals), so the original bytes are
    obtained by resolving the catalog record's stored ``filepath`` and reading
    from the shared host filesystem that ingest already walks. Returns
    ``(bytes, mime)``.

    Raises if the catalog has no filepath for the sha256 or the file is gone — the
    task then fails and is retried / dead-lettered by the broker.
    """
    filepath = fetch_image_filepath(sha256)
    if not filepath:
        raise FileNotFoundError(f"no catalog filepath for sha256={sha256}")
    path = Path(filepath)
    data = path.read_bytes()  # raises FileNotFoundError if the file moved/was deleted
    mime = _mime_for_extension(path.suffix)
    return data, mime


def fetch_image_record(sha256: str) -> dict[str, Any] | None:
    """GET the full catalog record (the source of truth) for ``sha256``, or None.

    Used by the index task (to project from catalog truth — description/safety/
    tags/filepath) and the label task (to read the existing tags to merge into).
    Best-effort: any read failure degrades to None rather than failing the repair.
    """
    try:
        resp = httpx.get(f"{CATALOG_URL}/images/{sha256}", timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, dict) else None
    except (httpx.HTTPError, ValueError):
        return None


def fetch_image_filepath(sha256: str) -> str | None:
    """GET the catalog record's stored source filepath for ``sha256``, or None.

    The reindex paths re-run the pipeline from stored bytes and have no original
    path of their own, so they backfill it from the catalog (the source of
    truth) — otherwise the re-projected search payload would drop the filepath
    that identifies the image. Best-effort: any read failure degrades to None.
    """
    record = fetch_image_record(sha256)
    return record.get("filepath") if record else None


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


# ---------------------------------------------------------------------------
# Source-folder registry boundary (configured-folders feature) — read the
# folder list + write scan-state back to catalog (the registry owner). The
# folder scan scheduler lives here in ingest because ingest owns the host
# filesystem + the pipeline; catalog just persists the registry. Thin wrappers
# so tests monkeypatch them and stay offline.
# ---------------------------------------------------------------------------
def list_source_folders() -> list[dict[str, Any]]:
    """GET the configured source folders from catalog (the registry owner)."""
    resp = httpx.get(f"{CATALOG_URL}/folders", timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    body = resp.json()
    return body if isinstance(body, list) else []


def record_folder_scan(
    folder_id: str,
    *,
    status: str | None = None,
    job_id: str | None = None,
    error: str | None = None,
    touch_last_scan_at: bool = False,
) -> None:
    """PATCH a folder's last-scan state on catalog (status/job/error/timestamp).

    Best-effort: a registry write failure must not fail the scan it describes,
    so transport/HTTP errors are logged and swallowed.
    """
    payload: dict[str, Any] = {}
    if status is not None:
        payload["last_scan_status"] = status
    if job_id is not None:
        payload["last_scan_job_id"] = job_id
    if error is not None:
        payload["last_error"] = error
    if touch_last_scan_at:
        payload["touch_last_scan_at"] = True
    if not payload:
        return
    try:
        resp = httpx.patch(
            f"{CATALOG_URL}/folders/{folder_id}", json=payload, timeout=HTTP_TIMEOUT
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("record_folder_scan failed for %s: %s", folder_id, exc)


def list_unlabeled_sha256() -> list[str]:
    """List every cataloged sha256 missing a labelagent description.

    The work set for the label-backfill sweep. Pages catalog
    ``GET /images/unlabeled`` (which returns ``{sha256: [...]}``) until a short
    page comes back.
    """
    out: list[str] = []
    offset = 0
    while True:
        resp = httpx.get(
            f"{CATALOG_URL}/images/unlabeled",
            params={"limit": CATALOG_PAGE_SIZE, "offset": offset},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        shas = (resp.json() or {}).get("sha256", []) or []
        out.extend(shas)
        if len(shas) < CATALOG_PAGE_SIZE:
            break
        offset += CATALOG_PAGE_SIZE
    return out


def reindex_image(sha256: str) -> None:
    """Index task: (re)build the search+graph projection for one sha256 from
    catalog TRUTH (ADR 0001).

    Reads the catalog record (description/safety/tags/filepath — whatever the
    label task has patched so far), fetches the bytes, runs the per-file pipeline
    (NO labelling), and fans the writes back out so the search point + graph edges
    reflect the current catalog truth. Idempotent: running it twice converges, so
    it is safe to re-enqueue after a label patch or from reconcile.
    """
    data, mime = fetch_image_bytes(sha256)
    filename = f"{sha256}{_reconcile_ext_for_mime(mime)}"
    # Project from catalog truth: the AI fields (description/safety/tags) the
    # label task patched flow into the sparse text + payload + graph edges. The
    # source path keeps the file identity on the re-projected payload.
    record = fetch_image_record(sha256) or {}
    rec = process_file(
        data,
        filename,
        source_path=record.get("filepath"),
        description=record.get("description"),
        safety=record.get("safety"),
        tags=record.get("tags"),
    )
    fan_out_writes(rec)


def label_image(sha256: str) -> bool:
    """Label task: describe one image and PATCH the catalog truth (ADR 0001).

    Reads the bytes + catalog record, calls the labelagent (grounded with the
    extracted prompt), merges the AI tags into the catalog's tags, and writes the
    full catalog record back (COALESCE-friendly upsert — a full record, so no
    field is wiped). Returns True when the catalog was patched (the caller then
    re-enqueues an ``index`` task to re-project), or False when labelling is
    disabled / produced nothing (a clean no-op — no re-index needed).

    A labelagent transport/HTTP error propagates (``describe_image`` is strict),
    so the broker retries with backoff and eventually dead-letters to
    ``label.dlq``.
    """
    data, mime = fetch_image_bytes(sha256)
    filename = f"{sha256}{_reconcile_ext_for_mime(mime)}"
    record = fetch_image_record(sha256) or {}
    extract = extract_metadata(data, filename, mime)
    describe = describe_image(data, filename, mime, prompt_hint=extract.get("prompt"))
    if not describe:
        return False  # labelagent disabled (or empty result) -> nothing to patch
    # Merge the AI tags into the existing catalog tags (AI appended, de-duped,
    # order-stable), falling back to the freshly extracted tags.
    base_tags = record.get("tags") or extract.get("tags") or []
    merged = list(dict.fromkeys([*base_tags, *(describe.get("tags") or [])]))
    patched = build_catalog_record(
        sha256=sha256,
        phash=compute_phash(data),
        width=compute_dims(data)[0],
        height=compute_dims(data)[1],
        extract=extract,
        source_path=record.get("filepath"),
        tags=merged,
        description=describe.get("description"),
        safety=describe.get("safety"),
    )
    _post_with_retry(f"{CATALOG_URL}/images", patched)
    return True


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


def _proxy_urls(sha256: str, ext: str) -> tuple[str, str]:
    """Build ``(image_url, thumbnail_url)`` on the comfyhelper image proxy.

    Both carry a trailing file extension: the original's for the full image and
    always ``.webp`` for the thumbnail (the ingest pipeline only ever writes WebP
    thumbnails). The extension is cosmetic for serving — the proxy route strips
    it via a Next.js rewrite and serves bytes/content-type from the store — but
    it makes the Qdrant dashboard render the payload value as an image preview.
    """
    suffix = ext if ext.startswith(".") else (f".{ext}" if ext else "")
    image_url = f"{COMFYHELPER_PUBLIC_URL}/api/library/images/{sha256}/file{suffix}"
    thumbnail_url = f"{COMFYHELPER_PUBLIC_URL}/api/library/images/{sha256}/thumbnail.webp"
    return image_url, thumbnail_url


@dataclass
class IngestRecord:
    """Assembled per-file result: a catalog record, a search point, graph edges."""

    sha256: str
    record: dict[str, Any]
    point: dict[str, Any]
    edges: dict[str, Any]
    thumbnail: bytes | None = None


def build_catalog_record(
    *,
    sha256: str,
    phash: str | None,
    width: int | None,
    height: int | None,
    extract: dict[str, Any],
    source_path: str | None = None,
    tags: list[str] | None = None,
    description: str | None = None,
    safety: str | None = None,
) -> dict[str, Any]:
    """Build the catalog ImageUpsert record (the source-of-truth row).

    Shared by the synchronous fast path (:func:`ingest_fast`, which has no dense/
    sparse vectors) and the full projection pipeline (:func:`assemble_record`).
    None for ``description``/``safety`` is safe: catalog COALESCEs them so a later
    write never wipes an AI value that an earlier label task already stored.
    """
    return {
        "sha256": sha256,
        # Original on-disk path of the source file (folder-walk ingests). The
        # cross-service id is the opaque sha256, so carrying the source path lets
        # a human tell which file a record came from when inspecting the system.
        # None for paths-unknown ingests (e.g. reindex from stored bytes, where
        # the caller backfills it from the catalog record).
        "filepath": source_path,
        "phash": phash,
        "width": width,
        "height": height,
        "sourceTool": (
            None if extract.get("sourceTool") in (None, "unknown") else extract.get("sourceTool")
        ),
        "prompt": extract.get("prompt"),
        "negative": extract.get("negative"),
        "tags": tags if tags is not None else (extract.get("tags") or []),
        "params": extract.get("params") or {},
        "references": _references_list(extract.get("references")),
        "workflow_json": extract.get("workflow_json"),
        "api_prompt_json": extract.get("api_prompt_json"),
        # AI content-safety class (deedlit.labelagent); None when the labelagent
        # is disabled — catalog COALESCEs None so a reindex never wipes it.
        "safety": safety,
        # AI description (deedlit.labelagent). An expensive vision-LLM result, so
        # it is persisted in the catalog (image_descriptions) — not just the
        # search payload — to stay retrievable/viewable. None when the labelagent
        # is disabled; catalog keeps the existing one so a reindex never wipes it.
        "description": description,
    }


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
    ext: str = "",
    source_path: str | None = None,
    tags: list[str] | None = None,
    description: str | None = None,
    label: str | None = None,
    safety: str | None = None,
) -> IngestRecord:
    references = _references_list(extract.get("references"))
    # ``tags`` is the (already merged) extracted + AI-label tag list; falls back
    # to the extracted tags when the labelagent enrichment is disabled.
    tags = tags if tags is not None else (extract.get("tags") or [])

    record = build_catalog_record(
        sha256=sha256,
        phash=phash,
        width=width,
        height=height,
        extract=extract,
        source_path=source_path,
        tags=tags,
        description=description,
        safety=safety,
    )

    # search UpsertPoint: {sha256, dense, sparse?, payload?}. Search keys the
    # Qdrant point by uuid5(sha256) itself; we surface the derived id in the
    # payload so consumers that read points back can resolve it without
    # recomputing. We also embed the proxy image/thumbnail URLs (with extensions)
    # so a hit can be rendered straight from the payload — and so the Qdrant
    # dashboard shows previews — without a follow-up catalog lookup.
    image_url, thumbnail_url = _proxy_urls(sha256, ext)
    payload = {
        "sha256": sha256,
        "point_id": point_id_for_sha256(sha256),
        "tags": tags,
        "image_url": image_url,
        "thumbnail_url": thumbnail_url,
    }
    # Original source path, surfaced in the payload too, so a point inspected in
    # the Qdrant dashboard is identifiable by its file (not just the opaque
    # sha256). Only added when known so payloads stay clean for path-unknown
    # ingests; mirrors the label/description convention below.
    if source_path:
        payload["filepath"] = source_path
    # AI label/description (deedlit.labelagent) enrich the searchable payload.
    # Only added when present so payloads stay clean when the labelagent is off.
    if label:
        payload["label"] = label
    if description:
        payload["description"] = description
    # Content-safety class drives the app's safety filter on the search/vector
    # path (Qdrant payload filter); only added when classified.
    if safety:
        payload["safety"] = safety
    point = {
        "sha256": sha256,
        "dense": dense,
        "sparse": sparse,
        "payload": payload,
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
def process_file(
    data: bytes,
    filename: str,
    source_path: str | None = None,
    on_stage: Callable[[str], None] | None = None,
    *,
    description: str | None = None,
    safety: str | None = None,
    tags: list[str] | None = None,
) -> IngestRecord:
    """Build the search+graph projection (record/point/edges) from raw bytes.

    Computes sha256/phash/dims/thumbnail + metadata, embeds dense+sparse, then
    assembles record/point/edges. Does NOT label (labelling is the async ``label``
    task, #26 / ADR 0001) and does NOT persist (see :func:`fan_out_writes`).

    ``description``/``safety``/``tags`` carry the catalog TRUTH for the AI-derived
    fields: the label task patches them onto the catalog, and the index task reads
    them back and passes them in here so the projection (sparse text + payload +
    graph edges) reflects them. When omitted (a first-pass before any label, or a
    direct caller), the sparse text falls back to prompt + extracted tags only.

    ``source_path`` is the original on-disk path (kept on the record/payload for
    identification); ``filename`` is only the upload label used for mime
    detection. ``on_stage`` reports the active stage (``hash`` / ``metadata`` /
    ``vision:dense`` / ``vision:sparse``) for the live dashboard.
    """
    stage = on_stage if on_stage is not None else lambda _name: None

    ext = os.path.splitext(filename)[1].lower()
    mime = _mime_for_extension(ext)

    stage("hash")
    sha256 = compute_sha256(data)
    phash = compute_phash(data)
    width, height = compute_dims(data)
    thumbnail = make_webp_thumbnail(data)

    stage("metadata")
    extract = extract_metadata(data, filename, mime)
    # Tags: prefer the explicit catalog-truth list (already merged with AI tags by
    # the label task); fall back to the freshly extracted tags on a first pass.
    final_tags = list(tags) if tags is not None else list(extract.get("tags") or [])

    log.debug("%s sha=%s tool=%s dims=%sx%s", filename, sha256[:12], extract.get("sourceTool"), width, height)
    stage("vision:dense")
    dense = embed_image(data, filename, mime)
    # Sparse vector is over the lexical text: SD prompt + AI description + tags
    # (term weights for the hybrid sparse leg). The AI description (catalog truth)
    # lets images with thin/absent embedded metadata still index on the sparse side.
    stage("vision:sparse")
    sparse_text = " ".join(
        s.strip() for s in (extract.get("prompt"), description, " ".join(final_tags)) if s and s.strip()
    )
    sparse = embed_sparse(sparse_text) if sparse_text.strip() else {"indices": [], "values": []}
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
        ext=ext,
        source_path=source_path,
        tags=final_tags,
        description=description,
        label=None,
        safety=safety,
    )


# ---------------------------------------------------------------------------
# Synchronous fast path (ADR 0001)
# ---------------------------------------------------------------------------
def ingest_fast(
    data: bytes,
    filename: str,
    source_path: str | None = None,
    on_stage: Callable[[str], None] | None = None,
) -> str:
    """Run ONLY the synchronous fast path for one image and return its sha256.

    Local pixel work (sha256/phash/dims/WebP-thumbnail) + metadata extract +
    write the catalog record and thumbnail blob. No GPU, no LLM, no
    search/graph projection — those are done asynchronously by the ``index``
    task the caller publishes once this returns (ADR 0001). The image is in the
    catalog (and renderable via its thumbnail) the moment this completes.

    ``on_stage`` mirrors :func:`process_file`'s progress hook; it is called as the
    pipeline enters each step (``hash`` / ``metadata`` / ``catalog``).
    """
    stage = on_stage if on_stage is not None else lambda _name: None

    ext = os.path.splitext(filename)[1].lower()
    mime = _mime_for_extension(ext)

    stage("hash")
    sha256 = compute_sha256(data)
    phash = compute_phash(data)
    width, height = compute_dims(data)
    thumbnail = make_webp_thumbnail(data)

    stage("metadata")
    extract = extract_metadata(data, filename, mime)

    # Catalog truth only — extracted tags, no AI fields (the label task fills
    # description/safety/AI-tags later, and catalog COALESCEs the None values).
    record = build_catalog_record(
        sha256=sha256,
        phash=phash,
        width=width,
        height=height,
        extract=extract,
        source_path=source_path,
    )

    stage("catalog")
    _post_with_retry(f"{CATALOG_URL}/images", record)
    if thumbnail is not None:
        _put_blob_with_retry(
            f"{CATALOG_URL}/blobs/{sha256}/thumbnail", thumbnail, "image/webp"
        )
    return sha256


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


def fan_out_writes(rec: IngestRecord, on_stage: Callable[[str], None] | None = None) -> None:
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

    ``on_stage`` is the same optional progress hook as :func:`process_file`,
    called with ``catalog`` / ``search`` / ``graph`` as each write begins.
    """
    stage = on_stage if on_stage is not None else lambda _name: None
    sha = rec.sha256
    # 1. catalog / truth FIRST: the record, then its thumbnail blob. The record
    #    must land before the blob (the blob hangs off the cataloged image) and
    #    before the derived projections.
    stage("catalog")
    _post_with_retry(f"{CATALOG_URL}/images", rec.record)
    if rec.thumbnail is not None:
        _put_blob_with_retry(
            f"{CATALOG_URL}/blobs/{sha}/thumbnail", rec.thumbnail, "image/webp"
        )
    # 2. search: dense + sparse point (keyed by uuid5(sha256) inside search).
    stage("search")
    _post_with_retry(f"{SEARCH_URL}/points", rec.point)
    # 3. graph: reference/tag/lineage edges.
    stage("graph")
    _post_with_retry(f"{GRAPH_URL}/edges", rec.edges)
    log.debug("fan-out OK %s -> catalog+search+graph", sha[:12])
