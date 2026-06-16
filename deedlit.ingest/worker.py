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
    await pipeline.maybe_await(pipeline.reindex_image(sha256))


async def label_handler(payload: dict) -> None:
    """Label one image, patch the catalog, then re-project the cheap stages (#26).

    ``label_image`` describes the image and patches catalog description/safety/
    AI-tags. When it actually patched (returns True) we re-run only the stages the
    new text affects: ``embed.sparse`` (description/tags feed the sparse vector +
    payload, and it fans into ``index.search``) and ``index.graph`` (tags changed
    the edges). We deliberately do NOT re-publish ``embed.dense`` — the image bytes
    are unchanged, so the persisted dense vector is stable; this removes ADR 0001's
    2x dense embed (ADR 0002). A labelagent failure propagates so the broker
    retries / dead-letters; a disabled labelagent is a no-op. Runs in a thread.
    """
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("label task missing sha256")
    changed = await pipeline.maybe_await(pipeline.label_image(sha256))
    if changed:
        parent = payload.get("parent_op_id")
        await broker.publish_embed_sparse_task(sha256, parent_op_id=parent)
        await broker.publish_index_graph_task(sha256, parent_op_id=parent)


async def ingest_handler(payload: dict) -> None:
    """``ingest`` stage: run the fast path for one source file, then fan out.

    Opt-in cross-process producer (ADR 0002): when ``INGEST_VIA_QUEUE`` routes the
    folder scan through this queue, replicas catalog files in parallel. Reads the
    bytes (shared disk path in the payload), writes the catalog record + thumbnail,
    then publishes the four downstream stages. Downstream-publish errors propagate
    so the broker retries the whole (idempotent) ingest task. Runs the sync fast
    path in a thread.
    """
    path = payload.get("path")
    if not path:
        raise ValueError("ingest task missing path")
    sha256 = await pipeline.maybe_await(pipeline.ingest_path(path))
    await broker.publish_post_ingest(sha256, parent_op_id=payload.get("parent_op_id"))


async def embed_dense_handler(payload: dict) -> None:
    """``embed.dense`` stage: GPU dense-embed, persist to catalog, fan to search.

    On success publishes ``index.search`` — the fan-in stage reads this vector
    (and the sparse one) back from catalog. A vision/transport error propagates so
    the broker retries / dead-letters. Runs in a thread (httpx is sync).
    """
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("embed.dense task missing sha256")
    await pipeline.maybe_await(pipeline.embed_dense(sha256))
    await broker.publish_index_search_task(sha256, parent_op_id=payload.get("parent_op_id"))


async def embed_sparse_handler(payload: dict) -> None:
    """``embed.sparse`` stage: sparse-embed catalog text, persist, fan to search."""
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("embed.sparse task missing sha256")
    await pipeline.maybe_await(pipeline.embed_sparse(sha256))
    await broker.publish_index_search_task(sha256, parent_op_id=payload.get("parent_op_id"))


async def index_search_handler(payload: dict) -> None:
    """``index.search`` stage: FAN-IN dense+sparse -> upsert the search point.

    A no-op when one vector is still missing (the sibling embed stage re-publishes
    this task on its own completion); idempotent when both are present. Publishes
    nothing downstream — it is a DAG leaf.
    """
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("index.search task missing sha256")
    await pipeline.maybe_await(pipeline.index_search(sha256))


async def index_graph_handler(payload: dict) -> None:
    """``index.graph`` stage: upsert graph edges from catalog truth (DAG leaf)."""
    sha256 = payload.get("sha256")
    if not sha256:
        raise ValueError("index.graph task missing sha256")
    await pipeline.maybe_await(pipeline.index_graph(sha256))


# Per-queue handlers — a replica drains the subset named in QUEUES (ADR 0002).
# The GPU-bound embed.dense is its own queue so a `QUEUES=embed.dense` replica set
# scales independently of the cheap I/O stages. ``index`` is the legacy ADR 0001
# monolith, retained so in-flight messages drain during the migration.
HANDLERS = {
    broker.INGEST_QUEUE: ingest_handler,
    broker.EMBED_DENSE_QUEUE: embed_dense_handler,
    broker.EMBED_SPARSE_QUEUE: embed_sparse_handler,
    broker.INDEX_SEARCH_QUEUE: index_search_handler,
    broker.INDEX_GRAPH_QUEUE: index_graph_handler,
    broker.LABEL_QUEUE: label_handler,
    broker.INDEX_QUEUE: index_handler,
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

    # The ledger is per-image (keyed by sha256). An ``ingest`` task is keyed by
    # path (the sha isn't known until the bytes are hashed), so it has no ledger
    # row of its own — the downstream per-image stages it publishes do.
    if not sha256:
        return None

    async def on_event(status: str, attempts: int, error: str | None) -> None:
        await pipeline.maybe_await(
            ledger.record_task(sha256, task_type, status, attempts, error, parent_op_id)
        )

    return on_event


def _queues_from_env() -> list[str]:
    raw = os.getenv("QUEUES", broker.INDEX_QUEUE)
    return [q.strip() for q in raw.split(",") if q.strip()]


def _install_thread_pool() -> None:
    """Size the default executor for the CPU-bound pixel offload (ADR 0002 perf).

    All outbound HTTP is now natively async on the event loop, so the only work
    offloaded via ``asyncio.to_thread`` is the CPU-bound pixel bundle
    (sha256/pHash/dims/lossless-WebP encode) and the disk read. Pillow/hashlib
    release the GIL during that work, so a pool sized to the cores lets the
    encodes for concurrent deliveries overlap across CPUs. Defaults to the broker
    prefetch so a fully-saturated fast queue never queues on threads.
    """
    import concurrent.futures

    workers = int(os.getenv("WORKER_THREADS", str(max(8, broker.PREFETCH))))
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=workers))
    log.info("worker pixel-work thread pool sized to %d", workers)


async def main() -> None:
    _install_thread_pool()
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
        await pipeline.aclose()
        await ledger.aclose()
        await broker.close()


if __name__ == "__main__":
    asyncio.run(main())
