"""Best-effort persistence of the ingest producer config to catalog ``settings``.

:mod:`config` is a pure in-memory override layer (ADR 0002) — fast to read on
every folder scan, no DB driver. To survive a restart, the overrides are mirrored
to the catalog ``settings`` KV store under the ``ingest_config`` key: written on
``PUT /config`` and loaded back on startup to seed :func:`config.update`. Every
call is best-effort (logged + swallowed) so a cold/absent catalog never breaks
config edits or startup.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("deedlit.ingest.settings_client")

CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:8001").rstrip("/")
SETTINGS_TIMEOUT = float(os.getenv("LEDGER_HTTP_TIMEOUT", "5.0"))
INGEST_CONFIG_KEY = "ingest_config"

_client: httpx.AsyncClient | None = None
_client_loop: Any = None


def _get_client() -> httpx.AsyncClient:
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = httpx.AsyncClient(timeout=SETTINGS_TIMEOUT)
        _client_loop = loop
    return _client


async def aclose() -> None:
    global _client, _client_loop
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
    _client_loop = None


async def load() -> dict[str, Any]:
    """Return the persisted ingest config overrides, or {} when absent/down.

    A 404 (no row yet) and any transport error both degrade to {} so a fresh DB
    or a cold catalog simply means "use env defaults"."""
    try:
        resp = await _get_client().get(f"{CATALOG_URL}/settings/{INGEST_CONFIG_KEY}")
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        body = resp.json()
        value = body.get("value") if isinstance(body, dict) else None
        return value if isinstance(value, dict) else {}
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.debug("settings load failed: %s", exc)
        return {}


async def save(overrides: dict[str, Any]) -> bool:
    """Persist the effective ingest config (best-effort). Returns write success."""
    try:
        resp = await _get_client().put(
            f"{CATALOG_URL}/settings/{INGEST_CONFIG_KEY}", json={"value": overrides}
        )
        resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.debug("settings save failed: %s", exc)
        return False
