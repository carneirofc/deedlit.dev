"""Best-effort writer for the catalog tasks ledger (#27, ADR 0001).

RabbitMQ is the source of truth for *what work remains*; the catalog ``tasks``
table is a queryable HISTORY projection. Every write here is best-effort: a
failure is logged at debug and swallowed so it can NEVER fail the actual task or
stall a consumer. The ingest publisher records ``queued``; the worker records
``running`` / ``done`` / ``failed`` / ``dlq`` as a delivery settles.
"""
from __future__ import annotations

import asyncio
import inspect
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


# Strong refs to in-flight fire-and-forget writes so the loop doesn't GC a task
# mid-flight (asyncio only holds a weak ref to a bare create_task result).
_bg_tasks: set[asyncio.Task] = set()


def record_task_bg(
    sha256: str | None,
    task_type: str | None,
    status: str,
    attempts: int | None = None,
    error: str | None = None,
    parent_op_id: str | None = None,
) -> None:
    """Schedule a ledger write WITHOUT awaiting it (fire-and-forget).

    The ledger is best-effort observability, so the hot paths (the consumer ack
    path, the producer fan-out) must never block on a catalog round-trip for it.
    This schedules :func:`record_task` on the running loop and returns immediately;
    the write completes off the critical path and swallows its own errors. A no-op
    when no loop is running (e.g. a sync caller outside the worker). Tolerates a
    monkeypatched sync ``record_task`` (the test stub) via the isawaitable check.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        try:
            result = record_task(sha256, task_type, status, attempts, error, parent_op_id)
            if inspect.isawaitable(result):
                await result
        except Exception:  # noqa: BLE001 — best-effort; never surface
            pass

    task = loop.create_task(_run())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
