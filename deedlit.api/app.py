"""deedlit.api — BFF gateway (no database).

The single base URL the UI talks to. The gateway owns no data; it aggregates
and proxies over HTTP to the four owning services (catalog / search / graph /
ingest). See contracts/api.openapi.yaml.

Endpoints:
  GET  /health           -> HealthDashboard (probes every downstream in parallel)
  GET  /detail/{sha256}  -> Detail{image,similar,neighbors} (parallel fan-out,
                            degrades gracefully on a single downstream failure)
  POST /search           -> proxy to deedlit.search /query
  GET  /stats            -> aggregated library stats (from catalog)
  POST /jobs             -> dispatch an ingest/maintenance job (proxy to ingest)
  GET  /jobs             -> list jobs (proxy to ingest) for the dashboard
  POST /mcp              -> MCP JSON-RPC 2.0 surface (see mcp.py)

The downstream HTTP boundary lives in clients.py (monkeypatched in tests); the
MCP tool surface lives in mcp.py.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import clients
import mcp
from clients import DownstreamError

app = FastAPI(title="deedlit.api", version="0.1.0")


# ---------------------------------------------------------------------------
# GET /health — per-service health dashboard (parallel probe)
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, Any]:
    async def probe(name: str, base: str) -> dict[str, str]:
        try:
            body = await clients.request(name, "GET", base, "/health")
            status = (body or {}).get("status", "ok") if isinstance(body, dict) else "ok"
            return {"name": name, "status": "ok" if status == "ok" else "degraded"}
        except DownstreamError:
            return {"name": name, "status": "down"}

    services = await asyncio.gather(
        *(probe(name, base) for name, base in clients.SERVICES.items())
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
    body = {"query": req.query, "limit": req.limit, "filter": req.filter}
    try:
        return await clients.search("POST", "/query", json=body)
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
