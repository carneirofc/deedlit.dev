# deedlit.api — Gateway / BFF

## Purpose
- FastAPI gateway (port 8088): the single base URL the web apps and agents talk to.
- Aggregates detail pages and proxies over HTTP to `catalog`, `search`, `graph`, `ingest`, `vision`; hosts the MCP surface; dispatches ingest jobs.

## Ownership
- Stateless — owns no datastore. Business truth lives in the downstream owning services.
- Holds downstream creds server-side (including the RabbitMQ management API).

## Local Contracts
- Canonical HTTP contract: [`../contracts/api.openapi.yaml`](../contracts/api.openapi.yaml).
- `app.py`: route surface (`/detail/{sha256}`, `/search`, `/search/by-image`, `/images*`, `/blobs/{sha256}/{kind}`, `/notes/*`, `/collections/*`, `/folders/*`, `/jobs`, `/tasks/*`, `/queues/*`, `/stats`, `/reports/folders`, `/fs/browse`, `POST /mcp`, `/health`).
- `clients.py`: the sole downstream HTTP boundary + cross-service orchestration (monkeypatched in tests).
- `mcp.py`: MCP tool registry + JSON-RPC dispatch.
- `activity.py`: in-process request tracker (`install_activity(app)`), copied verbatim into every service — keep copies in sync, do not fork behavior here.
- OpenTelemetry auto-instrumentation gates on `OTEL_TRACES_EXPORTER`.

## Work Guidance
- Keep this a thin aggregation/proxy layer — no DB, no canonical state. Route new downstream calls through `clients.py`.

## Verification
- `uv run --directory deedlit.api pytest`

## Child DOX Index
- None.
