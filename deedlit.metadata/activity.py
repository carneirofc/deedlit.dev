"""In-process activity tracker for the live "who's doing what" dashboard.

Each FastAPI service self-reports a tiny snapshot of what it is doing RIGHT NOW
so the UI's system-activity board can show, per service: how many requests are
in flight, recent throughput, and the most recent operation. The gateway
(deedlit.api) aggregates every service's ``GET /activity`` into one payload the
comfyhelper status board renders alongside health.

This is deliberately lightweight and IN-PROCESS (counters reset on restart):
durable metrics belong in the trace/metrics pipeline (Tempo/Grafana). There is
no shared source package across services by design, so this self-contained
module is copied into each service dir, mirroring the per-service
``_HealthAccessFilter`` pattern.

Wiring (one line in each app.py, after ``app = FastAPI(...)``)::

    from activity import install_activity
    install_activity(app)

which registers an HTTP middleware that counts every request (except the
``/health`` and ``/activity`` probes themselves) and the ``GET /activity`` route.
"""
from __future__ import annotations

import time
from collections import deque

# Trailing window over which throughput is measured. With a 60s window the
# completion count IS the per-minute rate.
WINDOW_SECONDS = 60.0

# Probe endpoints excluded from the counters so tight health/activity polling
# (the board polls /activity every ~2s) doesn't drown out real work.
_IGNORED_PATHS = frozenset({"/health", "/activity"})


class ActivityTracker:
    """Process-local gauges: in-flight count, trailing throughput, last op.

    All mutation happens from the ASGI event loop (the HTTP middleware), so no
    locking is needed — increments/decrements and the snapshot read never run
    concurrently across threads.
    """

    def __init__(self, window_seconds: float = WINDOW_SECONDS) -> None:
        self._window = window_seconds
        self._inflight = 0
        self._completions: deque[float] = deque()
        self._last_op: str | None = None

    def begin(self, op: str) -> None:
        self._inflight += 1
        self._last_op = op

    def end(self) -> None:
        self._inflight = max(0, self._inflight - 1)
        now = time.monotonic()
        self._completions.append(now)
        self._trim(now)

    def _trim(self, now: float) -> None:
        cutoff = now - self._window
        while self._completions and self._completions[0] < cutoff:
            self._completions.popleft()

    def snapshot(self) -> dict:
        now = time.monotonic()
        self._trim(now)
        recent = len(self._completions)
        return {
            "inflight": self._inflight,
            "per_min": round(recent * 60.0 / self._window, 1),
            "busy": self._inflight > 0,
            "last_op": self._last_op,
        }


# Module-level singleton: one tracker per service process.
tracker = ActivityTracker()


def install_activity(app, register_route: bool = True) -> ActivityTracker:
    """Register the activity middleware (+ ``GET /activity``) on ``app``.

    Returns the tracker so tests/callers can introspect it. Pass
    ``register_route=False`` to install only the counting middleware — the
    gateway does this because it serves an *aggregated* ``/activity`` (every
    service's snapshot) and must not have this per-service route shadow it.
    """

    @app.middleware("http")
    async def _activity_middleware(request, call_next):
        if request.url.path in _IGNORED_PATHS:
            return await call_next(request)
        tracker.begin(f"{request.method} {request.url.path}")
        try:
            return await call_next(request)
        finally:
            tracker.end()

    if register_route:

        @app.get("/activity", tags=["observability"])
        async def activity() -> dict:
            return tracker.snapshot()

    return tracker
