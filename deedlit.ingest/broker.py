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

# Task queue names (also the routing keys). These are the per-image task types.
INDEX_QUEUE = "index"
LABEL_QUEUE = "label"
TASK_QUEUES = (INDEX_QUEUE, LABEL_QUEUE)

# Retry/backoff. A message is retried up to MAX_RETRIES times (counting from the
# first failure) before it is dead-lettered. Backoff is exponential, capped.
MAX_RETRIES = int(os.getenv("TASK_MAX_RETRIES", "5"))
BACKOFF_BASE_MS = int(os.getenv("TASK_BACKOFF_BASE_MS", "2000"))
BACKOFF_CAP_MS = int(os.getenv("TASK_BACKOFF_CAP_MS", "60000"))

# How many unacked messages a single consumer holds at once. Kept modest so a
# slow handler (GPU/LLM) doesn't hoard the queue across replicas.
PREFETCH = int(os.getenv("TASK_PREFETCH", "4"))

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


async def get_channel() -> Any:
    """Return a cached robust channel, connecting + declaring topology on first use.

    Uses ``aio_pika.connect_robust`` so a dropped connection self-heals. Declares
    the full topology (both task queues + their retry/dlq) so a publisher or
    consumer can start in any order.
    """
    global _connection, _channel
    if _channel is not None and not _channel.is_closed:
        return _channel
    import aio_pika  # lazy: only needed when we actually talk to the broker

    _connection = await aio_pika.connect_robust(AMQP_URL)
    _channel = await _connection.channel()
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


async def publish_index_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue an ``index`` task: (re)build the search+graph projection for sha256."""
    await publish_task(
        INDEX_QUEUE, {"sha256": sha256, "type": INDEX_QUEUE, "parent_op_id": parent_op_id}
    )


async def publish_label_task(sha256: str, *, parent_op_id: str | None = None) -> None:
    """Enqueue a ``label`` task: describe sha256, patch catalog, re-index (#26)."""
    await publish_task(
        LABEL_QUEUE, {"sha256": sha256, "type": LABEL_QUEUE, "parent_op_id": parent_op_id}
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

    ``on_event_factory(queue, payload)`` (optional) returns the per-message ledger
    hook passed to :func:`process_delivery` (#27).
    """
    channel = await get_channel()
    consumed: list[Any] = []
    for q in queues:
        queue = await channel.get_queue(q)
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

        tag = await queue.consume(_on_message)
        consumed.append((queue, tag))
        log.info("consuming queue %s", q)

    # Block forever; the robust connection keeps the consumers alive.
    import asyncio

    await asyncio.Future()
