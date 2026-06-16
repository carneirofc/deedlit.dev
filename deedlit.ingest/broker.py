"""RabbitMQ broker seam for the async index/label task queues (ADR 0001).

deedlit.ingest is otherwise stateless and HTTP-only; this module is the one place
that talks AMQP. The fast path (the API process) PUBLISHES tasks here; the
``worker.py`` entrypoint CONSUMES them. RabbitMQ is the source of truth for "what
work remains"; the catalog ``tasks`` ledger (issue #27) is a separate best-effort
history projection.

Topology (all via the default exchange, routing key == queue name — the default
exchange is itself a direct exchange, so no custom exchange is needed):

  <queue>        durable main queue (``index`` / ``label``)
  <queue>.retry  durable; a failed message is republished here with a per-message
                 TTL (exponential backoff) and dead-letters BACK to <queue> when
                 it expires (x-dead-letter-routing-key=<queue>)
  <queue>.dlq    durable terminal dead-letter queue; messages that exhausted
                 their retries land here for inspection / manual requeue (#29)

``aio_pika`` is imported lazily inside the functions that actually connect, so the
test suite can import this module and monkeypatch :func:`publish_task` /
unit-test :func:`process_delivery` without a live broker or the dependency
installed.
"""
from __future__ import annotations

import inspect
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

log = logging.getLogger("deedlit.ingest.broker")

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------
AMQP_URL = os.getenv("AMQP_URL", "amqp://deedlit:deedlit@localhost:5672/")

# Per-stage task queues (ADR 0002), also the routing keys. The ingest DAG, driven
# by choreography with the catalog as the fan-in rendezvous:
#
#   ingest ─┬─> embed.dense  ─┐
#           ├─> embed.sparse ─┴─> index.search   (fan-in: needs both vectors)
#           ├─> index.graph
#           └─> label ─┬─> embed.sparse           (description/tags changed it)
#                      └─> index.graph            (tags changed)
#
# Each queue is drained by whichever worker replica names it in QUEUES, so the
# GPU-bound embed.dense pool scales independently of the cheap I/O stages.
INGEST_QUEUE = "ingest"
EMBED_DENSE_QUEUE = "embed.dense"
EMBED_SPARSE_QUEUE = "embed.sparse"
INDEX_SEARCH_QUEUE = "index.search"
INDEX_GRAPH_QUEUE = "index.graph"
LABEL_QUEUE = "label"

# Legacy monolithic index queue (ADR 0001). Kept DECLARED through the 0002
# migration so any in-flight `index` messages still drain; the per-stage queues
# above replace it. Drop from TASK_QUEUES once nothing publishes `index`.
INDEX_QUEUE = "index"

TASK_QUEUES = (
    INGEST_QUEUE,
    EMBED_DENSE_QUEUE,
    EMBED_SPARSE_QUEUE,
    INDEX_SEARCH_QUEUE,
    INDEX_GRAPH_QUEUE,
    LABEL_QUEUE,
    INDEX_QUEUE,
)

# Retry/backoff. A message is retried up to MAX_RETRIES times (counting from the
# first failure) before it is dead-lettered. Backoff is exponential, capped.
MAX_RETRIES = int(os.getenv("TASK_MAX_RETRIES", "5"))
BACKOFF_BASE_MS = int(os.getenv("TASK_BACKOFF_BASE_MS", "2000"))
BACKOFF_CAP_MS = int(os.getenv("TASK_BACKOFF_CAP_MS", "60000"))

# How many unacked messages a single FAST-queue consumer holds at once — the
# parallelism knob for the cheap stages (ingest/embed/index). High by default so
# a worker keeps many in-flight; the work is I/O-bound (awaits vision/catalog) so
# the deliveries overlap. Raise it (or add worker replicas) to go faster.
PREFETCH = int(os.getenv("TASK_PREFETCH", "16"))

# The LLM (label) queue is a SINGLE, SERIAL consumer: prefetch 1 + an exclusive
# consumer (see exclusive_for), so the llama-server only ever sees one request at
# a time no matter how many workers start. Not tunable — it's a correctness
# constraint of the single-threaded model server.
LABEL_PREFETCH = 1


def prefetch_for(queue: str) -> int:
    """Per-queue unacked window: 1 for the serial LLM queue, PREFETCH otherwise."""
    return LABEL_PREFETCH if queue == LABEL_QUEUE else PREFETCH


def exclusive_for(queue: str) -> bool:
    """The LLM queue is an EXCLUSIVE consumer — the broker rejects a second one,
    guaranteeing a single consumer process for the serial llama-server."""
    return queue == LABEL_QUEUE

# Header carrying the (1-based) failed-attempt count across retry hops.
ATTEMPT_HEADER = "x-attempt"
ERROR_HEADER = "x-error"

# A task handler maps a decoded payload dict to None (sync) or an awaitable.
Handler = Callable[[dict[str, Any]], "Awaitable[None] | None"]


def retry_queue(queue: str) -> str:
    return f"{queue}.retry"


def dlq_queue(queue: str) -> str:
    return f"{queue}.dlq"


def backoff_ms(attempt: int) -> int:
    """Exponential backoff for the ``attempt``-th failure (1-based), capped.

    attempt 1 -> base, 2 -> base*2, 3 -> base*4, ... clamped to the cap.
    """
    if attempt < 1:
        attempt = 1
    delay = BACKOFF_BASE_MS * (2 ** (attempt - 1))
    return min(delay, BACKOFF_CAP_MS)


def next_action(attempts: int, max_retries: int = MAX_RETRIES) -> str:
    """Decide what to do after a handler failure: ``retry`` or ``dlq``.

    ``attempts`` is the number of failures SO FAR (including the one just seen).
    """
    return "retry" if attempts < max_retries else "dlq"


# ---------------------------------------------------------------------------
# Connection / channel (lazily created, cached in the running process)
# ---------------------------------------------------------------------------
_connection: Any = None
_channel: Any = None


async def get_connection() -> Any:
    """Return a cached robust connection, opening it on first use.

    ``aio_pika.connect_robust`` self-heals a dropped connection. Shared by the
    publish channel and the per-queue consume channels (run_worker).
    """
    global _connection
    if _connection is not None and not _connection.is_closed:
        return _connection
    import aio_pika  # lazy: only needed when we actually talk to the broker

    _connection = await aio_pika.connect_robust(AMQP_URL)
    return _connection


async def get_channel() -> Any:
    """Return a cached robust PUBLISH channel, declaring topology on first use.

    Declares the full topology (every task queue + its retry/dlq) so a publisher
    or consumer can start in any order. Consumers use their own per-queue channels
    (run_worker) so each can carry its own QoS.
    """
    global _channel
    if _channel is not None and not _channel.is_closed:
        return _channel
    conn = await get_connection()
    _channel = await conn.channel()
    await _channel.set_qos(prefetch_count=PREFETCH)
    await declare_topology(_channel, TASK_QUEUES)
    return _channel


async def declare_topology(channel: Any, queues: "tuple[str, ...] | list[str]") -> None:
    """Declare the main/retry/dlq queues for each task queue (idempotent)."""
    for q in queues:
        await channel.declare_queue(dlq_queue(q), durable=True)
        # Retry queue: messages dead-letter BACK to the main queue once their
        # per-message TTL expires (set at publish time as `expiration`).
        await channel.declare_queue(
            retry_queue(q),
            durable=True,
            arguments={
                "x-dead-letter-exchange": "",
                "x-dead-letter-routing-key": q,
            },
        )
        await channel.declare_queue(q, durable=True)


async def close() -> None:
    """Close the cached connection (used on worker shutdown / test cleanup)."""
    global _connection, _channel
    if _connection is not None and not _connection.is_closed:
        await _connection.close()
    _connection = None
    _channel = None


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------
async def publish_task(
    queue: str,
    payload: dict[str, Any],
    *,
    headers: dict[str, Any] | None = None,
    expiration_ms: int | None = None,
) -> None:
    """Publish ``payload`` (JSON) to ``queue`` via the default exchange.

    Persistent delivery so a broker restart doesn't lose queued work. This is the
    seam monkeypatched in tests so the fast path can be exercised offline.
    """
    import aio_pika

    channel = await get_channel()
    message = aio_pika.Message(
        body=json.dumps(payload).encode("utf-8"),
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        content_type="application/json",
        headers=headers or {},
        expiration=(expiration_ms / 1000.0) if expiration_ms is not None else None,
    )
    await channel.default_exchange.publish(message, routing_key=queue)


async def _publish_sha_task(queue: str, sha256: str, *, parent_op_id: str | None = None) -> None:
    """Publish a per-image stage task keyed by ``sha256`` (the common DAG shape).

    Every per-stage queue except ``ingest`` operates on an already-cataloged
    image, so they share one payload shape: ``{sha256, type, parent_op_id}``. The
    thin wrappers below name the queue so callers (and tests) read clearly.
    """
    await publish_task(queue, {"sha256": sha256, "type": queue, "parent_op_id": parent_op_id})


async def publish_ingest_task(
    path: str,
    *,
    source_folder_id: str | None = None,
    parent_op_id: str | None = None,
) -> None:
    """Enqueue an ``ingest`` task: run the fast path for one source file (ADR 0002).

    Unlike the other stages this is keyed by the on-disk ``path`` (the sha256 is
    not known until the worker hashes the bytes), so it carries its own payload
    shape. ``source_folder_id`` rides along so the worker can attribute the scan.
    """
    await publish_task(
        INGEST_QUEUE,
        {
            "path": path,
            "type": INGEST_QUEUE,
            "source_folder_id": source_folder_id,
            "parent_op_id": parent_op_id,
        },
    )


async def publish_embed_dense_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue an ``embed.dense`` task: GPU dense-embed sha256, persist to catalog."""
    await _publish_sha_task(EMBED_DENSE_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_embed_sparse_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue an ``embed.sparse`` task: sparse-embed sha256's text, persist it."""
    await _publish_sha_task(EMBED_SPARSE_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_index_search_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue an ``index.search`` task: fan-in dense+sparse -> upsert search point."""
    await _publish_sha_task(INDEX_SEARCH_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_index_graph_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue an ``index.graph`` task: upsert sha256's graph edges from catalog."""
    await _publish_sha_task(INDEX_GRAPH_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_index_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue a legacy ``index`` task (ADR 0001). Retained for in-flight messages
    during the 0002 migration; new code publishes the per-stage tasks above."""
    await _publish_sha_task(INDEX_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_label_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue a ``label`` task: describe sha256, patch catalog, re-index (#26)."""
    await _publish_sha_task(LABEL_QUEUE, sha256, parent_op_id=parent_op_id)


async def publish_post_ingest(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Publish the four downstream stages after a fast-path ingest (ADR 0002).

    embed.dense + embed.sparse (both fan into index.search) + index.graph + label.
    Errors PROPAGATE (unlike the producer's best-effort fan-out) so the caller —
    the ``ingest`` queue handler — fails and the broker retries the whole ingest
    task, which re-runs the idempotent fast path and re-publishes these. The four
    are independent, so they are published CONCURRENTLY (gather propagates the
    first failure).
    """
    import asyncio

    await asyncio.gather(
        publish_embed_dense_task(sha256, parent_op_id=parent_op_id),
        publish_embed_sparse_task(sha256, parent_op_id=parent_op_id),
        publish_index_graph_task(sha256, parent_op_id=parent_op_id),
        publish_label_task(sha256, parent_op_id=parent_op_id),
    )


# ---------------------------------------------------------------------------
# Consume — the testable core of one delivery
# ---------------------------------------------------------------------------
async def _maybe_await(value: Any) -> None:
    if inspect.isawaitable(value):
        await value


async def process_delivery(
    queue: str,
    body: bytes,
    headers: dict[str, Any] | None,
    handler: Handler,
    *,
    publish: Callable[..., Awaitable[None]],
    max_retries: int = MAX_RETRIES,
    on_event: Callable[..., Any] | None = None,
) -> str:
    """Run ``handler`` for one delivery and decide retry/dlq on failure.

    Returns one of ``"ok"`` / ``"retry"`` / ``"dlq"``. On failure the message is
    republished (via the injected ``publish`` callback) either to ``<queue>.retry``
    with an exponential-backoff TTL, or to ``<queue>.dlq`` once retries are
    exhausted. The original delivery is always acked by the caller afterwards —
    redelivery happens through the retry/dlq republish, not through nack/requeue,
    so a poison message can never hot-loop.

    ``on_event(status, attempts, error)`` (optional, sync or async) is the ledger
    hook (#27): ``running`` at start, then ``done`` / ``failed`` (will retry) /
    ``dlq`` (exhausted). Best-effort by contract — the caller's hook must swallow
    its own errors. Pure w.r.t. the broker (``publish``/``on_event`` injected), so
    tests drive it with fakes — no live RabbitMQ needed.
    """
    payload = json.loads(body) if isinstance(body, (bytes, bytearray)) else dict(body)
    prior = int((headers or {}).get(ATTEMPT_HEADER, 0))
    if on_event is not None:
        await _maybe_await(on_event("running", prior, None))
    try:
        result = handler(payload)
        if inspect.isawaitable(result):
            await result
        if on_event is not None:
            await _maybe_await(on_event("done", prior, None))
        return "ok"
    except Exception as exc:  # handler failed — route to retry or dlq
        attempts = prior + 1
        new_headers = {ATTEMPT_HEADER: attempts, ERROR_HEADER: str(exc)[:500]}
        action = next_action(attempts, max_retries)
        if action == "retry":
            log.warning(
                "task %s failed (attempt %d/%d), retrying in %d ms: %s",
                queue, attempts, max_retries, backoff_ms(attempts), exc,
            )
            await publish(
                retry_queue(queue), payload,
                headers=new_headers, expiration_ms=backoff_ms(attempts),
            )
        else:
            log.error(
                "task %s failed (attempt %d/%d) -> DLQ: %s",
                queue, attempts, max_retries, exc,
            )
            await publish(dlq_queue(queue), payload, headers=new_headers)
        if on_event is not None:
            ledger_status = "failed" if action == "retry" else "dlq"
            await _maybe_await(on_event(ledger_status, attempts, str(exc)[:500]))
        return action


# ---------------------------------------------------------------------------
# Worker loop (live)
# ---------------------------------------------------------------------------
async def run_worker(
    queues: "list[str] | tuple[str, ...]",
    handlers: dict[str, Handler],
    on_event_factory: "Callable[[str, dict[str, Any]], Callable[..., Any]] | None" = None,
) -> None:
    """Consume ``queues`` forever, dispatching each delivery to its handler.

    Each replica drains only the queues named in ``queues`` (the ``QUEUES`` env),
    so label workers can scale independently of index workers. Manual ack: the
    delivery is acked after :func:`process_delivery` settles it (ok/retry/dlq).

    Each queue gets its OWN channel so it can carry its own QoS (:func:`prefetch_for`)
    — the fast queues run with a high prefetch for maximum overlap, while the LLM
    ``label`` queue runs prefetch 1 + an EXCLUSIVE consumer (:func:`exclusive_for`)
    so the broker guarantees a single, serial consumer.

    ``on_event_factory(queue, payload)`` (optional) returns the per-message ledger
    hook passed to :func:`process_delivery` (#27).
    """
    await get_channel()  # ensure the connection + topology exist (publish channel)
    connection = await get_connection()
    consumed: list[Any] = []
    for q in queues:
        ch = await connection.channel()
        await ch.set_qos(prefetch_count=prefetch_for(q))
        queue = await ch.get_queue(q)
        handler = handlers[q]

        async def _on_message(message: Any, _q: str = q, _h: Handler = handler) -> None:
            async with message.process(requeue=False, ignore_processed=True):
                on_event = None
                if on_event_factory is not None:
                    try:
                        preview = json.loads(message.body)
                    except Exception:
                        preview = {}
                    on_event = on_event_factory(_q, preview)
                await process_delivery(
                    _q, message.body, dict(message.headers or {}), _h,
                    publish=publish_task, on_event=on_event,
                )

        tag = await queue.consume(_on_message, exclusive=exclusive_for(q))
        consumed.append((queue, tag))
        log.info(
            "consuming queue %s (prefetch=%d exclusive=%s)",
            q, prefetch_for(q), exclusive_for(q),
        )

    # Block forever; the robust connection keeps the consumers alive.
    import asyncio

    await asyncio.Future()
