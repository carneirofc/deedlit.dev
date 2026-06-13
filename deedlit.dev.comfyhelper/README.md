# Generated-Image Library

Next.js app for ingesting, searching, and exploring a generated-image library
(ComfyUI / Automatic1111 outputs) with metadata extraction, graph relationship
exploration, vector similarity search, optional external vision enrichment, REST
APIs, and an MCP tool surface for external LLM agents.

The full architecture, configuration, REST/MCP reference, and data-quality rules
live in **[`IMAGE_LIBRARY.md`](./IMAGE_LIBRARY.md)**.

## Stack

- **Next.js 16** — UI + API route handlers + MCP endpoint
- **PostgreSQL** — canonical source of truth (replaces the old SQLite/Prisma backend)
- **Neo4j** — rebuildable relationship graph projection
- **Qdrant** — rebuildable image-embedding projection (similarity / near-dup)
- **RustFS** — S3-compatible object storage for thumbnails + cached embeddings

PostgreSQL is canonical; Neo4j, Qdrant, and RustFS are all derived/rebuildable.

## Run

```bash
docker compose up -d        # postgres + neo4j + qdrant + rustfs
cp .env.example .env.local  # defaults match docker-compose
npm install
npm run dev                 # http://localhost:3000  (redirects to /library)
```

Run the whole thing (app included) in containers with
`docker compose --profile app up -d`.

## Using node

Activate the correct Node version with `fnm`:

```bash
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

## Notes

- Intended for local / self-hosted use. Security is intentionally open in v1; the
  service layer + typed APIs + MCP tools are the seam where auth will attach.
- Server-side logs use `pino` (`pino-pretty` outside production); set `LOG_LEVEL`
  to change verbosity.
- The PostgreSQL schema is created lazily on first API call, so the app boots
  even when the databases are down.
