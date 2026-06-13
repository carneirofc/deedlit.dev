"""Per-file ingest pipeline + outbound clients.

The pipeline for one image file:

    read bytes -> sha256 (dedup key) -> phash -> dims -> WebP thumbnail (Pillow)
      -> metadata POST /extract
      -> vision POST /embed/image (dense)
      -> vision POST /embed/sparse (sparse, over the extracted prompt text)
      -> assemble a catalog-shaped record + a search point + graph edges
      -> fan out the writes to the TS app's write endpoints (catalog-first,
         per-store retry).

deedlit.ingest holds NO DB drivers. Persistence happens by HTTP fan-out to the
TS app (``APP_WRITE_URL``); re-pointing the fan-out directly at
catalog/search/graph is deferred to issue #17.

The outbound HTTP boundary lives in small module-level functions
(``extract_metadata``, ``embed_image``, ``embed_sparse``, ``fan_out_writes``)
so tests can monkeypatch them and stay offline/deterministic.
"""
from __future__ import annotations

import hashlib
import io
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
import imagehash
from PIL import Image

from id_scheme import point_id_for_sha256

# ---------------------------------------------------------------------------
# Configuration (all overridable via env)
# ---------------------------------------------------------------------------
APP_WRITE_URL = os.getenv("APP_WRITE_URL", "http://localhost:3000").rstrip("/")
METADATA_URL = os.getenv("METADATA_URL", "http://localhost:8005").rstrip("/")
VISION_URL = os.getenv("VISION_URL", "http://localhost:8000").rstrip("/")

HTTP_TIMEOUT = float(os.getenv("INGEST_HTTP_TIMEOUT", "30.0"))
FANOUT_RETRIES = int(os.getenv("INGEST_FANOUT_RETRIES", "3"))

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

    point = {
        "id": point_id_for_sha256(sha256),
        "sha256": sha256,
        "dense": dense,
        "sparse": sparse,
        "payload": {"sha256": sha256, "tags": tags},
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
    dense = embed_image(data, filename, mime)
    # Sparse vector is over the prompt text (lexical/term weights for hybrid).
    prompt_text = extract.get("prompt") or " ".join(extract.get("tags") or [])
    sparse = embed_sparse(prompt_text) if prompt_text.strip() else {"indices": [], "values": []}

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
def _post_with_retry(url: str, json_body: dict[str, Any], retries: int = FANOUT_RETRIES) -> None:
    """POST with per-store retry on transient failure (5xx / network error)."""
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = httpx.post(url, json=json_body, timeout=HTTP_TIMEOUT)
            if resp.status_code >= 500:
                last_exc = httpx.HTTPStatusError(
                    f"{url} -> {resp.status_code}", request=resp.request, response=resp
                )
                continue
            resp.raise_for_status()
            return
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            continue
    assert last_exc is not None
    raise last_exc


def fan_out_writes(rec: IngestRecord) -> None:
    """Persist one record to the TS app's write endpoints.

    Order is catalog/truth FIRST (the source of truth must land before the
    derived projections), then the search point, then graph edges. Each store
    gets its own retry. If catalog fails after retries the whole file fails
    (the derived stores would point at a missing record); search/graph failures
    propagate too so the file is recorded as failed and can be re-run.

    NOTE: this fans out to the TS app (``APP_WRITE_URL``). Re-pointing these
    writes directly at catalog/search/graph is deferred to issue #17.
    """
    # 1. catalog / truth  (record keyed by sha256)
    _post_with_retry(f"{APP_WRITE_URL}/api/library/images", rec.record)
    # 2. search           (dense + sparse point)
    _post_with_retry(f"{APP_WRITE_URL}/api/library/points", rec.point)
    # 3. graph            (reference/tag/lineage edges)
    _post_with_retry(f"{APP_WRITE_URL}/api/library/edges", rec.edges)
