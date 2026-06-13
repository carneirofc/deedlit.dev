# Deedlit Image Library — Implementation Plan

Decompose `deedlit.dev.comfyhelper` (a Next.js monolith over
Postgres/Neo4j/Qdrant/RustFS) into standalone **FastAPI** services + a **UI-only**
frontend, add **dense+sparse hybrid** vectors, move **all** embeddings to the
vision service, and recover deleted curation features — **database-per-service,
HTTP-only, no shared source**.

Architecture reference: `deedlit.dev.comfyhelper/IMAGE_LIBRARY.md` → "Target
architecture". This file is the task-level plan.

## Target services

| Service | Kind | Store | New? |
|---|---|---|---|
| `comfyhelper` | Next.js UI | — | exists (strip to UI) |
| `deedlit.api` | FastAPI gateway | none | new |
| `deedlit.catalog` | FastAPI | Postgres + RustFS | new |
| `deedlit.search` | FastAPI | Qdrant | new |
| `deedlit.graph` | FastAPI | Neo4j | new |
| `deedlit.ingest` | FastAPI worker | none | new |
| `deedlit.metadata` | FastAPI | none | new |
| `deedlit.vision` | FastAPI (GPU) | none | exists (+sparse) |

## Conventions (apply to every new service)

- **Layout**: monorepo sibling dir `deedlit.<name>/`, mirroring `deedlit.vision/`.
- **Python**: `uv` + `pyproject.toml` + own `.venv`; FastAPI + uvicorn; Pydantic v2.
- **No shared source package.** Each service owns its DTOs. Consumers generate a
  typed client from the provider's `/openapi.json` (e.g. `openapi-python-client`),
  checked in under `deedlit.<consumer>/clients/<provider>/`.
- **ID**: `sha256` of the image bytes is the cross-service id. Qdrant point id =
  `uuid5(NAMESPACE, sha256)`; full sha256 carried in payload + catalog PK.
- **Health**: every service exposes `GET /health` (and `/openapi.json` via FastAPI).
- **Config**: env-driven (`.env.example` per service); no secrets in code.
- **Compose**: one root `docker-compose.yml` wires datastores + all services;
  per-service `Dockerfile`.
- **Stateless services** (`vision`/`metadata`/`ingest`) hold **no DB drivers**.
- **Owning services** (`catalog`/`search`/`graph`) **never call each other**.

---

## Phase 0 — Foundations (no behavior change)

Goal: lock the contracts and scaffolding the later phases build against.

- [ ] **Freeze the id scheme**: document sha256 + `uuid5` derivation; helper spec
      reused by every service.
- [ ] **Draft HTTP contracts** (OpenAPI sketch) for: `metadata /extract`,
      `vision /embed/{image,text,sparse}`, `catalog` (images/notes/collections/
      ratings), `search` (upsert/query), `graph` (upsert-edges/neighbors/lineage),
      `api` (UI/MCP surface), `ingest` (jobs).
- [ ] **Compose skeleton**: add empty service stubs to root `docker-compose.yml`
      (build context per sibling dir) so the topology is runnable as it fills in.
- [ ] **Decide Postgres schema** for catalog (port `lib/library/db/schema.sql` +
      add `notes`, `collections`, `image_references`); Alembic baseline migration.

**Acceptance**: contracts reviewed; `docker compose config` validates; schema
migrates clean on an empty DB.

---

## Phase 1 — Stateless compute: `vision` sparse + `deedlit.metadata`

System stays the live TS monolith; it gains two HTTP dependencies.

### 1a. `deedlit.vision` — add SPLADE sparse
- [ ] Add `POST /embed/sparse` (text) → `{indices:[int], values:[float]}` via
      fastembed SPLADE (e.g. `prithivida/Splade_PP_en_v1`), lazy-loaded like the
      CLIP towers.
- [ ] Extend `/models` + `/health` to report sparse model readiness.
- [ ] Keep dense as-is (CLIP vit_h 1024 default).

### 1b. `deedlit.metadata` (new) — extraction service
- [ ] Scaffold FastAPI service (copy `deedlit.vision` skeleton).
- [ ] `POST /extract` (multipart bytes) → typed payload: `sourceTool`, prompt,
      negative, normalized `tags[]`, `params{seed,steps,cfg,sampler,scheduler,
      denoise,clipskip,width,height}`, raw `workflow_json` + `api_prompt_json`,
      and `references{checkpoints[],loras[],embeddings[],vae[],controlnets[],
      upscalers[]}` (each name + optional hash).
- [ ] Port the parsing logic from `lib/library/services/metadata-service.ts` +
      `lib/metadata-parsing.ts` + `lib/prompt-tags.ts` + `lib/png-metadata.ts`
      to Python (PNG text chunks, A1111 `parameters`, ComfyUI graph walk).
- [ ] **New**: resolve the full asset-reference graph from the ComfyUI node graph
      (not just model+loras).
- [ ] Pixel work (sha256/phash/dims/thumbnail) is **out of scope** here — lives in
      ingest later.

### 1c. Wire the TS app to both
- [ ] Replace in-process metadata parse with a call to `deedlit.metadata`.
- [ ] Confirm embeddings already route through vision; **remove** the local
      pixel-histogram fallback (mandatory vision).

**Acceptance**: re-extract a known A1111 PNG and a ComfyUI PNG via
`deedlit.metadata` → fields match the old TS output (plus references); the TS app
ingests using both services with no local fallback. Verify on real ComfyUI output
(`K:\comfyui\...\output`).

---

## Phase 2 — `deedlit.ingest` worker

Move the write/index orchestration out of Next.js into a stateless Python worker.

- [ ] Scaffold `deedlit.ingest` FastAPI worker with a `jobs` model + claim loop.
- [ ] `POST /ingest` (folderPath) → job; `GET /jobs/{id}` status/progress;
      `POST /jobs/{id}/cancel`.
- [ ] Pipeline per file: read bytes → sha256 (dedup) → phash → dims → WebP
      thumbnail (Pillow) → call `metadata` + `vision` (dense + sparse) → assemble
      record.
- [ ] **Fan-out** (still to the TS app's existing write endpoints in this phase):
      persist record, vector, edges; per-store retry; catalog/truth first.
- [ ] Port maintenance ops (reindex one image, rescan-files, rebuild-* ) as ingest
      job types.

**Acceptance**: ingest a folder end-to-end through the worker; counts + thumbnails
+ vectors match a TS-app ingest of the same folder; cancel works; re-running skips
unchanged sha256.

---

## Phase 3 — Owning services + gateway + UI-only

Split the stores behind their own services; collapse the TS backend to a frontend.

### 3a. `deedlit.catalog` (Postgres + RustFS)
- [ ] Image CRUD/read, tags, params, references, ratings, favorites.
- [ ] **notes** (Editor.js blocks: positive/negative prompt + body; ordered image
      refs by sha256; by-image lookup; export) — port `lib/notes-*`.
- [ ] **collections** (manual groups) — port `lib/collections-store`.
- [ ] RustFS blob I/O (thumbnails, cached embeddings) — port
      `lib/library/storage/object-store.ts`.
- [ ] Owns Alembic migrations (the one shared schema).

### 3b. `deedlit.search` (Qdrant)
- [ ] Collection at **1024-dim named vectors** (`dense` cosine + `sparse` SPLADE).
- [ ] `POST /points` upsert (dense+sparse+payload), `POST /query` hybrid
      (Query API prefetch dense + prefetch sparse → **RRF**), `similar`, `by-image`.
- [ ] Rebuild-from-catalog endpoint.

### 3c. `deedlit.graph` (Neo4j)
- [ ] Upsert edges from references: shared-checkpoint/lora/embedding/vae/controlnet,
      tag co-occurrence, lineage (variant/upscale/inpaint).
- [ ] `neighbors`, `lineage`, `related-tags`; rebuild-from-catalog.

### 3d. `deedlit.api` gateway (no DB)
- [ ] Aggregation endpoints for UI detail pages (catalog + search + graph,
      parallelized).
- [ ] **MCP** (JSON-RPC over HTTP) — port `lib/library/mcp/*`; tools dispatch to
      catalog/search/graph + enqueue ingest jobs.
- [ ] Job dispatch + status proxy to ingest; **stats** aggregation; jobs+health
      dashboard data; single base URL for the UI.

### 3e. `ingest` re-point + `comfyhelper` strip
- [ ] Re-point ingest fan-out at `catalog`/`search`/`graph` (not the TS app).
- [ ] Strip Next.js to UI-only; all calls go to `deedlit.api`.
- [ ] Rebuild UI: library/search/detail/graph/clusters/compare + **notes editor**,
      **collections**, **stats panel**, **jobs/health dashboard**.

**Acceptance**: full stack via `docker compose up`; UI runs against `deedlit.api`
only; hybrid search returns fused dense+sparse results; notes + collections create/
edit/round-trip; rebuild-from-catalog reconstructs search+graph.

---

## Data migration (one-time, at the catalog cut-over)

- Images, tags, params, vectors, graph = **re-ingested** (derivable). No migration.
- Copy **once** from the old TS Postgres into `deedlit.catalog`:
  notes, collections, ratings, favorites (re-key image refs to sha256).

## Cross-cutting

- **Observability**: structured logs per service; `/health`; ingest job progress.
- **Idempotency**: sha256 dedup; upserts keyed by sha256/derived UUID.
- **Reconcile sweep**: periodic/triggered job comparing catalog vs search/graph
  coverage; repairs drift via rebuild.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| SPLADE over-expands booru/non-English tags | Verify relevance on real prompts; BM25 (`Modifier.IDF`) fallback lever |
| Fan-out not atomic (partial write on crash) | Catalog-first write order; reconcile sweep + per-image projection status |
| Re-ingest throughput (GPU-bound) | Batch catalog POSTs; measure vision throughput; concurrency cap |
| ComfyUI assets named without hashes | Graph edges key on normalized name when hash absent |
| Gateway fan-out latency per detail page | Parallelize service calls; cache hot detail aggregates |
