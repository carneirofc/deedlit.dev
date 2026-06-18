"""deedlit.api — BFF gateway (no database).

The single base URL the UI talks to. The gateway owns no data; it aggregates
and proxies over HTTP to the four owning services (catalog / search / graph /
ingest). See contracts/api.openapi.yaml.

Endpoints:
  GET  /health           -> HealthDashboard (probes every downstream in parallel)
  GET  /detail/{sha256}  -> Detail{image,similar,neighbors} (parallel fan-out,
                            degrades gracefully on a single downstream failure)
  POST /search           -> encode text via vision, then query deedlit.search
  GET  /stats            -> aggregated library stats (from catalog)
  POST /jobs             -> dispatch an ingest/maintenance job (proxy to ingest)
  GET  /jobs             -> list jobs (proxy to ingest) for the dashboard
  GET  /fs/browse        -> directory listing for the admin folder picker (proxy
                            to ingest, which owns the host filesystem)
  /notes, /collections   -> thin proxies to catalog (notes editor + collections)
  POST /mcp              -> MCP JSON-RPC 2.0 surface (see mcp.py)

The downstream HTTP boundary lives in clients.py (monkeypatched in tests); the
MCP tool surface lives in mcp.py.
"""
from __future__ import annotations

if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import asyncio
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

import clients
import mcp
from activity import install_activity
from activity import tracker as gateway_tracker
from clients import DownstreamError


# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact.
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            path = str(args[2])
            return "/health" not in path and "/activity" not in path
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.api", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Middleware only: the gateway serves an AGGREGATED /activity (every service's
# snapshot) defined below, so the per-service route must not shadow it.
install_activity(app, register_route=False)


# ---------------------------------------------------------------------------
# GET /health — per-service health dashboard (parallel probe)
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, Any]:
    async def probe(name: str, base: str) -> dict[str, Any]:
        try:
            body = await clients.request(name, "GET", base, "/health")
        except DownstreamError:
            return {"name": name, "status": "down"}
        detail = body if isinstance(body, dict) else None
        raw = (detail or {}).get("status", "ok")
        result: dict[str, Any] = {"name": name, "status": "ok" if raw == "ok" else "degraded"}
        # Forward the downstream's own readiness flags (db_ready, blob_ready,
        # neo4j_ready, collection_ready, vision_ready, …) so the status
        # dashboard can show each service's dependencies, not just a roll-up.
        if detail:
            extra = {k: v for k, v in detail.items() if k != "status"}
            if extra:
                result["detail"] = extra
        return result

    services = await asyncio.gather(
        *(probe(name, base) for name, base in clients.HEALTH_SERVICES.items())
    )
    overall = "ok" if all(s["status"] == "ok" for s in services) else "degraded"
    return {"status": overall, "services": list(services)}


# ---------------------------------------------------------------------------
# GET /activity — live per-service work snapshot (parallel probe)
#
# Aggregates every service's lightweight GET /activity (in-flight count, recent
# throughput, current op) into one payload the comfyhelper system-activity board
# renders alongside /health. Mirrors the /health fan-out: probes run in parallel
# and a downstream miss degrades to an idle row (busy=false, reachable=false) so
# the board still shows the service rather than dropping it.
# ---------------------------------------------------------------------------
def _idle_activity(name: str, *, reachable: bool) -> dict[str, Any]:
    return {
        "name": name,
        "inflight": 0,
        "per_min": 0.0,
        "busy": False,
        "last_op": None,
        "reachable": reachable,
    }


@app.get("/activity")
async def activity() -> dict[str, Any]:
    async def probe(name: str, base: str) -> dict[str, Any]:
        try:
            body = await clients.request(name, "GET", base, "/activity")
        except DownstreamError:
            return _idle_activity(name, reachable=False)
        b = body if isinstance(body, dict) else {}
        return {
            "name": name,
            "inflight": int(b.get("inflight", 0) or 0),
            "per_min": float(b.get("per_min", 0) or 0),
            "busy": bool(b.get("busy", False)),
            "last_op": b.get("last_op"),
            "reachable": True,
        }

    downstream = await asyncio.gather(
        *(probe(name, base) for name, base in clients.HEALTH_SERVICES.items())
    )
    # The gateway answered, so include its own live work first (mirrors how the
    # comfyhelper health route prepends the gateway component).
    gateway = {"name": "gateway", **gateway_tracker.snapshot(), "reachable": True}
    return {"services": [gateway, *downstream]}


# ---------------------------------------------------------------------------
# GET /detail/{sha256} — parallel fan-out, graceful degradation
# ---------------------------------------------------------------------------
@app.get("/detail/{sha256}")
async def detail(sha256: str) -> dict[str, Any]:
    """Aggregate the detail page from catalog + search + graph IN PARALLEL.

    catalog (the image record) is REQUIRED — a 404 there is a 404 here. The
    derived projections (similar from search, neighbors from graph) are
    best-effort: if one downstream fails we degrade to an empty list and still
    return everything that succeeded. The parallel fan-out lives in
    ``clients.image_detail`` so the MCP ``get_image_detail`` tool reuses it.
    """
    try:
        return await clients.image_detail(sha256)
    except DownstreamError as exc:
        if exc.status == 404:
            raise HTTPException(status_code=404, detail="image not found") from exc
        raise HTTPException(status_code=502, detail=f"catalog unavailable: {exc.detail}") from exc
    except Exception as exc:  # non-DownstreamError catalog failure
        raise HTTPException(status_code=502, detail="catalog error") from exc


# ---------------------------------------------------------------------------
# DELETE /images/{sha256} — un-index an image across the stores
# ---------------------------------------------------------------------------
@app.delete("/images/{sha256}")
async def delete_image(sha256: str) -> dict[str, Any]:
    """Delete an image's INDEXATION (catalog record + search vector + graph
    node), NOT the original file on disk.

    Catalog is the source of truth and goes FIRST: a 404 there means the image
    is not in the library (404 here); any other catalog failure aborts with 502
    BEFORE the projections are touched, so a failed truth-delete can't strand
    half-removed state. With the catalog row gone, the derived projections
    (search point, graph node) are cleaned best-effort IN PARALLEL — a transient
    search/graph failure leaves an orphan a reconcile/rebuild can prune and is
    reported in the body rather than failing the whole delete. The fan-out lives
    in ``clients.unindex_image`` so the MCP ``delete_image`` tool reuses it.
    """
    try:
        return await clients.unindex_image(sha256)
    except DownstreamError as exc:
        if exc.status == 404:
            raise HTTPException(status_code=404, detail="image not found") from exc
        raise HTTPException(
            status_code=502, detail=f"catalog unavailable: {exc.detail}"
        ) from exc


class BatchDeleteRequest(BaseModel):
    """POST /images/batch-delete body — the sha256s to bulk un-index (capped)."""

    sha256s: list[str] = Field(min_length=1, max_length=1000)


@app.post("/images/batch-delete")
async def batch_delete_images(req: BatchDeleteRequest) -> dict[str, Any]:
    """Bulk un-index MANY images across the stores in ONE call per store.

    The batch counterpart to DELETE /images/{sha256}: catalog (truth) batch-delete
    FIRST, then the search + graph projections are cleaned for exactly the records
    that existed (best-effort, in parallel) — a single round-trip per store instead
    of per image. Returns the ``deleted`` + ``missing`` sha256s and per-projection
    outcome. A catalog failure aborts with 502 before any projection is touched."""
    try:
        return await clients.unindex_images(req.sha256s)
    except DownstreamError as exc:
        raise HTTPException(
            status_code=502, detail=f"catalog unavailable: {exc.detail}"
        ) from exc


# ---------------------------------------------------------------------------
# POST /search — proxy to deedlit.search
# ---------------------------------------------------------------------------
class SearchRequest(BaseModel):
    query: str
    limit: int = 24
    filter: dict[str, Any] | None = None


@app.post("/search")
async def search(req: SearchRequest) -> Any:
    # search is a pure vector store; encode the text via vision first (an empty
    # query yields an empty result rather than a vectorless query that 422s).
    try:
        return await clients.search_by_text(req.query, req.limit, req.filter)
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"search unavailable: {exc.detail}")


# ---------------------------------------------------------------------------
# GET /stats — aggregated library stats (degrades to zeros)
# ---------------------------------------------------------------------------
@app.get("/stats")
async def stats() -> dict[str, Any]:
    """Aggregated library counts, sourced from catalog ``GET /stats`` (the owner
    of images/tags/notes/collections).

    Returns the catalog summary verbatim (image/tag/collection/note/folder
    counts, favorites, labeled vs unlabeled, content-safety breakdown). When
    catalog is unreachable, degrades to a stable zero-filled shape rather than
    erroring so the dashboard/report tools stay renderable.
    """
    base: dict[str, Any] = {
        "images": 0, "tags": 0, "collections": 0, "notes": 0,
        "folders": 0, "favorites": 0, "labeled": 0, "unlabeled": 0,
        "safety": {"sfw": 0, "nsfw": 0, "explicit": 0, "unclassified": 0},
    }
    try:
        res = await clients.catalog("GET", "/stats")
    except DownstreamError:
        return base
    if isinstance(res, dict):
        base.update(res)
    return base


@app.get("/reports/folders")
async def reports_folders() -> Any:
    """Per-folder coverage report (catalog proxy): path + label + image/labeled/
    unlabeled counts for each source folder. Degrades to [] when catalog down."""
    try:
        res = await clients.catalog("GET", "/reports/folders")
    except DownstreamError:
        return []
    return res if isinstance(res, list) else []


# ---------------------------------------------------------------------------
# /jobs — dispatch (POST) + list (GET), proxied to ingest
# ---------------------------------------------------------------------------
@app.post("/jobs", status_code=202)
async def dispatch_job(payload: dict[str, Any]) -> JSONResponse:
    """Dispatch an ingest/maintenance job to deedlit.ingest.

    A payload carrying ``folderPath`` is an ingest run (-> /ingest); anything
    else is a maintenance job (-> /jobs).
    """
    path = "/ingest" if "folderPath" in payload else "/jobs"
    try:
        res = await clients.ingest("POST", path, json=payload)
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"ingest unavailable: {exc.detail}")
    return JSONResponse(status_code=202, content=res)


@app.get("/jobs")
async def list_jobs() -> Any:
    try:
        res = await clients.ingest("GET", "/jobs")
    except DownstreamError:
        return []
    return res if isinstance(res, list) else []


@app.get("/ingest/config")
async def get_ingest_config() -> Any:
    """Live ingest producer config (folder-scan parallelism), proxied to ingest.

    Backs the settings panel's "Ingest & indexing" section. Degrades to an empty
    object when ingest is down so the panel stays renderable."""
    try:
        return await clients.ingest("GET", "/config")
    except DownstreamError:
        return {}


@app.put("/ingest/config")
async def put_ingest_config(payload: dict[str, Any]) -> Any:
    """Update the live ingest producer config (settings panel → ingest)."""
    try:
        return await clients.ingest("PUT", "/config", json=payload)
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"ingest unavailable: {exc.detail}")


@app.get("/fs/browse")
async def fs_browse(path: str | None = None) -> Any:
    """List a directory on the ingest host for the admin folder picker.

    Proxies to deedlit.ingest, which owns the host filesystem. A downstream 400
    (missing/denied/not-a-dir) is user-correctable, so it passes through as a
    400 the picker shows inline; any other failure surfaces as a 502.
    """
    params = {"path": path} if path is not None else None
    try:
        return await clients.ingest("GET", "/fs/browse", params=params)
    except DownstreamError as exc:
        if exc.status == 400:
            raise HTTPException(status_code=400, detail=exc.detail) from exc
        raise HTTPException(
            status_code=502, detail=f"ingest unavailable: {exc.detail}"
        ) from exc


# ---------------------------------------------------------------------------
# Notes + collections — thin proxies to catalog (the owner of both)
#
# The gateway holds no data: each route forwards method+path+body to catalog
# and returns its JSON unchanged. A catalog 404 surfaces as a gateway 404; any
# other downstream failure (5xx / unreachable) surfaces as a 502 so the UI can
# tell "not found" from "backend down".
# ---------------------------------------------------------------------------
async def _proxy_catalog(method: str, path: str, json_body: Any | None = None) -> Any:
    try:
        return await clients.catalog(method, path, json=json_body)
    except DownstreamError as exc:
        if exc.status == 404:
            raise HTTPException(status_code=404, detail=exc.detail) from exc
        raise HTTPException(status_code=502, detail=f"catalog unavailable: {exc.detail}") from exc


# --- notes -----------------------------------------------------------------
@app.post("/notes")
async def create_note(payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("POST", "/notes", payload)


@app.get("/notes/by-image/{sha256}")
async def notes_by_image(sha256: str) -> Any:
    return await _proxy_catalog("GET", f"/notes/by-image/{sha256}")


@app.get("/notes/{note_id}")
async def read_note(note_id: str) -> Any:
    return await _proxy_catalog("GET", f"/notes/{note_id}")


@app.put("/notes/{note_id}")
async def update_note(note_id: str, payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("PUT", f"/notes/{note_id}", payload)


@app.get("/notes/{note_id}/export")
async def export_note(note_id: str) -> Any:
    return await _proxy_catalog("GET", f"/notes/{note_id}/export")


# --- collections -----------------------------------------------------------
@app.post("/collections")
async def create_collection(payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("POST", "/collections", payload)


@app.get("/collections")
async def list_collections() -> Any:
    return await _proxy_catalog("GET", "/collections")


@app.get("/collections/by-image/{sha256}")
async def collections_by_image(sha256: str) -> Any:
    return await _proxy_catalog("GET", f"/collections/by-image/{sha256}")


@app.get("/collections/{collection_id}")
async def read_collection(collection_id: str) -> Any:
    return await _proxy_catalog("GET", f"/collections/{collection_id}")


@app.put("/collections/{collection_id}")
async def rename_collection(collection_id: str, payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("PUT", f"/collections/{collection_id}", payload)


@app.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str) -> Any:
    return await _proxy_catalog("DELETE", f"/collections/{collection_id}")


@app.put("/collections/{collection_id}/images")
async def set_collection_images(collection_id: str, payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("PUT", f"/collections/{collection_id}/images", payload)


# ---------------------------------------------------------------------------
# Source folders — the configured-ingest-folder registry.
#
# The registry is catalog-owned (the only DB service), so list/create/patch/
# delete are thin catalog proxies. "Scan now" is the one composite route: it
# resolves the folder's path from catalog, then dispatches an ingest job — the
# UI never has to know the path, only the folder id.
# ---------------------------------------------------------------------------
@app.post("/folders")
async def create_folder(payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("POST", "/folders", payload)


@app.get("/folders")
async def list_folders() -> Any:
    return await _proxy_catalog("GET", "/folders")


@app.get("/folders/{folder_id}")
async def read_folder(folder_id: str) -> Any:
    return await _proxy_catalog("GET", f"/folders/{folder_id}")


@app.patch("/folders/{folder_id}")
async def patch_folder(folder_id: str, payload: dict[str, Any]) -> Any:
    return await _proxy_catalog("PATCH", f"/folders/{folder_id}", payload)


@app.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str) -> Any:
    return await _proxy_catalog("DELETE", f"/folders/{folder_id}")


@app.post("/folders/{folder_id}/scan", status_code=202)
async def scan_folder(folder_id: str) -> JSONResponse:
    """Dispatch an immediate ingest scan of a configured folder ("Scan now").

    Resolves the folder's path from catalog (404 if unknown), then enqueues an
    ingest job for that path. The background scheduler in ingest does this on
    each folder's interval; this is the on-demand button.
    """
    folder = await _proxy_catalog("GET", f"/folders/{folder_id}")
    path = (folder or {}).get("path") if isinstance(folder, dict) else None
    if not path:
        raise HTTPException(status_code=404, detail="folder not found")
    try:
        res = await clients.ingest("POST", "/ingest", json={"folderPath": path})
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"ingest unavailable: {exc.detail}")
    return JSONResponse(status_code=202, content=res)


@app.get("/images/unlabeled")
async def list_unlabeled(limit: int = 500, offset: int = 0) -> Any:
    """sha256 of images missing a labelagent description (catalog proxy).

    Backs the UI's library-wide labeling-coverage readout; ingest's backfill
    sweep reads the same catalog endpoint directly.
    """
    return await _proxy_catalog(
        "GET", f"/images/unlabeled?limit={int(limit)}&offset={int(offset)}"
    )


# ---------------------------------------------------------------------------
# /tasks — async queue ledger (catalog proxy), for the queue visualization page
#
# The catalog `tasks` table is the queryable history of the async index/label
# tasks (ADR 0001). The list degrades to [] when catalog is down (the dashboard
# stays usable); a single-task lookup passes a 404 through and 502s when down.
# ---------------------------------------------------------------------------
@app.get("/tasks")
async def list_tasks(
    sha256: str | None = None,
    type: str | None = None,
    status: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> Any:
    params = {
        "limit": str(int(limit)),
        "offset": str(int(offset)),
    }
    if sha256:
        params["sha256"] = sha256
    if type:
        params["type"] = type
    if status:
        params["status"] = status
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    try:
        res = await clients.catalog("GET", f"/tasks?{qs}")
    except DownstreamError:
        return []
    return res if isinstance(res, list) else []


@app.get("/tasks/{task_id}")
async def read_task(task_id: str) -> Any:
    return await _proxy_catalog("GET", f"/tasks/{task_id}")


# ---------------------------------------------------------------------------
# /queues — RabbitMQ management proxy for the queue visualization page (#29)
#
# The gateway holds the management creds; the browser never sees them. Live
# depth/consumers/rates come from the management API; the per-image task HISTORY
# comes from the catalog tasks ledger (GET /tasks above). Destructive actions
# (purge, requeue) are confirmed in the UI and assume localhost binding.
# ---------------------------------------------------------------------------
# The per-stage DAG queues (ADR 0002) + the opt-in ingest queue + the legacy
# index queue, each with its retry/dlq companions (mirror deedlit.ingest broker).
TASK_QUEUE_BASES = [
    "ingest",
    "embed.dense",
    "embed.sparse",
    "index.search",
    "index.graph",
    "label",
    "index",
]
QUEUE_NAMES = [
    name for base in TASK_QUEUE_BASES for name in (base, f"{base}.retry", f"{base}.dlq")
]


def _vhost() -> str:
    from urllib.parse import quote

    return quote(clients.RABBITMQ_VHOST, safe="")


def _idle_queue(name: str) -> dict[str, Any]:
    return {
        "name": name, "reachable": False, "messages": 0, "messages_ready": 0,
        "messages_unacknowledged": 0, "consumers": 0, "publish_rate": 0.0, "deliver_rate": 0.0,
    }


@app.get("/queues")
async def list_queues() -> dict[str, Any]:
    """Live stats for the task queues (depth / ready / unacked / consumers /
    rates), probed in parallel. A queue the broker can't report degrades to an
    idle, unreachable row so the board still renders."""
    vhost = _vhost()

    async def one(name: str) -> dict[str, Any]:
        try:
            body = await clients.rabbitmq_mgmt("GET", f"/api/queues/{vhost}/{name}")
        except DownstreamError:
            return _idle_queue(name)
        b = body if isinstance(body, dict) else {}
        stats = b.get("message_stats") or {}
        return {
            "name": name,
            "reachable": True,
            "messages": int(b.get("messages", 0) or 0),
            "messages_ready": int(b.get("messages_ready", 0) or 0),
            "messages_unacknowledged": int(b.get("messages_unacknowledged", 0) or 0),
            "consumers": int(b.get("consumers", 0) or 0),
            "publish_rate": float((stats.get("publish_details") or {}).get("rate", 0.0) or 0.0),
            "deliver_rate": float((stats.get("deliver_get_details") or {}).get("rate", 0.0) or 0.0),
        }

    rows = await asyncio.gather(*(one(n) for n in QUEUE_NAMES))
    return {"queues": list(rows)}


@app.get("/queues/{name}/messages")
async def peek_queue(name: str, limit: int = 20) -> dict[str, Any]:
    """Non-destructively peek messages in a queue (ack_requeue_true).

    Works for ANY task queue — the live stages, their ``.retry``, and ``.dlq`` —
    so the UI can inspect what is actually queued, not just dead-letters. Each
    item carries the payload plus the AMQP routing/delivery detail and full
    properties (incl. headers) so the message can be shown in full: stage/type,
    sha256, op id, attempt count, redelivered flag, and size. ``remaining`` is the
    queue depth left after the peek (the messages are requeued, not consumed)."""
    if name not in QUEUE_NAMES:
        raise HTTPException(status_code=404, detail="unknown queue")
    body = {
        "count": int(limit), "ackmode": "ack_requeue_true",
        "encoding": "auto", "truncate": 50000,
    }
    try:
        msgs = await clients.rabbitmq_mgmt(
            "POST", f"/api/queues/{_vhost()}/{name}/get", json=body
        )
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"rabbitmq unavailable: {exc.detail}")
    out: list[dict[str, Any]] = []
    remaining = 0
    for m in (msgs or []):
        if not isinstance(m, dict):
            continue
        props = m.get("properties") or {}
        # message_count is the queue depth remaining AFTER this message was read;
        # the last (lowest) one is the true count left once the peek requeues all.
        remaining = int(m.get("message_count", remaining) or 0)
        out.append({
            "payload": m.get("payload"),
            "payload_bytes": m.get("payload_bytes"),
            "payload_encoding": m.get("payload_encoding"),
            "redelivered": bool(m.get("redelivered", False)),
            "routing_key": m.get("routing_key"),
            "exchange": m.get("exchange"),
            "properties": props,
            # Top-level headers kept for back-compat with existing DLQ rendering.
            "headers": props.get("headers", {}),
        })
    return {"queue": name, "messages": out, "remaining": remaining}


@app.post("/queues/{name}/purge")
async def purge_queue(name: str) -> dict[str, Any]:
    """Purge all messages from a queue (destructive — UI confirms)."""
    if name not in QUEUE_NAMES:
        raise HTTPException(status_code=404, detail="unknown queue")
    try:
        await clients.rabbitmq_mgmt("DELETE", f"/api/queues/{_vhost()}/{name}/contents")
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"rabbitmq unavailable: {exc.detail}")
    return {"status": "purged", "queue": name}


@app.post("/dlq/{base}/requeue")
async def requeue_dlq(base: str, limit: int = 100) -> dict[str, Any]:
    """Drain up to ``limit`` messages from ``<base>.dlq`` and republish them to
    the main ``<base>`` queue (the in-app "retry failed" action). Messages are
    removed from the DLQ (ack_requeue_false) then published to the default
    exchange with routing key == base; the attempt header is dropped so they get
    a fresh retry budget."""
    if base not in TASK_QUEUE_BASES:
        raise HTTPException(status_code=404, detail="unknown queue")
    vhost = _vhost()
    dlq = f"{base}.dlq"
    get_body = {
        "count": int(limit), "ackmode": "ack_requeue_false",
        "encoding": "auto", "truncate": 1_000_000,
    }
    try:
        msgs = await clients.rabbitmq_mgmt(
            "POST", f"/api/queues/{vhost}/{dlq}/get", json=get_body
        )
        requeued = 0
        for m in (msgs or []):
            if not isinstance(m, dict):
                continue
            pub = {
                "properties": {},  # drop headers (incl. x-attempt) -> fresh retries
                "routing_key": base,
                "payload": m.get("payload", ""),
                "payload_encoding": m.get("payload_encoding", "string"),
            }
            await clients.rabbitmq_mgmt(
                "POST", f"/api/exchanges/{vhost}/amq.default/publish", json=pub
            )
            requeued += 1
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"rabbitmq unavailable: {exc.detail}")
    return {"status": "requeued", "queue": base, "count": requeued}


# ---------------------------------------------------------------------------
# /images admin — DB power-user page (#30)
#
# Browse/filter the catalog truth (full records incl. raw params/workflow_json/
# api_prompt_json), edit curated fields, and trigger per-image re-index/re-label.
# DELETE /images/{sha256} (defined above) is the fan-out un-index. Projection
# stores (search/graph) are never edited here — they're rebuilt from truth.
# ---------------------------------------------------------------------------
@app.get("/images")
async def list_images(
    tag: list[str] | None = Query(default=None),
    exclude_tag: list[str] | None = Query(default=None),
    favorite: bool | None = None,
    rating_gte: int | None = Query(default=None, ge=0, le=5),
    safety: list[str] | None = Query(default=None),
    path: str | None = Query(default=None),
    sort: str = "newest",
    limit: int = 50,
    offset: int = 0,
) -> Any:
    """Browse the catalog truth. `tag`/`exclude_tag`/`safety` are repeatable
    (?tag=a&tag=b); `path` substring-matches the on-disk file path; `sort` and
    `rating_gte` drive server-side ordering/filtering for the library browse
    grid. All filters are forwarded verbatim to catalog."""
    from urllib.parse import urlencode

    params: list[tuple[str, str]] = [
        ("limit", str(int(limit))),
        ("offset", str(int(offset))),
        ("sort", sort),
    ]
    for t in tag or []:
        params.append(("tag", t))
    for t in exclude_tag or []:
        params.append(("exclude_tag", t))
    if favorite is not None:
        params.append(("favorite", "true" if favorite else "false"))
    if rating_gte is not None:
        params.append(("rating_gte", str(int(rating_gte))))
    for s in safety or []:
        params.append(("safety", s))
    if path:
        params.append(("path", path))
    try:
        res = await clients.catalog("GET", f"/images?{urlencode(params)}")
    except DownstreamError:
        return []
    return res if isinstance(res, list) else []


@app.get("/images/count")
async def count_images(
    tag: list[str] | None = Query(default=None),
    exclude_tag: list[str] | None = Query(default=None),
    favorite: bool | None = None,
    rating_gte: int | None = Query(default=None, ge=0, le=5),
    safety: list[str] | None = Query(default=None),
    path: str | None = Query(default=None),
) -> Any:
    """Total images matching a filter set (catalog proxy), for report tooling to
    size the export before paging GET /images. Same repeatable filters as the
    browse list; degrades to {count: 0} when catalog is down."""
    from urllib.parse import urlencode

    params: list[tuple[str, str]] = []
    for t in tag or []:
        params.append(("tag", t))
    for t in exclude_tag or []:
        params.append(("exclude_tag", t))
    if favorite is not None:
        params.append(("favorite", "true" if favorite else "false"))
    if rating_gte is not None:
        params.append(("rating_gte", str(int(rating_gte))))
    for s in safety or []:
        params.append(("safety", s))
    if path:
        params.append(("path", path))
    qs = f"?{urlencode(params)}" if params else ""
    try:
        res = await clients.catalog("GET", f"/images/count{qs}")
    except DownstreamError:
        return {"count": 0}
    return res if isinstance(res, dict) else {"count": 0}


@app.get("/tags")
async def suggest_tags(prefix: str = "", limit: int = 10) -> Any:
    """Tag-name autocomplete for the filter UI — proxies catalog GET /tags.

    Degrades to an empty list when catalog is unreachable so the type-ahead just
    goes quiet rather than erroring the whole search panel."""
    from urllib.parse import urlencode

    params = urlencode({"prefix": prefix, "limit": int(limit)})
    try:
        res = await clients.catalog("GET", f"/tags?{params}")
    except DownstreamError:
        return []
    return res if isinstance(res, list) else []


@app.get("/tags/report")
async def tags_report(prefix: str = "", limit: int = 200, offset: int = 0) -> Any:
    """Full tag inventory with per-tag image counts, paged (catalog proxy).

    The report counterpart to GET /tags: every tag + how many live images carry
    it + a total for paging. Degrades to an empty report when catalog is down."""
    from urllib.parse import urlencode

    params = urlencode({"prefix": prefix, "limit": int(limit), "offset": int(offset)})
    try:
        res = await clients.catalog("GET", f"/tags/report?{params}")
    except DownstreamError:
        return {"total": 0, "items": []}
    return res if isinstance(res, dict) else {"total": 0, "items": []}


@app.patch("/images/{sha256}")
async def patch_image(sha256: str, payload: dict[str, Any]) -> Any:
    """Edit curated fields of one image (tags/safety/rating/favorite/prompt)."""
    return await _proxy_catalog("PATCH", f"/images/{sha256}", payload)


@app.post("/images/{sha256}/reindex", status_code=202)
async def reindex_image(sha256: str) -> JSONResponse:
    """Re-project one image (publish an index task via ingest)."""
    try:
        res = await clients.ingest("POST", "/tasks/index", json={"sha256": sha256})
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"ingest unavailable: {exc.detail}")
    return JSONResponse(status_code=202, content=res)


@app.post("/images/{sha256}/relabel", status_code=202)
async def relabel_image(sha256: str) -> JSONResponse:
    """Re-label one image (publish a label task via ingest)."""
    try:
        res = await clients.ingest("POST", "/tasks/label", json={"sha256": sha256})
    except DownstreamError as exc:
        raise HTTPException(status_code=502, detail=f"ingest unavailable: {exc.detail}")
    return JSONResponse(status_code=202, content=res)


# ---------------------------------------------------------------------------
# GET /blobs/{sha256}/{kind} — stream image bytes from catalog
#
# comfyhelper is UI-only and holds no object store, so it proxies thumbnail /
# original bytes through the gateway. The gateway in turn streams them from the
# catalog (the blob owner). Without this route the UI has no byte source and
# every image renders broken.
# ---------------------------------------------------------------------------
@app.get("/blobs/{sha256}/{kind}")
async def get_blob(sha256: str, kind: str) -> Response:
    try:
        data, content_type = await clients.request_bytes(
            "catalog", "GET", clients.CATALOG_URL, f"/blobs/{sha256}/{kind}"
        )
    except DownstreamError as exc:
        if exc.status == 404:
            raise HTTPException(status_code=404, detail="blob not found") from exc
        raise HTTPException(status_code=502, detail=f"catalog unavailable: {exc.detail}") from exc
    return Response(content=data, media_type=content_type)


# ---------------------------------------------------------------------------
# POST /mcp — JSON-RPC 2.0 MCP surface
# ---------------------------------------------------------------------------
@app.post("/mcp")
async def mcp_endpoint(request: Request) -> JSONResponse:
    body = await request.json()
    result = await mcp.handle_body(body)
    if result is None:
        # JSON-RPC notification(s): no response body.
        return JSONResponse(status_code=202, content=None)
    return JSONResponse(content=result)
