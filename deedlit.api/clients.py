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


# Service -> base URL map, for the health dashboard probe.
SERVICES: dict[str, str] = {
    "catalog": CATALOG_URL,
    "search": SEARCH_URL,
    "graph": GRAPH_URL,
    "ingest": INGEST_URL,
}
