"""RustFS / S3 object store client for the catalog service.

Ports the behavior of
``deedlit.dev.comfyhelper/lib/library/storage/object-store.ts``: an S3 client
configured for a path-style RustFS endpoint, idempotent bucket creation, and
put/get of blobs keyed by sha256.

Blobs are keyed by the cross-service sha256 id and sharded by the first two hex
chars, mirroring the comfyhelper key layout:

  * thumbnail -> ``thumbnails/{shard}/{sha256}.webp``   (image/webp)
  * embedding -> ``embeddings/{shard}/{sha256}.bin``    (application/octet-stream)
  * sparse    -> ``sparse/{shard}/{sha256}.json``       (application/json)

The ``embedding`` (dense vector) and ``sparse`` blobs are the persisted outputs
of the embed.dense / embed.sparse DAG stages (ADR 0002); the catalog is the
fan-in rendezvous where index.search reads both back.

where ``shard = sha256[:2]``. (comfyhelper additionally namespaces by
size/provider-dims in its keys; the catalog blob endpoint exposes the simpler
``{sha256, kind}`` addressing from contracts/catalog.openapi.yaml.)
"""
from __future__ import annotations

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from catalog.config import get_config

# kind -> (key prefix, file extension, content type)
_KIND_SPEC: dict[str, tuple[str, str, str]] = {
    "thumbnail": ("thumbnails", "webp", "image/webp"),
    "embedding": ("embeddings", "bin", "application/octet-stream"),
    "sparse": ("sparse", "json", "application/json"),
}

# The valid blob kinds — the single source of truth for the router allowlists and
# the image-delete cleanup loop, so adding a kind above is enough.
BLOB_KINDS: frozenset[str] = frozenset(_KIND_SPEC)

_client = None
_client_endpoint: str | None = None
_bucket_ready: set[str] = set()


def _spec(kind: str) -> tuple[str, str, str]:
    if kind not in _KIND_SPEC:
        raise ValueError(f"unknown blob kind: {kind!r}")
    return _KIND_SPEC[kind]


def blob_key(sha256: str, kind: str) -> str:
    """Stable, sharded object key for a sha256-addressed blob of ``kind``."""
    prefix, ext, _ = _spec(kind)
    shard = sha256[:2]
    return f"{prefix}/{shard}/{sha256}.{ext}"


def content_type_for(kind: str) -> str:
    return _spec(kind)[2]


def get_client():
    global _client, _client_endpoint
    cfg = get_config().object_store
    if _client is None or _client_endpoint != cfg.endpoint:
        _client = boto3.client(
            "s3",
            endpoint_url=cfg.endpoint,
            region_name=cfg.region,
            aws_access_key_id=cfg.access_key,
            aws_secret_access_key=cfg.secret_key,
            config=BotoConfig(
                s3={"addressing_style": "path" if cfg.force_path_style else "auto"},
                signature_version="s3v4",
            ),
        )
        _client_endpoint = cfg.endpoint
        _bucket_ready.clear()
    return _client


def reset_client() -> None:
    global _client, _client_endpoint
    _client = None
    _client_endpoint = None
    _bucket_ready.clear()


def ensure_bucket() -> None:
    """Create the configured bucket if it does not exist (idempotent, cached)."""
    bucket = get_config().object_store.bucket
    if bucket in _bucket_ready:
        return
    client = get_client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        try:
            client.create_bucket(Bucket=bucket)
        except ClientError:
            # Another worker may have created it concurrently — tolerate.
            pass
    _bucket_ready.add(bucket)


def put_blob(sha256: str, kind: str, body: bytes) -> str:
    """Store a blob and return its ``s3://bucket/key`` URI."""
    ensure_bucket()
    cfg = get_config().object_store
    key = blob_key(sha256, kind)
    get_client().put_object(
        Bucket=cfg.bucket,
        Key=key,
        Body=body,
        ContentType=content_type_for(kind),
    )
    return f"s3://{cfg.bucket}/{key}"


def get_blob(sha256: str, kind: str) -> bytes | None:
    """Fetch a blob's bytes, or ``None`` if it does not exist."""
    cfg = get_config().object_store
    key = blob_key(sha256, kind)
    try:
        res = get_client().get_object(Bucket=cfg.bucket, Key=key)
        return res["Body"].read()
    except ClientError:
        return None


def delete_blob(sha256: str, kind: str) -> bool:
    """Delete a sha256-keyed blob. Returns ``True`` if the store accepted it.

    S3 DeleteObject is idempotent (deleting a missing key still succeeds), so a
    ``True`` result does not prove the blob existed — only that cleanup ran. A
    ``ClientError`` (bucket/endpoint trouble) returns ``False`` so callers can
    treat blob cleanup on image-delete as best-effort.
    """
    cfg = get_config().object_store
    key = blob_key(sha256, kind)
    try:
        get_client().delete_object(Bucket=cfg.bucket, Key=key)
        return True
    except ClientError:
        return False


def blob_ready() -> bool:
    try:
        ensure_bucket()
        return True
    except Exception:
        return False
