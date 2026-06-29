# ComfyHelper — Generated-Image Library UI

Next.js frontend for ingesting, searching, and exploring a generated-image library
(ComfyUI / Automatic1111 outputs): metadata-rich browsing, hybrid vector search,
graph relationship exploration, queue/health dashboards, and an MCP tool surface
for external agents.

The image-library backend lives in sibling **FastAPI** services; this app talks to
the [`deedlit.api`](../deedlit.api/) gateway. The full architecture, data flow, and
data-quality rules are in **[`IMAGE_LIBRARY.md`](./IMAGE_LIBRARY.md)**.

## Run

From the repo root (starts datastores, services, and both web apps):

```bash
npm run infra:up        # postgres + neo4j + qdrant + rustfs + rabbitmq + redis + o11y
npm run dev:migrate     # apply catalog migrations
npm run dev             # all apps + services via mprocs
```

ComfyHelper alone (gateway must already be running):

```bash
npm run dev:comfyhelper # http://localhost:3000  (redirects to /library)
```

See the root [`README.md`](../README.md) for the full topology and ports.

## Using node

Activate the correct Node version with `fnm`:

```bash
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

## Notes

- Intended for local / self-hosted use. Security is intentionally open in v1; the
  gateway + typed service APIs + MCP tools are the seam where auth will attach.
- Server-side logs use `pino` (`pino-pretty` outside production); set `LOG_LEVEL`
  to change verbosity.
