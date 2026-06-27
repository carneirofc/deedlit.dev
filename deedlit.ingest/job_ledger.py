"""Best-effort write-through of the JobStore to the catalog ``jobs`` table.

deedlit.ingest is stateless (no DB driver), so the coarse-op Job registry lives
in process memory (``jobs.JobStore``). To survive a restart, each job's snapshot
is mirrored to catalog over HTTP here — the same best-effort pattern as the
per-image ``tasks`` ledger (:mod:`ledger`). A write failure is logged at debug
and swallowed so it can NEVER fail or stall the actual job; on the next restart
the catalog list is hydrated back and any job left mid-flight is marked
interrupted.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("deedlit.ingest.job_ledger")

CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:8001").rstrip("/")
LEDGER_TIMEOUT = float(os.getenv("LEDGER_HTTP_TIMEOUT", "5.0"))

# Own pooled async client (mirrors ledger.get_client), loop-bound + lazily
# created, so best-effort writes reuse keep-alive connections.
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


async def record_job(snapshot: dict[str, Any]) -> bool:
    """Upsert a job snapshot to catalog ``POST /jobs`` (best-effort).

    ``snapshot`` is ``Job.to_persist()`` (snake_case columns). Returns True on a
    successful write (lets tests assert), False on any failure (swallowed).
    """
    try:
        resp = await _get_client().post(f"{CATALOG_URL}/jobs", json=snapshot)
        resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — best-effort observability
        log.debug("job ledger write failed (%s -> %s): %s",
                  snapshot.get("id"), snapshot.get("status"), exc)
        return False


async def list_jobs(limit: int = 200) -> list[dict[str, Any]]:
    """Fetch the persisted job snapshots (newest-updated first) for the restart
    hydrate. Returns [] on any failure so a cold catalog never blocks startup."""
    try:
        resp = await _get_client().get(f"{CATALOG_URL}/jobs", params={"limit": limit})
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, list) else []
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.debug("job ledger list failed: %s", exc)
        return []


async def interrupt_stale() -> list[str]:
    """Ask catalog to flip any queued/running job (from a prior process) to
    interrupted. Returns the ids changed, or [] on failure."""
    try:
        resp = await _get_client().post(f"{CATALOG_URL}/jobs/interrupt-stale")
        resp.raise_for_status()
        body = resp.json()
        return body.get("interrupted", []) if isinstance(body, dict) else []
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.debug("job ledger interrupt-stale failed: %s", exc)
        return []
