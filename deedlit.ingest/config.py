"""Runtime-tunable ingest config (ADR 0002) — the producer fast-path knobs.

A tiny in-memory override layer over the env defaults, edited live from the
settings panel via the ingest ``GET/PUT /config`` endpoints. Read on every
folder scan (``jobs.ingest_concurrency`` / ``ingest_via_queue``), so a change
takes effect on the next file without a restart.

Process-local on purpose: these are PRODUCER knobs and the producer is the ingest
API process, which is exactly where folder scans run. No DB, no lock — a dict
assignment is atomic under the GIL, and reads tolerate a concurrent write (worst
case the next scan picks up the new value). Consumer-side parallelism (broker
prefetch, worker replicas) is deploy-time and lives in the worker, not here.
"""
from __future__ import annotations

import os
from typing import Any

# Live overrides set via PUT /config; empty => fall back to the env default.
_overrides: dict[str, Any] = {}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_bool_default(name: str, default: bool) -> bool:
    """``_env_bool`` with an explicit default for when the env var is unset."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def runtime() -> dict[str, Any]:
    """The effective config = env defaults with any live overrides applied."""
    return {
        # How many files a folder scan fast-paths at once (inline mode). The fast
        # path is now natively async (pooled HTTP + threaded pixel work), so the
        # default is higher than the old thread-bound value — many files overlap
        # their metadata/catalog round-trips with only a handful of sockets.
        "ingest_concurrency": max(
            1, int(_overrides.get("ingest_concurrency", _env_int("INGEST_CONCURRENCY", 32)))
        ),
        # Route the scan through the `ingest` queue (cross-process pool) instead.
        "ingest_via_queue": bool(_overrides.get("ingest_via_queue", _env_bool("INGEST_VIA_QUEUE"))),
        # Master switch for the vision-LLM (labelagent) enrichment stage. When off,
        # ingest skips publishing `label` tasks (and the label worker no-ops any
        # already-queued ones), so images are cataloged + projected WITHOUT an AI
        # description/safety/tags. On by default; the labelagent must also be
        # configured (LABELAGENT_URL) for it to actually run.
        "llm_enabled": _env_bool_default("INGEST_LLM_ENABLED", True)
        if _overrides.get("llm_enabled") is None
        else bool(_overrides["llm_enabled"]),
    }


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial config patch (validated) and return the effective config."""
    if patch.get("ingest_concurrency") is not None:
        _overrides["ingest_concurrency"] = max(1, int(patch["ingest_concurrency"]))
    if patch.get("ingest_via_queue") is not None:
        _overrides["ingest_via_queue"] = bool(patch["ingest_via_queue"])
    if patch.get("llm_enabled") is not None:
        _overrides["llm_enabled"] = bool(patch["llm_enabled"])
    return runtime()


def reset() -> None:
    """Drop all live overrides (back to env defaults). Used by tests."""
    _overrides.clear()
