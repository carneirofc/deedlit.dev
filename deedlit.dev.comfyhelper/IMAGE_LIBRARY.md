# Generated-Image Library Stack

Extends comfyhelper into a generated-image library with metadata extraction,
graph relationship exploration, vector similarity search, optional external
LLM/vision enrichment, REST APIs, and an MCP tool surface for external agents.

> Security is intentionally open in v1 (local/self-hosted). The tool boundary
> (service layer + typed APIs + MCP) is the seam where auth will later attach —
> no raw SQL/Cypher/Qdrant access is exposed to callers.

---

# Architecture

The image-library backend is a set of standalone **FastAPI (Python)** services plus
a UI-only Next.js frontend. The original single Next.js monolith was decomposed to
specialize the backend, move **all** embeddings to the vision service, add **dense +
sparse hybrid** vectors, and extract embedded-workflow metadata into its own service
— **without coupling** the pieces (**database-per-service**; services talk **only
over HTTP**).

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

## Open risks

- **SPLADE is English-centric** — may over-expand booru/non-English tags; verify
  relevance on real prompts (BM25 over Qdrant `Modifier.IDF` is the fallback lever).
- **Fan-out is not atomic** — write catalog first; a reconcile sweep + per-image
  projection status catches stragglers.
- **Re-ingest throughput** is GPU-bound at vision — batch catalog POSTs and measure.
- ComfyUI graphs often embed asset **names without hashes** — graph edges key on the
  normalized name when the hash is absent.
