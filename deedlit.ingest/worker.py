"""deedlit.ingest async task worker entrypoint (ADR 0001).

Runs the SAME codebase/image as the ingest API, but as a consumer process
instead of an HTTP server. It drains the RabbitMQ task queues named in the
``QUEUES`` env (comma-separated) and runs each task to completion; redelivery,
backoff, and dead-lettering are handled by :mod:`broker`.

Deploying this as its own process (compose service ``ingest-worker``) lets the
slow, GPU/LLM-bound work scale independently of the API — e.g. run extra
replicas with ``QUEUES=label`` once the label queue exists (#26).

    docker compose up -d ingest-worker          # QUEUES=index (default)
    QUEUES=label docker compose up -d ...        # a label-only replica (#26)
"""
from __future__ import annotations

if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import asyncio
import logging
import os

import broker
import ledger
import pipeline

# Mirror app.py's package-logger setup so the worker's per-task logs are visible
# (uvicorn isn't running here to configure logging for us).
log = logging.getLogger("deedlit.ingest.worker")
_pkg = logging.getLogger("deedlit.ingest")
if not _pkg.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    _pkg.addHandler(_h)
    _pkg.propagate = False
_pkg.setLevel(os.getenv("INGEST_LOG_LEVEL", "INFO").upper())


async def index_handler(payload: dict) -> None:
    """Build the search+graph projection for one image (ADR 0001).

    Rebuilds entirely from catalog truth: resolve bytes (sha -> catalog filepath
    -> shared disk), embed dense+sparse, upsert the search point and graph edges.
    Idempotent — running it twice converges. ``reindex_image`` is synchronous
    (httpx), so it runs in a thread to avoid blocking the consumer event loop.
    """
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("index task missing sha256")
    await asyncio.to_thread(pipeline.reindex_image, sha256)


async def label_handler(payload: dict) -> None:
    """Label one image, patch the catalog, then re-enqueue an index task (#26).

    ``label_image`` describes the image and patches catalog description/safety/
    AI-tags; when it actually patched (returns True) we publish a fresh ``index``
    task so the description flows into the sparse vector + payload + graph edges.
    A labelagent failure propagates so the broker retries / dead-letters; a
    disabled labelagent is a no-op (no re-index). Runs in a thread (httpx).
    """
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("label task missing sha256")
    changed = await asyncio.to_thread(pipeline.label_image, sha256)
    if changed:
        await broker.publish_index_task(sha256, parent_op_id=payload.get("parent_op_id"))


# Per-queue handlers — a replica drains the subset named in QUEUES.
HANDLERS = {
    broker.INDEX_QUEUE: index_handler,
    broker.LABEL_QUEUE: label_handler,
}


def _ledger_event_factory(queue: str, payload: dict):
    """Build the per-message ledger hook for one delivery (#27).

    Records running/done/failed/dlq to the catalog tasks ledger, best-effort
    (record_task swallows its own errors). Runs in a thread (httpx is sync) so it
    never blocks the consumer event loop.
    """
    sha256 = payload.get("sha256")
    task_type = payload.get("type") or queue
    parent_op_id = payload.get("parent_op_id")

    async def on_event(status: str, attempts: int, error: str | None) -> None:
        await asyncio.to_thread(
            ledger.record_task, sha256, task_type, status, attempts, error, parent_op_id
        )

    return on_event


def _queues_from_env() -> list[str]:
    raw = os.getenv("QUEUES", broker.INDEX_QUEUE)
    return [q.strip() for q in raw.split(",") if q.strip()]


async def main() -> None:
    requested = _queues_from_env()
    queues = [q for q in requested if q in HANDLERS]
    for q in requested:
        if q not in HANDLERS:
            log.warning("no handler for queue %r yet; skipping", q)
    if not queues:
        log.error("no consumable queues from QUEUES=%r; nothing to do", requested)
        return
    log.info("starting ingest worker for queues=%s (amqp=%s)", queues, broker.AMQP_URL)
    try:
        await broker.run_worker(queues, HANDLERS, on_event_factory=_ledger_event_factory)
    finally:
        await broker.close()


if __name__ == "__main__":
    asyncio.run(main())
