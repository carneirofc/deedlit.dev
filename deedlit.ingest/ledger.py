"""Best-effort writer for the catalog tasks ledger (#27, ADR 0001).

RabbitMQ is the source of truth for *what work remains*; the catalog ``tasks``
table is a queryable HISTORY projection. Every write here is best-effort: a
failure is logged at debug and swallowed so it can NEVER fail the actual task or
stall a consumer. The ingest publisher records ``queued``; the worker records
``running`` / ``done`` / ``failed`` / ``dlq`` as a delivery settles.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("deedlit.ingest.ledger")

CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:8001").rstrip("/")
LEDGER_TIMEOUT = float(os.getenv("LEDGER_HTTP_TIMEOUT", "5.0"))

# Own pooled async client (mirrors pipeline.get_client), loop-bound + lazily
# created, so best-effort ledger writes reuse keep-alive connections instead of a
# handshake per transition.
_client: httpx.AsyncClient | None = None
_client_loop: Any = None


def _get_client() -> httpx.AsyncClient:
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = httpx.AsyncClient(timeout=LEDGER_TIMEOUT)
        _client_loop = loop
    return _client


async def aclose() -> None:
    """Close the cached client (worker/API shutdown)."""
    global _client, _client_loop
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    _client_loop = None


async def record_task(
    sha256: str | None,
    task_type: str | None,
    status: str,
    attempts: int | None = None,
    error: str | None = None,
    parent_op_id: str | None = None,
) -> bool:
    """Upsert a task lifecycle transition to catalog ``POST /tasks`` (best-effort).

    Returns True on a successful write (lets tests assert), False on any failure
    (which is swallowed). ``error`` is sent only when non-None, so a success
    transition (``done``) clears a prior error catalog-side; ``attempts`` is sent
    only when known, so the existing retry count is preserved otherwise.
    """
    if not sha256 or not task_type:
        return False
    body: dict[str, Any] = {"sha256": sha256, "type": task_type, "status": status}
    if attempts is not None:
        body["attempts"] = attempts
    if error is not None:
        body["error"] = error
    if parent_op_id is not None:
        body["parent_op_id"] = parent_op_id
    try:
        resp = await _get_client().post(f"{CATALOG_URL}/tasks", json=body)
        resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — ledger is best-effort observability
        log.debug("ledger write failed (%s %s -> %s): %s", task_type, status, sha256, exc)
        return False
