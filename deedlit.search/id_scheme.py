"""Cross-service ID scheme (Python reference implementation).

The canonical cross-service id of an image is the SHA-256 of its raw bytes
(lowercase hex). The Qdrant point id is ``uuid5(NAMESPACE, sha256-hex)``.

This file is the canonical Python copy and is meant to be copied verbatim into
every FastAPI service (no shared source package). It is pinned to the shared
vectors in ``id-scheme/vectors.json`` and MUST NOT diverge. See
``id-scheme/README.md``.
"""
import uuid

# Frozen canonical namespace = uuid5(URL_NAMESPACE, "https://deedlit.dev/id-scheme/v1"). Never change.
NAMESPACE = uuid.UUID("697124e2-0736-5d17-812d-590ba305cb45")


def point_id_for_sha256(sha256_hex: str) -> str:
    """Derive the Qdrant point id from an image's SHA-256 (lowercase hex)."""
    return str(uuid.uuid5(NAMESPACE, sha256_hex.lower()))
