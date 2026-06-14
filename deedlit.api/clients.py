"""Downstream HTTP boundary for the deedlit.api BFF gateway.

The gateway holds NO database. Every piece of data it serves comes from one of
the four owning services, reached over HTTP:

    catalog  (source of truth: images / tags / notes / collections / stats)
    search   (Qdrant hybrid search + similar/by-image)
    graph    (Neo4j neighbors / lineage / related-tags)
    ingest   (stateless ingest + maintenance jobs)

Base URLs are env-overridable (defaults target the local-dev topology). All
outbound traffic funnels through :func:`request`, which builds an
``httpx.AsyncClient`` via :func:`make_async_client` — tests monkeypatch that
factory to install an ``httpx.MockTransport`` and stay offline.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Downstream base URLs (env-overridable; defaults for local dev)
# ---------------------------------------------------------------------------
CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:8001").rstrip("/")
SEARCH_URL = os.getenv("SEARCH_URL", "http://localhost:8002").rstrip("/")
GRAPH_URL = os.getenv("GRAPH_URL", "http://localhost:8003").rstrip("/")
INGEST_URL = os.getenv("INGEST_URL", "http://localhost:8004").rstrip("/")

# Stateless workers ingest fans out to. The gateway never proxies data to these
# (only ingest does), but it probes them for the status dashboard so the UI can
# show every component, not just the routable ones.
VISION_URL = os.getenv("VISION_URL", "http://localhost:8000").rstrip("/")
METADATA_URL = os.getenv("METADATA_URL", "http://localhost:8005").rstrip("/")

HTTP_TIMEOUT = float(os.getenv("API_HTTP_TIMEOUT", "15.0"))


class DownstreamError(Exception):
    """A downstream service returned a non-2xx response or was unreachable."""

    def __init__(self, service: str, status: int | None, detail: str) -> None:
        self.service = service
        self.status = status
        self.detail = detail
        super().__init__(f"{service} -> {status}: {detail}")


def make_async_client(**kwargs: Any) -> httpx.AsyncClient:
    """Construct the AsyncClient used for one downstream call.

    Isolated into a factory so tests can swap in an ``httpx.MockTransport``.
    """
    kwargs.setdefault("timeout", HTTP_TIMEOUT)
    return httpx.AsyncClient(**kwargs)


async def request(
    service: str,
    method: str,
    base_url: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json: Any | None = None,
) -> Any:
    """Make one downstream call and return the decoded JSON body.

    Raises :class:`DownstreamError` on a transport error or a non-2xx status so
    callers can decide whether to fail the request (catalog) or degrade
    gracefully (search/graph/ingest).
    """
    url = f"{base_url}{path}"
    try:
        async with make_async_client() as client:
            resp = await client.request(method, url, params=params, json=json)
    except httpx.HTTPError as exc:  # connect/timeout/transport
        raise DownstreamError(service, None, str(exc)) from exc

    if resp.status_code >= 400:
        raise DownstreamError(service, resp.status_code, _safe_detail(resp))

    if not resp.content:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


async def request_bytes(
    service: str,
    method: str,
    base_url: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> tuple[bytes, str]:
    """Make one downstream call and return its RAW body + content-type.

    The JSON-decoding :func:`request` can't carry image bytes, so blob proxying
    (thumbnails / originals) goes through here. Raises :class:`DownstreamError`
    on transport error or non-2xx so the caller can map 404 vs 502.
    """
    url = f"{base_url}{path}"
    try:
        async with make_async_client() as client:
            resp = await client.request(method, url, params=params)
    except httpx.HTTPError as exc:
        raise DownstreamError(service, None, str(exc)) from exc
    if resp.status_code >= 400:
        raise DownstreamError(service, resp.status_code, _safe_detail(resp))
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return resp.content, content_type


def _safe_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict) and "detail" in body:
            return str(body["detail"])
        return str(body)
    except ValueError:
        return resp.text or ""


# ---------------------------------------------------------------------------
# Typed convenience wrappers (used by routes + MCP tools)
# ---------------------------------------------------------------------------
async def catalog(method: str, path: str, **kw: Any) -> Any:
    return await request("catalog", method, CATALOG_URL, path, **kw)


async def search(method: str, path: str, **kw: Any) -> Any:
    return await request("search", method, SEARCH_URL, path, **kw)


async def graph(method: str, path: str, **kw: Any) -> Any:
    return await request("graph", method, GRAPH_URL, path, **kw)


async def ingest(method: str, path: str, **kw: Any) -> Any:
    return await request("ingest", method, INGEST_URL, path, **kw)


async def vision(method: str, path: str, **kw: Any) -> Any:
    return await request("vision", method, VISION_URL, path, **kw)


# ---------------------------------------------------------------------------
# Text search orchestration
# ---------------------------------------------------------------------------
# deedlit.search is a pure Qdrant vector store: its POST /query takes
# pre-computed dense/sparse vectors, NOT a text string. To search by text the
# gateway must first encode the query via deedlit.vision (the same towers ingest
# uses at write time), then hand the vectors to search. This is the missing hop
# the raw proxy skipped.
async def encode_query(query: str) -> dict[str, Any] | None:
    """Encode a text query into the dense + sparse vectors search expects.

    Returns ``None`` for an empty/whitespace query: there is no vector to search
    by, so callers should treat it as an empty result set rather than asking
    search for a vectorless query (which it rejects with 422).
    """
    text = query.strip()
    if not text:
        return None
    dense_res = await vision("POST", "/embed/text", json={"text": text})
    sparse_res = await vision("POST", "/embed/sparse", json={"text": text})
    return {
        "dense": (dense_res or {}).get("embedding"),
        "sparse": {
            "indices": (sparse_res or {}).get("indices", []),
            "values": (sparse_res or {}).get("values", []),
        },
    }


async def search_by_text(query: str, limit: int, filter: dict[str, Any] | None) -> Any:
    """Encode ``query`` via vision, then run the hybrid search on deedlit.search.

    An empty query has no vector to search by. Rather than returning nothing
    (which left the default library gallery blank after a successful ingest),
    fall back to a catalog browse — list the cataloged images directly so the
    no-query "browse" view shows the library.
    """
    vectors = await encode_query(query)
    if vectors is None:
        return await browse_catalog(limit, filter)
    body = {**vectors, "limit": limit, "filter": filter}
    return await search("POST", "/query", json=body)


async def browse_catalog(limit: int, filter: dict[str, Any] | None) -> dict[str, Any]:
    """List cataloged images as search-shaped hits (no-query browse fallback).

    deedlit.search is purely vector-driven and can't answer a filter-only/empty
    query, but the catalog is the source of truth and lists images directly.
    We map its rows into the ``{fusion, hits:[{sha256, score, payload}]}`` shape
    the UI already consumes, threading the supported facets (tag/favorite) into
    catalog ``GET /images`` query params.
    """
    params: dict[str, Any] = {"limit": limit}
    if filter:
        # The UI sends `tags: [...]` (catalog lists by a single tag) + `favorite`.
        tags = filter.get("tags") or filter.get("tag")
        if isinstance(tags, list) and tags:
            params["tag"] = tags[0]
        elif isinstance(tags, str) and tags:
            params["tag"] = tags
        fav = filter.get("favorite")
        if isinstance(fav, bool):
            params["favorite"] = fav
    try:
        rows = await catalog("GET", "/images", params=params)
    except DownstreamError:
        return {"fusion": "browse", "hits": []}
    hits = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        sha = row.get("sha256")
        if not sha:
            continue
        # Surface the whole catalog record as the hit payload so the UI's
        # hit->card mapper (prompt/tags/rating/...) renders without a second fetch.
        hits.append({"sha256": sha, "score": None, "payload": row})
    return {"fusion": "browse", "hits": hits}


# Service -> base URL map, for the health dashboard probe.
SERVICES: dict[str, str] = {
    "catalog": CATALOG_URL,
    "search": SEARCH_URL,
    "graph": GRAPH_URL,
    "ingest": INGEST_URL,
}

# Everything GET /health probes: the routable SERVICES plus the stateless
# workers. Superset of SERVICES — keep SERVICES as the routable set so request
# proxying is unaffected.
HEALTH_SERVICES: dict[str, str] = {
    **SERVICES,
    "vision": VISION_URL,
    "metadata": METADATA_URL,
}
