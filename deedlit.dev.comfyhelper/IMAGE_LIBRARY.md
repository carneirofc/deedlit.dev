# Generated-Image Library Stack

Extends comfyhelper into a generated-image library with metadata extraction,
graph relationship exploration, vector similarity search, optional external
LLM/vision enrichment, REST APIs, and an MCP tool surface for external agents.

> Security is intentionally open in v1 (local/self-hosted). The tool boundary
> (service layer + typed APIs + MCP) is the seam where auth will later attach —
> no raw SQL/Cypher/Qdrant access is exposed to callers.

---

# Target architecture (migration in progress — 2026-06)

The single Next.js monolith documented below ("Current implementation") is being
decomposed into a set of standalone **FastAPI (Python)** services plus a **UI-only**
frontend. Drivers: specialize the backend, move **all** embeddings to the vision
service, add **dense + sparse hybrid** vectors, and extract embedded-workflow
metadata into its own service — **without coupling** the pieces
(**database-per-service**; services talk **only over HTTP**).

## Services (monorepo siblings; each own pyproject/venv/Dockerfile; no shared source)

| Service | Kind | Owns | Responsibility |
|---|---|---|---|
| `comfyhelper` | Next.js | — | React UI only; talks only to `deedlit.api` |
| `deedlit.api` | FastAPI gateway | no DB | BFF: aggregate detail pages, host MCP, dispatch ingest jobs, single UI base URL, future auth seam |
| `deedlit.catalog` | FastAPI | Postgres + RustFS | canonical: images, tags, params, references, ratings, favorites, notes, collections; thumbnails + cached embeddings (blobs) |
| `deedlit.search` | FastAPI | Qdrant | dense (CLIP) + sparse (SPLADE) named vectors; RRF hybrid query |
| `deedlit.graph` | FastAPI | Neo4j | shared-asset, tag co-occurrence, lineage; rebuildable from catalog |
| `deedlit.ingest` | FastAPI worker | no DB | scan FS, sha256/phash/dims/thumbnail, call metadata+vision, fan out writes |
| `deedlit.metadata` | FastAPI | no DB | bytes → embedded parse: prompt/tags/params + resolved reference graph |
| `deedlit.vision` | FastAPI (GPU) | no DB | CLIP dense (image/text) + SPLADE sparse (**exists**) |

**Rules.**
- Owning services (`catalog`/`search`/`graph`) are the **sole writer** of their
  store and **never call each other**.
- Only `ingest` (writes) and `api` (reads) talk to multiple services.
- `search` + `graph` are **rebuildable projections** of `catalog` (canonical truth).
- Services share **no source code** — typed clients are generated from each
  provider's `/openapi.json`.

## Data flow

**Ingest** (new image / reindex):
1. `ingest` scans a folder, reads bytes, computes **sha256 (the cross-service id)**,
   perceptual hash, dims, and the WebP thumbnail.
2. `ingest` → `metadata POST /extract` (bytes) → `sourceTool`, prompt, negative,
   normalized tags, params, raw `workflow`+`api_prompt` JSON, and
   `references{checkpoints, loras, embeddings, vae, controlnets, upscalers (+hash)}`.
3. `ingest` → `vision`: `/embed/image` (CLIP dense 1024) + `/embed/sparse`
   (SPLADE over prompt+tags).
4. `ingest` fans out: `POST catalog` (record + thumbnail), `POST search`
   (dense+sparse), `POST graph` (edges). Per-store retry; **catalog written first**
   as the source of truth.

**Read** (UI/MCP): `comfyhelper` → `api` → aggregates `catalog` (+ `search` for
similar/semantic, + `graph` for neighbors/lineage).

**User writes**: rating/favorite/notes/collections → `api` → `catalog` (single
store). delete/tag-edit/reindex → `api` enqueues an **ingest job** (multi-store).

**Consistency**: synchronous best-effort fan-out + per-store retry;
**rebuild-from-catalog** repairs projection drift (search/graph fully derivable).

## Vectors (dense + sparse hybrid)

- **Dense**: CLIP **vit_h, 1024-dim, cosine** (vision default preset), image↔text
  aligned. The local pixel-histogram fallback is **removed** — embeddings are
  mandatory via vision.
- **Sparse**: **SPLADE** learned sparse (fastembed) over prompt+tags text; term
  expansion for natural-language prompts.
- Qdrant collection = **named vectors** (dense + sparse). Hybrid query = Query API
  `prefetch(dense)` + `prefetch(sparse)` → **RRF fusion**.
- **ID**: Qdrant point id = **UUIDv5 derived from sha256**; full sha256 in payload.
- The old **512-dim** placeholder collection is scrapped; re-ingest rebuilds at 1024.

## Recovered features (were deleted in the SQLite→Postgres refactor)

- **notes** — Editor.js rich text (positive/negative prompt + body), ordered image
  refs **by sha256**, by-image lookup, export — in `catalog`.
- **collections** — manual image groups, coexisting with auto `clusters` — in `catalog`.
- **stats** — lightweight gateway-aggregated panel (counts, top tags/models/loras).
- **jobs + health dashboard** (ingest progress + per-service health) **replaces** the
  old admin/roots/scan/SSE/debug surface, which stays **dropped**.

## Migration (strangler — system stays up each phase)

- **Phase 1**: stand up `deedlit.vision` sparse (SPLADE) + `deedlit.metadata`; the
  current TS app calls them over HTTP, replacing in-process metadata parsing + the
  local embedding.
- **Phase 2**: extract `deedlit.ingest` as a Python worker driving vision+metadata.
- **Phase 3**: split `deedlit.catalog` / `deedlit.search` / `deedlit.graph` +
  `deedlit.api` gateway; flip Next.js to UI-only.
- Images are **re-ingested** each phase (derivable). Only **user-curation tables**
  (notes, collections, ratings, favorites) are copied **once**, at the catalog cut-over.

See `../IMPLEMENTATION_PLAN.md` for the task-level plan.

## Open risks

- **SPLADE is English-centric** — may over-expand booru/non-English tags; verify
  relevance on real prompts (BM25 over Qdrant `Modifier.IDF` is the fallback lever).
- **Fan-out is not atomic** — write catalog first; a reconcile sweep + per-image
  projection status catches stragglers.
- **Re-ingest throughput** is GPU-bound at vision — batch catalog POSTs and measure.
- ComfyUI graphs often embed asset **names without hashes** — graph edges key on the
  normalized name when the hash is absent.

---

# Current implementation (Phase 0 monolith — being strangled)

> Everything below describes the **live** single-app implementation that the target
> architecture above is replacing. It remains accurate until each migration phase
> lands.

## Responsibility split

| Store        | Role                                                            |
|--------------|----------------------------------------------------------------|
| PostgreSQL   | Canonical source of truth (metadata, prompts, tags, params)    |
| Neo4j        | Rebuildable projection — relationships, lineage, co-occurrence  |
| Qdrant       | Rebuildable projection — image embeddings for similarity        |
| RustFS (S3)  | Thumbnails + cached embeddings (avoid runtime re-compute)        |
| Filesystem   | Original images (read-only source)                              |

Neo4j and Qdrant are always rebuildable from PostgreSQL (see maintenance).
PostgreSQL fully replaces the previous SQLite/Prisma backend — there is no
SQLite anywhere in the app anymore.

## Run the data stack

```bash
docker compose up -d                 # postgres + neo4j + qdrant + rustfs
docker compose --profile app up -d   # + the Next.js app (built from ../ root)
docker compose down -v               # stop and wipe all data
```

Ports: Postgres `5432`, Neo4j `7474`/`7687`, Qdrant `6333`/`6334`,
RustFS `9000` (S3 API) / `9001` (console).

Run the app on the host instead:

```bash
cp .env.example .env.local           # defaults already match docker-compose
npm install
npm run dev
```

The library endpoints lazily create the PostgreSQL schema on first call, so the
app boots even when the databases are down (legacy gallery keeps working).

## Configuration

See `.env.example`. Key variables: `DATABASE_URL`, `NEO4J_URI`/`NEO4J_USER`/
`NEO4J_PASSWORD`, `QDRANT_URL`, `COMFYHELPER_PUBLIC_URL`, `IMAGE_LIBRARY_ROOT`,
`THUMBNAIL_ROOT`, `ENABLE_EXTERNAL_VISION_ENRICHMENT` (+ `EXTERNAL_VISION_*`),
`MCP_ENABLED`, and object storage: `OBJECT_STORE_ENABLED`,
`OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`,
`OBJECT_STORE_BUCKET`.

`COMFYHELPER_PUBLIC_URL` is the browser-reachable base URL of this app. Each
Qdrant point payload carries both the server-local `file_path` and absolute
proxy URLs built from it — `thumbnail_url` (`/api/library/images/<id>/thumbnail.webp`)
and `image_url` (`/api/library/images/<id>/file.<ext>`, full-resolution original) — so
points render as images in the Qdrant dashboard and the deedlit.vision test UI
instead of as a broken local path. The image extension is required for the Qdrant
dashboard to render the URL as a preview; the proxy routes accept the extension
(rewritten away in `next.config.ts`) but serve bytes/content-type from the DB. In docker it must be the host-mapped address
(`http://localhost:3000`), not the in-network `app` hostname.

## Object storage (RustFS)

When `OBJECT_STORE_ENABLED=true`, thumbnails and computed embeddings are stored
in [RustFS](https://github.com/rustfs/rustfs) (S3-compatible) instead of being
written to disk / recomputed:

- **Thumbnails** → `s3://<bucket>/thumbnails/<size>/<shard>/<sha256>.webp`. The
  DB stores this `s3://…` pointer in `images.thumbnail_path`; the thumbnail
  route streams it back. Local-filesystem mode is used when disabled.
- **Embeddings** → `s3://<bucket>/embeddings/<provider>-<dims>/<shard>/<sha256>.json`,
  keyed by image sha256, so Qdrant rebuilds and reindexes reuse the cached
  vector instead of re-reading pixels.

Accessed via the AWS S3 SDK (`@aws-sdk/client-s3`, path-style). All operations
are best-effort and fall back to the filesystem so ingestion never breaks.

## Embeddings

The MVP is self-contained: image embeddings are computed locally from pixels
(downscaled RGB grid + per-channel histograms, cosine distance). Good for
visual-similarity and near-duplicate retrieval. Set
`EXTERNAL_IMAGE_EMBEDDING_PROVIDER` to a real provider to swap in learned
semantic embeddings without touching the Qdrant/search layers. Until then,
`semantic_image_search` falls back to PostgreSQL metadata search.

## REST API

| Method | Path                                              | Purpose                          |
|--------|---------------------------------------------------|----------------------------------|
| GET    | `/api/library/health`                             | Ping all three stores            |
| POST   | `/api/library/ingest/folder`                      | Start folder ingestion (job)     |
| GET    | `/api/library/jobs`, `/api/library/jobs/{id}`     | Ingestion job status             |
| POST   | `/api/library/jobs/{id}/cancel`                   | Cancel a job                     |
| POST   | `/api/library/search`                             | Metadata / hybrid search         |
| POST   | `/api/library/search/semantic`                    | Natural-language search          |
| POST   | `/api/library/search/similar`                     | Similar to an image              |
| GET    | `/api/library/images`                             | Filtered list (querystring)      |
| GET/PATCH | `/api/library/images/{id}`                     | Detail / set rating·favorite     |
| GET    | `/api/library/images/{id}/thumbnail`              | Stream WebP thumbnail            |
| GET    | `/api/library/images/{id}/file`                   | Stream full-resolution original  |
| GET    | `/api/library/images/{id}/graph`                  | Relationship subgraph            |
| GET    | `/api/library/images/{id}/lineage`                | Variant/upscale/inpaint lineage  |
| GET    | `/api/library/tags/{tag}/related`                 | Co-occurring tags                |
| POST   | `/api/library/reindex`                            | Re-extract + refresh projections |
| POST   | `/api/library/maintenance/rebuild-neo4j`          | Rebuild graph from Postgres      |
| POST   | `/api/library/maintenance/rebuild-qdrant`         | Rebuild vectors from Postgres    |
| POST   | `/api/library/maintenance/rescan-files`           | Mark missing files deleted       |
| POST   | `/api/library/maintenance/regenerate-thumbnails`  | Backfill missing thumbnails      |

## MCP tools

Stateless MCP-over-HTTP (JSON-RPC) at `POST /api/mcp` (`GET /api/mcp` lists
tools). Implements `initialize`, `tools/list`, `tools/call`, `ping`. Tools:
`search_images`, `semantic_image_search`, `find_similar_images`,
`get_image_details`, `get_image_graph`, `find_related_tags`,
`find_image_lineage`, `describe_image_optional`, `ingest_folder`,
`reindex_image`. All reuse the same service layer as the REST API.

## Code layout

```
lib/library/
  config.ts              env-driven configuration
  http.ts                route error-handling wrapper
  schemas.ts             Zod contracts (image, search, ingest, graph)
  db/                    postgres.ts · neo4j.ts · qdrant.ts · schema.sql · migrate.ts
  storage/               object-store.ts (RustFS / S3 client)
  repositories/          image · tag · model · graph · vector
  services/              metadata · thumbnail · embedding · qdrant · graph ·
                         search · ingest · enrichment · jobs · maintenance
  mcp/                   tools.ts (registry) · server.ts (JSON-RPC dispatch)
app/api/library/**       REST routes
app/api/mcp/route.ts     MCP endpoint
app/library/**           Library UI (search, ingest, image detail, similar, graph)
```

## Trust rules (data quality)

- Embedded metadata + prompt tags are high trust; never overwritten by LLM output.
- External vision tags are stored with `source = external_vision_llm` + confidence.
- Generated descriptions live in `image_descriptions` with provider/model/timestamp.
- Tags are normalized (`Red Eyes` → `red_eyes`); aliases tracked in `tag_aliases`.
