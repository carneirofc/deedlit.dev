"""Per-file ingest pipeline + outbound clients.

Ingest is FULLY QUEUE-DRIVEN (ADR 0001/0002): there is no synchronous in-process
projection. A folder scan only PUBLISHES an ``ingest`` task per file; everything
else runs as an independent, parallel queue stage on the worker pool:

    ingest        -> sha256/phash/dims/WebP-thumbnail + metadata -> catalog
                     record + thumbnail blob (``ingest_fast``), then publishes:
    embed.dense   -> GPU dense vector              -> catalog blob -> index.search
    embed.sparse  -> SPLADE + CLIP-text vectors    -> catalog blobs -> index.search
    index.search  -> fan-in dense+sparse           -> search point
    index.graph   -> reference/tag/lineage edges   -> graph
    label         -> vision-LLM describe           -> catalog patch -> re-project

deedlit.ingest holds NO DB drivers. Each stage persists to the OWNING service
contract directly (contracts/{catalog,search,graph}.openapi.yaml), catalog-first,
per-store retry. The catalog is the fan-in rendezvous; there is no coordinator.

The outbound HTTP boundary lives in small module-level functions
(``extract_metadata``, ``embed_image``, ``embed_sparse_text``, the per-stage DAG
helpers) so tests can monkeypatch them and stay offline/deterministic.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import io
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
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

# Catalog blob kind holding the persisted DENSE vector (ADR 0002). The embed.dense
# stage writes it; index.search + reconcile read it back. Reuses the existing
# catalog ``embedding`` blob kind so the GPU result is durable and reused.
CATALOG_DENSE_BLOB_KIND = os.getenv("CATALOG_DENSE_BLOB_KIND", "embedding")

# Catalog blob kind holding the persisted CLIP-TEXT vector of the AI description —
# the SECOND dense vector (search ``description`` named vector). Written by the
# embed.sparse (text) stage alongside the sparse vector and read back by
# index.search. Optional: absent until the labelagent produces a description, so
# images without one simply carry no description vector.
CATALOG_DESCRIPTION_BLOB_KIND = os.getenv("CATALOG_DESCRIPTION_BLOB_KIND", "embedding_description")

HTTP_TIMEOUT = float(os.getenv("INGEST_HTTP_TIMEOUT", "30.0"))
FANOUT_RETRIES = int(os.getenv("INGEST_FANOUT_RETRIES", "3"))

# Connection-pool ceilings for the shared async client (ADR 0002 perf). The hot
# path fires thousands of small HTTP calls (metadata/vision/catalog/search/graph);
# a pooled client reuses keep-alive connections instead of a TCP+TLS handshake per
# call, which is the dominant cost at high fan-out. Sized generously so the broker
# prefetch / folder-scan concurrency is the limit, not the connection pool.
HTTP_MAX_CONNECTIONS = int(os.getenv("INGEST_HTTP_MAX_CONNECTIONS", "200"))
HTTP_MAX_KEEPALIVE = int(os.getenv("INGEST_HTTP_MAX_KEEPALIVE", "100"))

# Catalog list page size for the reconcile sweep (GET /images is paginated).
CATALOG_PAGE_SIZE = int(os.getenv("RECONCILE_CATALOG_PAGE_SIZE", "500"))

SUPPORTED_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}

# Thumbnail geometry: keep the SHORTER edge at >= this many px, downscaling ONLY
# — a smaller source is kept untouched (never upscaled). This blob doubles as the
# lightbox PREVIEW (the small grid tile is derived from it on demand by the UI's
# /grid route), so it is sized ~1600px for a crisp full-screen view; the true
# original is never served over HTTP (stays off the slow read-only FS).
THUMBNAIL_MIN_EDGE = int(os.getenv("INGEST_THUMBNAIL_MIN_EDGE", "1600"))
# WebP encode tuning. Default is LOSSY: a viewer thumbnail does not need a
# lossless encode, and lossless WebP at high effort was the single most expensive
# CPU op in the pipeline — it dominated ingest CPU and starved the GPU (which sits
# idle until the catalog write lands). Lossy q82 is visually indistinguishable for
# a 1080p viewer image and ~10-50x cheaper to encode. Set
# INGEST_THUMBNAIL_LOSSLESS=true to restore the old lossless behaviour.
#   quality: lossy 0-100 (higher = better + bigger); for lossless it is the
#            compression EFFORT (higher = smaller + slower).
#   method : 0-6 encoder effort (higher = smaller + slower); 4 is the libwebp default.
THUMBNAIL_LOSSLESS = os.getenv("INGEST_THUMBNAIL_LOSSLESS", "false").lower() == "true"
THUMBNAIL_QUALITY = int(os.getenv("INGEST_THUMBNAIL_QUALITY", "82"))
THUMBNAIL_METHOD = int(os.getenv("INGEST_THUMBNAIL_METHOD", "4"))


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
# Shared async HTTP client (pooled, lazily created, loop-bound)
#
# One AsyncClient per running event loop, cached for the process. The hot path is
# I/O-bound (awaiting metadata/vision/catalog/search/graph), so native async +
# connection reuse lets thousands of requests overlap on a handful of sockets —
# far cheaper than a thread-per-request pool. The loop check re-creates the client
# when the running loop changes (e.g. each ``asyncio.run`` in the test suite, or
# the API vs worker loops) so a client is never reused across loops.
# ---------------------------------------------------------------------------
_client: httpx.AsyncClient | None = None
_client_loop: Any = None


def get_client() -> httpx.AsyncClient:
    """Return the shared pooled AsyncClient for the running loop, creating it once."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = httpx.AsyncClient(
            timeout=HTTP_TIMEOUT,
            limits=httpx.Limits(
                max_connections=HTTP_MAX_CONNECTIONS,
                max_keepalive_connections=HTTP_MAX_KEEPALIVE,
            ),
        )
        _client_loop = loop
    return _client


async def aclose() -> None:
    """Close the cached client (worker/API shutdown). Safe to call repeatedly."""
    global _client, _client_loop
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    _client_loop = None


async def maybe_await(value: Any) -> Any:
    """Await ``value`` if it is awaitable, else return it unchanged.

    The outbound boundary functions are async, but tests monkeypatch them with
    plain sync fakes; awaiting through this shim lets the orchestrators accept
    either, so the offline test seam stays sync while production runs native async.
    """
    if inspect.isawaitable(value):
        return await value
    return value


# ---------------------------------------------------------------------------
# Local pixel work (sha256 / phash / dims / thumbnail)
# ---------------------------------------------------------------------------
def compute_sha256(data: bytes) -> str:
    """Lowercase-hex SHA-256 of the raw image bytes — the cross-service id."""
    return hashlib.sha256(data).hexdigest()


def _decode_image(data: bytes) -> Image.Image | None:
    """Decode raw image bytes to a PIL image (forcing the pixel load), or None.

    The single decode point so the per-file pixel work (pHash / dims / thumbnail)
    shares ONE decode instead of re-opening the bytes for each. Image decode (PNG
    especially) is CPU-heavy and was happening twice per file (pHash + thumbnail).
    ``.load()`` forces Pillow's lazy decode to happen here, on the worker thread.
    """
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        return im
    except Exception:
        return None


def _phash_image(im: Image.Image) -> str | None:
    """64-bit pHash as a 16-char hex string from an already-decoded image.

    ``imagehash.phash`` converts to L + resizes internally without mutating ``im``,
    so the same decoded image is reused for the thumbnail afterwards.
    """
    try:
        return str(imagehash.phash(im))
    except Exception:
        return None


def _thumbnail_image(im: Image.Image, min_edge: int = THUMBNAIL_MIN_EDGE) -> bytes | None:
    """Downscale an already-decoded image so its SHORTER edge is ``min_edge`` px
    and encode as WebP (lossy by default; see THUMBNAIL_* config). Downscale only
    — a source already <= ``min_edge`` on its short side is kept at native size
    (never upscaled). Returns bytes or None.
    """
    try:
        rgb = im.convert("RGB")
        width, height = rgb.size
        short = min(width, height)
        if short > min_edge:  # downscale only; keep smaller sources untouched
            scale = min_edge / short
            rgb = rgb.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
        out = io.BytesIO()
        rgb.save(
            out,
            format="WEBP",
            lossless=THUMBNAIL_LOSSLESS,
            quality=THUMBNAIL_QUALITY,
            method=THUMBNAIL_METHOD,
        )
        return out.getvalue()
    except Exception:
        return None


def compute_phash(data: bytes) -> str | None:
    """64-bit perceptual hash (pHash) as a 16-char hex string, or None."""
    im = _decode_image(data)
    return _phash_image(im) if im is not None else None


def compute_dims(data: bytes) -> tuple[int | None, int | None]:
    im = _decode_image(data)
    return (im.width, im.height) if im is not None else (None, None)


def make_webp_thumbnail(data: bytes, min_edge: int = THUMBNAIL_MIN_EDGE) -> bytes | None:
    """Downscale so the SHORTER edge is ``min_edge`` px and encode as WebP (lossy
    by default; see THUMBNAIL_* config). Downscale only — a source already <=
    ``min_edge`` on its short side is kept at native size. Returns bytes or None.
    """
    im = _decode_image(data)
    return _thumbnail_image(im, min_edge) if im is not None else None


def _phash_dims(data: bytes) -> tuple[str | None, int | None, int | None]:
    """pHash + dims from a SINGLE decode (the relabel path's pixel work)."""
    im = _decode_image(data)
    if im is None:
        return None, None, None
    return _phash_image(im), im.width, im.height


def _pixel_work(data: bytes) -> tuple[str, str | None, int | None, int | None, bytes | None]:
    """Run ALL the CPU-bound pixel work for one image in a single call.

    sha256 + pHash + dims + the WebP thumbnail encode. The image is decoded ONCE
    and shared across pHash / dims / thumbnail (decode is CPU-heavy and used to
    run twice per file). These are CPU-bound and cannot be made non-blocking with
    async — Pillow/hashlib release the GIL during the C work, so the orchestrators
    offload this whole bundle to a worker thread (one hop, real cross-core
    parallelism) while their HTTP I/O stays natively async on the event loop.
    """
    sha256 = compute_sha256(data)
    im = _decode_image(data)
    if im is None:
        return sha256, None, None, None, None
    return sha256, _phash_image(im), im.width, im.height, _thumbnail_image(im)


# ---------------------------------------------------------------------------
# Outbound clients (async, pooled; monkeypatched in tests)
# ---------------------------------------------------------------------------
async def extract_metadata(data: bytes, filename: str, mime: str) -> dict[str, Any]:
    """POST image bytes to deedlit.metadata /extract; return the ExtractResult.

    A 422 (no recognized metadata) degrades to an empty-ish result rather than
    failing the file — the image is still cataloged with sha256/phash/dims.
    """
    files = {"file": (filename, data, mime)}
    resp = await get_client().post(f"{METADATA_URL}/extract", files=files)
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


async def embed_image(data: bytes, filename: str, mime: str) -> list[float]:
    """POST image bytes to deedlit.vision /embed/image; return the dense vector.

    Logs the vision round-trip (time + returned dim) so the dense path is visible
    in the worker log — without this the embed.dense stage runs silently and a
    slow/failing vision endpoint is invisible.
    """
    files = {"file": (filename, data, mime)}
    started = time.perf_counter()
    resp = await get_client().post(f"{VISION_URL}/embed/image", files=files)
    resp.raise_for_status()
    body = resp.json()
    # The contract names the field `vector`; the live service returns `embedding`.
    vector = body.get("vector") or body.get("embedding") or []
    log.info(
        "vision /embed/image %s -> dim=%d in %.0f ms",
        filename, len(vector), (time.perf_counter() - started) * 1000,
    )
    return vector


async def embed_sparse_text(text: str) -> dict[str, list]:
    """POST text to deedlit.vision /embed/sparse; return {indices, values}.

    The sparse-vector vision client. Named ``_text`` to distinguish it from the
    ``embed_sparse`` DAG stage (ADR 0002), which embeds an image's catalog text
    and persists the result.
    """
    resp = await get_client().post(f"{VISION_URL}/embed/sparse", json={"text": text})
    resp.raise_for_status()
    body = resp.json()
    return {"indices": body.get("indices", []), "values": body.get("values", [])}


async def embed_text(text: str) -> list[float]:
    """POST text to deedlit.vision /embed/text; return the CLIP *text* dense vector.

    CLIP maps image and text into one space, so this 1024-dim vector is directly
    comparable to the image embedding — it indexes the *meaning of the description*
    as its own (``description``) named vector. Runs on the vision GPU like the
    image embedding.
    """
    started = time.perf_counter()
    resp = await get_client().post(f"{VISION_URL}/embed/text", json={"text": text})
    resp.raise_for_status()
    body = resp.json()
    vector = body.get("vector") or body.get("embedding") or []
    log.info(
        "vision /embed/text -> dim=%d in %.0f ms",
        len(vector), (time.perf_counter() - started) * 1000,
    )
    return vector


async def describe_image(
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
    resp = await get_client().post(f"{LABELAGENT_URL}/describe", files=files, data=form)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Maintenance boundary (read image bytes / trigger rebuilds) — monkeypatched
# ---------------------------------------------------------------------------
async def fetch_image_bytes(sha256: str) -> tuple[bytes, str]:
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
    filepath = await maybe_await(fetch_image_filepath(sha256))
    if not filepath:
        raise FileNotFoundError(f"no catalog filepath for sha256={sha256}")
    return await _read_path_bytes(filepath)


async def _read_path_bytes(path: str) -> tuple[bytes, str]:
    """Read ``(bytes, mime)`` for a source file by on-disk path (off the loop).

    The shared tail of every byte-fetch: the catalog-lookup path resolves a sha256
    to its filepath first, while embed.dense's hot path is handed the filepath
    directly by the producer (skipping the catalog round-trip). Raises
    FileNotFoundError if the file moved/was deleted (the broker then retries)."""
    p = Path(path)
    data = await asyncio.to_thread(p.read_bytes)
    return data, _mime_for_extension(p.suffix)


async def fetch_image_record(sha256: str) -> dict[str, Any] | None:
    """GET the catalog record (the source of truth) for ``sha256``, or None.

    Used by the index task (to project from catalog truth — description/safety/
    tags/filepath) and the label task (to read the existing tags to merge into).
    Both read only light scalar/array fields — never the heavy workflow_json/
    api_prompt_json graphs — so this requests ``?fields=light`` to avoid dragging
    ~100 KB of workflow graph across the wire on every per-image stage.
    Best-effort: any read failure degrades to None rather than failing the repair.
    """
    try:
        resp = await get_client().get(
            f"{CATALOG_URL}/images/{sha256}", params={"fields": "light"}
        )
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, dict) else None
    except (httpx.HTTPError, ValueError):
        return None


async def fetch_image_filepath(sha256: str) -> str | None:
    """GET the catalog record's stored source filepath for ``sha256``, or None.

    The reindex paths re-run the pipeline from stored bytes and have no original
    path of their own, so they backfill it from the catalog (the source of
    truth) — otherwise the re-projected search payload would drop the filepath
    that identifies the image. Best-effort: any read failure degrades to None.
    """
    record = await maybe_await(fetch_image_record(sha256))
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


def list_catalog_filepaths_under(folder: str) -> set[str]:
    """Every on-disk filepath the catalog already holds under ``folder``.

    Backs the folder scan's INCREMENTAL skip: a re-scan only enqueues files whose
    path is not already cataloged, so a scheduled re-walk (or a manual re-ingest)
    of an unchanged library never re-runs the whole projection DAG — the bug that
    let a 60s scan tick re-embed + re-label the entire library forever. Pages
    catalog ``GET /images?path=<folder>`` (the separator-insensitive substring
    filter) and returns the paths normalized to forward slashes for OS-agnostic
    matching against the on-disk walk.
    """
    out: set[str] = set()
    offset = 0
    while True:
        resp = httpx.get(
            f"{CATALOG_URL}/images",
            params={"path": folder, "limit": CATALOG_PAGE_SIZE, "offset": offset},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        for row in rows:
            fp = row.get("filepath") if isinstance(row, dict) else None
            if fp:
                out.add(fp.replace("\\", "/"))
        if len(rows) < CATALOG_PAGE_SIZE:
            break
        offset += CATALOG_PAGE_SIZE
    return out


async def search_has(sha256: str) -> bool:
    """Coverage probe: is ``sha256`` present in the search (Qdrant) projection?

    The search contract has no "list covered ids" endpoint, so we use the
    cheapest per-id probe available: ``POST /by-image`` does an image-to-image
    search using the *stored* point's dense vector. A 200 means the point exists
    (a missing point yields a 4xx); any other status / transport error is treated
    as "not covered" so reconcile repairs it rather than silently skipping.
    """
    try:
        resp = await get_client().post(
            f"{SEARCH_URL}/by-image", json={"sha256": sha256, "limit": 1}
        )
    except httpx.TransportError:
        return False
    return resp.status_code == 200


async def graph_has(sha256: str) -> bool:
    """Coverage probe: is ``sha256`` present in the graph (Neo4j) projection?

    The graph contract has no "list covered ids" endpoint either, so we probe
    ``GET /neighbors/{sha256}``: a 200 means the node exists in the graph (even
    with zero neighbors); a 404 / error means it is missing and must be repaired.
    """
    try:
        resp = await get_client().get(
            f"{GRAPH_URL}/neighbors/{sha256}", params={"limit": 1}
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


def prune_graph_orphans() -> dict[str, Any]:
    """Prune structurally-orphaned graph nodes (graph ``POST /prune``).

    Sweeps the orphan :Asset/:Tag nodes that image deletes leave behind (an
    :Asset/:Tag with no remaining USES/TAGGED edge). Returns the deletion counts
    the graph service reports. Backs the ``prune-graph-orphans`` maintenance job
    and the opt-in periodic prune scheduler."""
    resp = httpx.post(f"{GRAPH_URL}/prune", timeout=HTTP_TIMEOUT)
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


async def label_image(sha256: str) -> bool:
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
    data, mime = await maybe_await(fetch_image_bytes(sha256))
    filename = f"{sha256}{_reconcile_ext_for_mime(mime)}"
    record = await maybe_await(fetch_image_record(sha256)) or {}
    extract = await maybe_await(extract_metadata(data, filename, mime))
    describe = await maybe_await(
        describe_image(data, filename, mime, prompt_hint=extract.get("prompt"))
    )
    if not describe:
        return False  # labelagent disabled (or empty result) -> nothing to patch
    # Merge the AI tags into the existing catalog tags (AI appended, de-duped,
    # order-stable), falling back to the freshly extracted tags.
    base_tags = record.get("tags") or extract.get("tags") or []
    merged = list(dict.fromkeys([*base_tags, *(describe.get("tags") or [])]))
    phash, width, height = await asyncio.to_thread(_phash_dims, data)
    patched = build_catalog_record(
        sha256=sha256,
        phash=phash,
        width=width,
        height=height,
        extract=extract,
        source_path=record.get("filepath"),
        tags=merged,
        description=describe.get("description"),
        safety=describe.get("safety"),
    )
    await maybe_await(_post_with_retry(f"{CATALOG_URL}/images", patched))
    return True


def _reconcile_ext_for_mime(mime: str) -> str:
    return {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
    }.get(mime.lower(), ".png")


# ---------------------------------------------------------------------------
# Per-stage DAG (ADR 0002) — catalog is the fan-in rendezvous
#
# Projection is four independently scalable stages (embed.dense, embed.sparse,
# index.search, index.graph). Each stage persists its output to CATALOG TRUTH and
# the worker publishes the next stage; the one fan-in (``index.search`` needs both
# vectors) is resolved by reading both back from catalog — no coordinator. The
# dense vector is persisted once (the ``embedding`` blob) and reused, so a
# relabel/reindex never recomputes the GPU result.
#
# Vectors round-trip through catalog blobs as JSON:
#   dense  -> /blobs/{sha}/embedding   [floats]
#   sparse -> /blobs/{sha}/sparse      {indices, values}
# These thin boundary wrappers are monkeypatched in tests to stay offline.
# ---------------------------------------------------------------------------
async def store_dense_blob(sha256: str, dense: list[float]) -> None:
    """Persist the dense vector to the catalog ``embedding`` blob (JSON floats)."""
    await maybe_await(_put_blob_with_retry(
        f"{CATALOG_URL}/blobs/{sha256}/{CATALOG_DENSE_BLOB_KIND}",
        json.dumps(dense).encode("utf-8"),
        "application/octet-stream",
    ))


async def store_sparse_blob(sha256: str, sparse: dict[str, list]) -> None:
    """Persist the sparse vector to the catalog ``sparse`` blob (JSON)."""
    await maybe_await(_put_blob_with_retry(
        f"{CATALOG_URL}/blobs/{sha256}/sparse",
        json.dumps(sparse).encode("utf-8"),
        "application/json",
    ))


async def store_description_blob(sha256: str, dense: list[float]) -> None:
    """Persist the CLIP-text description vector to its catalog blob (JSON floats)."""
    await maybe_await(_put_blob_with_retry(
        f"{CATALOG_URL}/blobs/{sha256}/{CATALOG_DESCRIPTION_BLOB_KIND}",
        json.dumps(dense).encode("utf-8"),
        "application/octet-stream",
    ))


async def _load_json_blob(sha256: str, kind: str) -> Any | None:
    """GET a catalog blob and parse it as JSON, or None if absent/unreadable.

    A missing blob (404) is the normal "stage hasn't run yet" signal for the
    fan-in, so it degrades to None rather than raising.
    """
    try:
        resp = await get_client().get(f"{CATALOG_URL}/blobs/{sha256}/{kind}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError):
        return None


async def load_dense_blob(sha256: str) -> list[float] | None:
    """Read the persisted dense vector from catalog, or None if not embedded yet."""
    return await maybe_await(_load_json_blob(sha256, CATALOG_DENSE_BLOB_KIND))


async def load_sparse_blob(sha256: str) -> dict[str, list] | None:
    """Read the persisted sparse vector from catalog, or None if not embedded yet."""
    return await maybe_await(_load_json_blob(sha256, "sparse"))


async def load_description_blob(sha256: str) -> list[float] | None:
    """Read the persisted description vector from catalog, or None if absent.

    Absent is the NORMAL case for an image with no AI description, so index.search
    treats it as optional (unlike dense/sparse, which gate the fan-in).
    """
    return await maybe_await(_load_json_blob(sha256, CATALOG_DESCRIPTION_BLOB_KIND))


async def embed_dense(sha256: str, path: str | None = None) -> None:
    """``embed.dense`` stage: GPU dense-embed one image, persist to catalog.

    Reads the bytes, runs the dense image embedding, and stores the vector as the
    catalog ``embedding`` blob. The worker then publishes ``index.search``; the
    vector is now durable and reused by every later reprojection. A vision/
    transport error propagates so the broker retries / dead-letters.

    ``path`` is the producer's on-disk source path: when supplied (the fresh-ingest
    hot path) the bytes are read straight off disk, skipping the catalog filepath
    lookup that would otherwise gate the GPU call. Absent (reconcile/rebuild
    re-publish) it falls back to ``sha -> catalog filepath -> shared disk``.
    """
    log.info("embed.dense %s: embedding image (label-independent)", sha256[:12])
    data, mime = await maybe_await(
        _read_path_bytes(path) if path else fetch_image_bytes(sha256)
    )
    filename = f"{sha256}{_reconcile_ext_for_mime(mime)}"
    dense = await maybe_await(embed_image(data, filename, mime))
    await maybe_await(store_dense_blob(sha256, dense))
    log.info("embed.dense %s: stored dense vector dim=%d -> catalog", sha256[:12], len(dense))


async def embed_sparse(sha256: str) -> None:
    """``embed.sparse`` stage: TEXT embeddings for one image, persisted to catalog.

    Produces the two text-derived vectors from catalog truth (re-run after a label
    patch so a new description/tags fold in):

      - sparse SPLADE over SD prompt + AI description + tags  -> ``sparse`` blob
      - dense CLIP-text of the AI description (GPU)           -> ``embedding_description`` blob

    The description vector is written ONLY when a description exists — an image
    with no AI description carries no description vector, and index.search treats
    it as optional. The worker then publishes ``index.search``.
    """
    record = await maybe_await(fetch_image_record(sha256)) or {}
    tags = record.get("tags") or []
    sparse_text = " ".join(
        s.strip()
        for s in (record.get("prompt"), record.get("description"), " ".join(tags))
        if s and s.strip()
    )
    sparse = (
        await maybe_await(embed_sparse_text(sparse_text))
        if sparse_text.strip()
        else {"indices": [], "values": []}
    )
    await maybe_await(store_sparse_blob(sha256, sparse))

    # Second dense vector: CLIP-text embedding of the AI description, on the GPU.
    # Embed the description alone (not prompt/tags) so the vector captures the
    # description's meaning; skip the empty string so the vector stays meaningful.
    description = (record.get("description") or "").strip()
    if description:
        description_vec = await maybe_await(embed_text(description))
        await maybe_await(store_description_blob(sha256, description_vec))


def build_search_point(
    sha256: str,
    dense: list[float],
    sparse: dict[str, list],
    record: dict[str, Any],
    description: list[float] | None = None,
) -> dict[str, Any]:
    """Assemble the search UpsertPoint from the vectors + catalog truth.

    Sources the payload fields (tags/filepath/description/safety) from the catalog
    record — the index.search stage projects from truth, not from bytes.

    ``description`` is the optional CLIP-text vector; it is added to the point only
    when present so an image without an AI description indexes on dense + sparse.
    """
    filepath = record.get("filepath")
    ext = os.path.splitext(filepath)[1].lower() if filepath else ""
    image_url, thumbnail_url = _proxy_urls(sha256, ext)
    tags = record.get("tags") or []
    payload: dict[str, Any] = {
        "sha256": sha256,
        "point_id": point_id_for_sha256(sha256),
        "tags": tags,
        "image_url": image_url,
        "thumbnail_url": thumbnail_url,
    }
    if filepath:
        payload["filepath"] = filepath
    if record.get("description"):
        payload["description"] = record["description"]
    if record.get("safety"):
        payload["safety"] = record["safety"]
    point: dict[str, Any] = {"sha256": sha256, "dense": dense, "sparse": sparse, "payload": payload}
    if description:
        point["description"] = description
    return point


async def index_search(sha256: str) -> bool:
    """``index.search`` stage: FAN-IN dense+sparse -> upsert the search point.

    Reads BOTH vectors back from catalog (the rendezvous). When either is missing
    the stage is a clean no-op (returns False) — the sibling embed stage publishes
    ``index.search`` again on its own completion, and whichever runs second finds
    both present and upserts. Idempotent: a duplicate upsert is wasted work, never
    incorrect. Returns True when the point was upserted.

    Only the two GATING reads (dense + sparse) are fired up front, CONCURRENTLY.
    The first of the two index.search publishes is ALWAYS a no-op (one vector
    still missing), so deferring the record + optional description reads until
    BOTH vectors are present keeps that common no-op down to two blob GETs instead
    of four. The description vector is OPTIONAL — its absence never blocks the
    fan-in.
    """
    dense, sparse = await asyncio.gather(
        maybe_await(load_dense_blob(sha256)),
        maybe_await(load_sparse_blob(sha256)),
    )
    if dense is None or sparse is None:
        # Not an error: the sibling embed stage re-publishes index.search on its
        # own completion. Logged at INFO so a point still waiting on one vector is
        # visible (e.g. dense present, sparse pending) rather than silently absent.
        log.info(
            "index.search %s waiting on vectors (dense=%s sparse=%s)",
            sha256[:12], dense is not None, sparse is not None,
        )
        return False
    # Both vectors present — NOW read the record + optional description vector
    # (concurrently), the reads the no-op path above never has to make.
    description, record = await asyncio.gather(
        maybe_await(load_description_blob(sha256)),
        maybe_await(fetch_image_record(sha256)),
    )
    record = record or {}
    point = build_search_point(sha256, dense, sparse, record, description=description)
    await maybe_await(_post_with_retry(f"{SEARCH_URL}/points", point))
    log.info(
        "index.search %s: upserted point (dense dim=%d, sparse terms=%d, description=%s)",
        sha256[:12], len(dense), len(sparse.get("indices", [])), description is not None,
    )
    return True


async def index_graph(sha256: str) -> None:
    """``index.graph`` stage: upsert graph edges from catalog truth (no vectors).

    References/tags/lineage come straight from the catalog record (the references
    are already the flat AssetRef list), so this stage needs neither bytes nor
    embeddings and runs in parallel with the embed stages.
    """
    record = await maybe_await(fetch_image_record(sha256)) or {}
    edges = {
        "sha256": sha256,
        "references": record.get("references") or [],
        "tags": record.get("tags") or [],
        "lineage": [],
    }
    await maybe_await(_post_with_retry(f"{GRAPH_URL}/edges", edges))


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


def file_created_at_iso(source_path: str | None) -> str | None:
    """Best-effort source-file creation time as a UTC ISO-8601 string, or None.

    Uses the file's mtime (last content write) — for an AI-generated image that
    is when it was saved, the meaningful "creation" time. (st_ctime is inode
    change on Linux, not creation, so mtime is the portable choice.) A missing or
    unreadable path degrades to None: the catalog then falls back to import time.
    """
    if not source_path:
        return None
    try:
        mtime = os.stat(source_path).st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()


def build_catalog_record(
    *,
    sha256: str,
    phash: str | None,
    width: int | None,
    height: int | None,
    extract: dict[str, Any],
    source_path: str | None = None,
    created_at: str | None = None,
    tags: list[str] | None = None,
    description: str | None = None,
    safety: str | None = None,
) -> dict[str, Any]:
    """Build the catalog ImageUpsert record (the source-of-truth row).

    Used by the ``ingest`` stage (:func:`ingest_fast`, catalog record only) and the
    ``label`` stage (:func:`label_image`, a full record patch carrying the AI
    description/safety/tags). None for ``description``/``safety`` is safe: catalog
    COALESCEs them so a later write never wipes an AI value an earlier label stored.
    """
    return {
        "sha256": sha256,
        # Original on-disk path of the source file (folder-walk ingests). The
        # cross-service id is the opaque sha256, so carrying the source path lets
        # a human tell which file a record came from when inspecting the system.
        # None for paths-unknown ingests (e.g. reindex from stored bytes, where
        # the caller backfills it from the catalog record).
        "filepath": source_path,
        # Source-file creation time (captured on first ingest). None on the
        # reproject/reindex path — catalog keeps the value from first ingest.
        "createdAt": created_at,
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


# ---------------------------------------------------------------------------
# ``ingest`` stage — fast catalog write (ADR 0001/0002)
#
# The body of the ``ingest`` queue handler: local pixel work + metadata + the
# catalog record + thumbnail blob. NO projection runs here — the worker publishes
# the per-stage DAG (embed.dense/embed.sparse/index.graph/label) once this lands.
# ---------------------------------------------------------------------------
async def ingest_fast(
    data: bytes,
    filename: str,
    source_path: str | None = None,
    on_stage: Callable[[str], None] | None = None,
) -> str:
    """Run the ``ingest`` stage for one image and return its sha256.

    Local pixel work (sha256/phash/dims/WebP-thumbnail) + metadata extract +
    write the catalog record and thumbnail blob. No GPU, no LLM, no
    search/graph projection — the worker publishes those per-stage DAG tasks once
    this returns (ADR 0001/0002). The image is in the catalog (and renderable via
    its thumbnail) the moment this completes.

    ``on_stage`` is the optional progress hook, called as the stage enters each
    step (``hash`` / ``metadata`` / ``catalog``).
    """
    stage = on_stage if on_stage is not None else lambda _name: None

    ext = os.path.splitext(filename)[1].lower()
    mime = _mime_for_extension(ext)

    stage("hash")
    sha256, phash, width, height, thumbnail = await asyncio.to_thread(_pixel_work, data)

    stage("metadata")
    extract = await maybe_await(extract_metadata(data, filename, mime))

    # Catalog truth only — extracted tags, no AI fields (the label task fills
    # description/safety/AI-tags later, and catalog COALESCEs the None values).
    record = build_catalog_record(
        sha256=sha256,
        phash=phash,
        width=width,
        height=height,
        extract=extract,
        source_path=source_path,
        created_at=file_created_at_iso(source_path),
    )

    stage("catalog")
    await maybe_await(_post_with_retry(f"{CATALOG_URL}/images", record))
    if thumbnail is not None:
        await maybe_await(_put_blob_with_retry(
            f"{CATALOG_URL}/blobs/{sha256}/thumbnail", thumbnail, "image/webp"
        ))
    return sha256


async def ingest_path(path: str) -> str:
    """Read one source file and run the fast path (ADR 0002).

    The ``ingest`` queue handler's body: read the bytes from the shared disk path
    and fast-path them (catalog record + thumbnail), returning the sha256 so the
    worker can publish the downstream stage tasks. Read errors propagate so the
    broker retries / dead-letters the ingest task.
    """
    p = Path(path)
    data = await asyncio.to_thread(p.read_bytes)
    return await maybe_await(ingest_fast(data, p.name, str(p)))


# ---------------------------------------------------------------------------
# Fan-out (catalog-first, per-store retry)
# ---------------------------------------------------------------------------
async def _request_with_retry(
    send: Callable[[], Awaitable[Any]],
    label: str,
    retries: int = FANOUT_RETRIES,
) -> None:
    """Run ``send`` with per-store retry on transient failure (5xx / network).

    ``send`` is a zero-arg callable returning an awaitable ``httpx.Response``;
    ``label`` is used only for the raised error message. A 5xx (or transport
    error) is retried; a 4xx fails fast (the request is wrong and won't recover).
    """
    last_exc: Exception | None = None
    for _attempt in range(retries):
        try:
            resp = await send()
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


async def _post_with_retry(url: str, json_body: dict[str, Any], retries: int = FANOUT_RETRIES) -> None:
    """POST JSON with per-store retry on transient failure (5xx / network)."""
    client = get_client()
    await _request_with_retry(lambda: client.post(url, json=json_body), url, retries)


async def _put_blob_with_retry(
    url: str, data: bytes, content_type: str, retries: int = FANOUT_RETRIES
) -> None:
    """PUT raw blob bytes with per-store retry on transient failure."""
    client = get_client()
    await _request_with_retry(
        lambda: client.put(url, content=data, headers={"content-type": content_type}),
        url,
        retries,
    )

