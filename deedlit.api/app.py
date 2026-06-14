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

import asyncio
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import clients
import mcp
from clients import DownstreamError


# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact.
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            return "/health" not in str(args[2])
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.api", version="0.1.0")


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
# GET /detail/{sha256} — parallel fan-out, graceful degradation
# ---------------------------------------------------------------------------
@app.get("/detail/{sha256}")
async def detail(sha256: str) -> dict[str, Any]:
    """Aggregate the detail page from catalog + search + graph IN PARALLEL.

    catalog (the image record) is REQUIRED — a 404 there is a 404 here. The
    derived projections (similar from search, neighbors from graph) are
    best-effort: if one downstream fails we degrade to an empty list and still
    return everything that succeeded.
    """
    async def get_image() -> Any:
        return await clients.catalog("GET", f"/images/{sha256}")

    async def get_similar() -> Any:
        res = await clients.search("POST", "/similar", json={"sha256": sha256})
        return (res or {}).get("hits", [])

    async def get_neighbors() -> Any:
        res = await clients.graph("GET", f"/neighbors/{sha256}")
        return (res or {}).get("neighbors", [])

    image_r, similar_r, neighbors_r = await asyncio.gather(
        get_image(), get_similar(), get_neighbors(), return_exceptions=True
    )

    # catalog is required.
    if isinstance(image_r, DownstreamError):
        if image_r.status == 404:
            raise HTTPException(status_code=404, detail="image not found")
        raise HTTPException(status_code=502, detail=f"catalog unavailable: {image_r.detail}")
    if isinstance(image_r, Exception):
        raise HTTPException(status_code=502, detail="catalog error")

    return {
        "image": image_r,
        "similar": [] if isinstance(similar_r, Exception) else similar_r,
        "neighbors": [] if isinstance(neighbors_r, Exception) else neighbors_r,
    }


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
    """Aggregated library counts.

    ASSUMPTION: counts are sourced from a catalog ``GET /stats`` endpoint (the
    natural owner of images/tags/notes/collections). That route is not yet in
    contracts/catalog.openapi.yaml; until catalog ships it this call fails and
    the gateway degrades to a stable zero-filled shape rather than erroring.
    """
    base = {"images": 0, "tags": 0, "collections": 0, "notes": 0}
    try:
        res = await clients.catalog("GET", "/stats")
    except DownstreamError:
        return base
    if isinstance(res, dict):
        base.update({k: res.get(k, base[k]) for k in base})
    return base


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
