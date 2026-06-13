"""MCP (JSON-RPC 2.0 over HTTP) surface for the deedlit.api gateway.

This is the Python port of the TS MCP server that used to live inside the
Next.js app (``deedlit.dev.comfyhelper/lib/library/mcp/{tools,server}.ts``).

In the monolith each tool called a repository/service that talked to the DB
directly. In the decomposed topology the gateway has NO database, so every tool
DISPATCHES over HTTP to the owning service:

    catalog  -> get_image_details, find_related_tags(via graph), notes/etc
    search   -> search_images, semantic_image_search, find_similar_images
    graph    -> get_image_graph, find_image_lineage, find_related_tags
    ingest   -> ingest_folder (enqueue), reindex_image (enqueue maintenance)

Tool names + argument shapes are kept aligned with the TS MCP so existing MCP
clients keep working. A few tools whose backing service is not yet part of the
decomposition (compare / cluster / external vision) are STUBBED — they return a
structured ``{stubbed: true, reason}`` payload rather than failing the call, and
are documented in the module-level ``STUBBED_TOOLS`` list.

JSON-RPC dispatch (initialize / tools/list / tools/call / ping) mirrors
``server.ts`` so the protocol surface is identical.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

import clients

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "comfyhelper-image-library", "version": "0.1.0"}

# Tools that have no owning service in the current decomposition and therefore
# return a structured stub instead of dispatching. Documented for the report.
STUBBED_TOOLS = ("compare_images", "find_image_clusters", "describe_image_optional")


# ---------------------------------------------------------------------------
# Filter mapping (snake_case MCP args -> the filter object search expects)
# ---------------------------------------------------------------------------
def _pick_filters(d: dict[str, Any] | None) -> dict[str, Any]:
    if not d:
        return {}
    out = {
        "tags": d.get("tags"),
        "excludeTags": d.get("exclude_tags"),
        "modelFamily": d.get("model_family"),
        "checkpoint": d.get("checkpoint"),
        "loras": d.get("loras"),
        "ratingGte": d.get("rating_gte"),
        "favorite": d.get("favorite"),
    }
    return {k: v for k, v in out.items() if v is not None}


# ---------------------------------------------------------------------------
# Tool handlers — each dispatches to a downstream service via clients.py
# ---------------------------------------------------------------------------
async def _search_images(args: dict[str, Any]) -> Any:
    body: dict[str, Any] = {
        "query": args.get("query", ""),
        "limit": args.get("limit", 30),
        "filter": _pick_filters(_top_level_filters(args)) or None,
    }
    res = await clients.search("POST", "/query", json=body)
    return {"results": (res or {}).get("hits", [])}


def _top_level_filters(args: dict[str, Any]) -> dict[str, Any]:
    """search_images carries filter fields at the top level (per the TS schema)."""
    keys = ("tags", "exclude_tags", "model_family", "checkpoint", "loras", "rating_gte", "favorite")
    return {k: args[k] for k in keys if k in args}


async def _semantic_image_search(args: dict[str, Any]) -> Any:
    body = {
        "query": args["query"],
        "limit": args.get("limit", 30),
        "filter": _pick_filters(args.get("filters")) or None,
    }
    res = await clients.search("POST", "/query", json=body)
    return {"results": (res or {}).get("hits", [])}


async def _find_similar_images(args: dict[str, Any]) -> Any:
    body = {"sha256": args["image_id"], "limit": args.get("limit", 30)}
    res = await clients.search("POST", "/similar", json=body)
    return {"results": (res or {}).get("hits", [])}


async def _get_image_details(args: dict[str, Any]) -> Any:
    return await clients.catalog("GET", f"/images/{args['image_id']}")


async def _get_image_graph(args: dict[str, Any]) -> Any:
    params: dict[str, Any] = {"limit": args.get("limit", 24)}
    rels = args.get("relationship_types")
    if rels:
        params["relation"] = rels[0]
    return await clients.graph("GET", f"/neighbors/{args['image_id']}", params=params)


async def _find_related_tags(args: dict[str, Any]) -> Any:
    related = await clients.graph(
        "GET", f"/related-tags/{args['tag']}", params={"limit": args.get("limit", 20)}
    )
    return {"tag": args["tag"], "related": related or []}


async def _find_image_lineage(args: dict[str, Any]) -> Any:
    return await clients.graph("GET", f"/lineage/{args['image_id']}")


async def _ingest_folder(args: dict[str, Any]) -> Any:
    res = await clients.ingest("POST", "/ingest", json={"folderPath": args["folder_path"]})
    res = res or {}
    return {"job_id": res.get("id"), "status": res.get("status", "started")}


async def _reindex_image(args: dict[str, Any]) -> Any:
    res = await clients.ingest(
        "POST", "/jobs", json={"type": "reindex-one-image", "sha256": args["image_id"]}
    )
    res = res or {}
    return {"job_id": res.get("id"), "status": res.get("status", "started")}


def _stub(name: str, reason: str) -> Callable[[dict[str, Any]], Awaitable[Any]]:
    async def handler(_args: dict[str, Any]) -> Any:
        return {"stubbed": True, "tool": name, "reason": reason}

    return handler


# ---------------------------------------------------------------------------
# Tool registry (name, description, JSON-Schema, handler)
# ---------------------------------------------------------------------------
def _filter_props() -> dict[str, Any]:
    return {
        "tags": {"type": "array", "items": {"type": "string"}},
        "exclude_tags": {"type": "array", "items": {"type": "string"}},
        "model_family": {"type": "string"},
        "checkpoint": {"type": "string"},
        "loras": {"type": "array", "items": {"type": "string"}},
        "rating_gte": {"type": "integer", "minimum": 0, "maximum": 5},
        "favorite": {"type": "boolean"},
    }


MCP_TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_images",
        "description": "General metadata / hybrid image search across the library.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                **_filter_props(),
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 30},
            },
        },
        "handler": _search_images,
    },
    {
        "name": "semantic_image_search",
        "description": "Natural-language image search (hybrid dense+sparse via deedlit.search).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "filters": {"type": "object", "properties": _filter_props()},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 30},
            },
            "required": ["query"],
        },
        "handler": _semantic_image_search,
    },
    {
        "name": "find_similar_images",
        "description": "Find images visually similar to a selected image.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string", "minLength": 1},
                "filters": {"type": "object", "properties": _filter_props()},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 30},
            },
            "required": ["image_id"],
        },
        "handler": _find_similar_images,
    },
    {
        "name": "compare_images",
        "description": "Compare 2-4 images (metadata diff, shared/unique tags, similarity, combined graph). STUBBED: no owning service in the current decomposition.",
        "inputSchema": {
            "type": "object",
            "properties": {"image_ids": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4}},
            "required": ["image_ids"],
        },
        "handler": _stub("compare_images", "compare-service is not part of the decomposed topology yet"),
    },
    {
        "name": "find_image_clusters",
        "description": "Cluster the library by embedding similarity (Louvain). STUBBED: no owning service in the current decomposition.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filters": {"type": "object", "properties": _filter_props()},
                "sample": {"type": "integer", "default": 400},
                "neighbors": {"type": "integer", "default": 6},
                "threshold": {"type": "number", "default": 0.6},
                "resolution": {"type": "number", "default": 1},
            },
        },
        "handler": _stub("find_image_clusters", "cluster-service is not part of the decomposed topology yet"),
    },
    {
        "name": "get_image_details",
        "description": "Return complete canonical metadata for an image (from deedlit.catalog).",
        "inputSchema": {
            "type": "object",
            "properties": {"image_id": {"type": "string", "minLength": 1}},
            "required": ["image_id"],
        },
        "handler": _get_image_details,
    },
    {
        "name": "get_image_graph",
        "description": "Return the relationship graph (neighbors) around an image (from deedlit.graph).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string", "minLength": 1},
                "depth": {"type": "integer", "minimum": 1, "maximum": 4, "default": 1},
                "relationship_types": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["image_id"],
        },
        "handler": _get_image_graph,
    },
    {
        "name": "find_related_tags",
        "description": "Find tags related to a tag via co-occurrence (from deedlit.graph).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tag": {"type": "string", "minLength": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
            "required": ["tag"],
        },
        "handler": _find_related_tags,
    },
    {
        "name": "find_image_lineage",
        "description": "Return original / variant / upscale / inpaint relationships for an image (from deedlit.graph).",
        "inputSchema": {
            "type": "object",
            "properties": {"image_id": {"type": "string", "minLength": 1}},
            "required": ["image_id"],
        },
        "handler": _find_image_lineage,
    },
    {
        "name": "describe_image_optional",
        "description": "Trigger optional external vision/LLM description. STUBBED: external vision enrichment is not wired into the gateway.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string", "minLength": 1},
                "mode": {"type": "string", "enum": ["short_caption", "full_description", "tags", "all"], "default": "all"},
            },
            "required": ["image_id"],
        },
        "handler": _stub("describe_image_optional", "external vision enrichment is disabled in the gateway"),
    },
    {
        "name": "ingest_folder",
        "description": "Trigger ingestion of a local folder (enqueues a deedlit.ingest job). Returns a job id immediately.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "folder_path": {"type": "string", "minLength": 1},
                "recursive": {"type": "boolean", "default": True},
                "run_external_enrichment": {"type": "boolean", "default": False},
                "generate_embeddings": {"type": "boolean", "default": True},
                "generate_thumbnails": {"type": "boolean", "default": True},
            },
            "required": ["folder_path"],
        },
        "handler": _ingest_folder,
    },
    {
        "name": "reindex_image",
        "description": "Re-extract metadata and refresh graph/vector indexes for an image (enqueues a deedlit.ingest maintenance job).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string", "minLength": 1},
                "refresh_metadata": {"type": "boolean", "default": True},
                "refresh_graph": {"type": "boolean", "default": True},
                "refresh_qdrant": {"type": "boolean", "default": True},
                "run_external_enrichment": {"type": "boolean", "default": False},
            },
            "required": ["image_id"],
        },
        "handler": _reindex_image,
    },
]

_TOOLS_BY_NAME = {t["name"]: t for t in MCP_TOOLS}


def get_tool(name: str) -> dict[str, Any] | None:
    return _TOOLS_BY_NAME.get(name)


# ---------------------------------------------------------------------------
# JSON-RPC dispatch (mirrors server.ts)
# ---------------------------------------------------------------------------
def _ok(rpc_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}


def _err(rpc_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": rpc_id, "error": error}


def _tool_list_payload() -> dict[str, Any]:
    return {
        "tools": [
            {"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}
            for t in MCP_TOOLS
        ]
    }


async def handle_message(message: dict[str, Any]) -> dict[str, Any] | None:
    """Dispatch one JSON-RPC message. Returns None for notifications (no id)."""
    rpc_id = message.get("id", None)
    method = message.get("method")

    if method == "initialize":
        return _ok(rpc_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
        })

    if method in ("notifications/initialized", "notifications/cancelled"):
        return None

    if method == "ping":
        return _ok(rpc_id, {})

    if method == "tools/list":
        return _ok(rpc_id, _tool_list_payload())

    if method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        tool = get_tool(name) if name else None
        if tool is None:
            return _err(rpc_id, -32602, f"unknown tool: {name or '(none)'}")
        try:
            result = await tool["handler"](params.get("arguments") or {})
            return _ok(rpc_id, {
                "content": [{"type": "text", "text": _to_text(result)}],
                "structuredContent": result,
                "isError": False,
            })
        except Exception as exc:  # downstream failure / bad args -> tool error
            return _ok(rpc_id, {
                "content": [{"type": "text", "text": f"Error: {exc}"}],
                "isError": True,
            })

    return _err(rpc_id, -32601, f"method not found: {method}")


async def handle_body(body: Any) -> Any:
    """Handle a single JSON-RPC message or a batch (list)."""
    if isinstance(body, list):
        responses = [await handle_message(m) for m in body]
        filtered = [r for r in responses if r is not None]
        return filtered or None
    return await handle_message(body)


def _to_text(result: Any) -> str:
    import json

    try:
        return json.dumps(result, indent=2, default=str)
    except (TypeError, ValueError):
        return str(result)
