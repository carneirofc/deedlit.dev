# Deedlit Vision Local

Small local FastAPI app exposing CLIP / OpenCLIP embedding endpoints. It has no auth, no
database, and no external service dependency. Intended for generating image/text
embeddings for Qdrant similarity search.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- Optional: NVIDIA GPU + CUDA-enabled torch for `CLIP_DEVICE=cuda`

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
| --- | --- | --- |
| `COMFYUI_ROOT` | `K:\comfyui\ComfyUI_windows_portable\ComfyUI` | Source of the local `models/clip_vision/*.safetensors` vision tower weights. |
| `CLIP_MODEL_PRESET` | `vit_h` | Default preset when a request omits `model`: `vit_h` (ViT-H-14, 1024-dim, lighter) or `big_g` (ViT-bigG-14, 1280-dim, heavier). |
| `CLIP_MODELS` | `vit_h,big_g` | Comma-separated set of presets consumers may select via the `model` parameter. Both load on demand for side-by-side comparison. |
| `CLIP_DEVICE` | `cuda` if available, else `cpu` | Torch device for the CLIP towers (dense). |
| `CLIP_FP16` | `true` | Use half precision on CUDA. |
| `SPARSE_MODEL` | `prithivida/Splade_PP_en_v1` | SPLADE model for `/embed/sparse`. |
| `SPARSE_DEVICE` | same as `CLIP_DEVICE` | Device for SPLADE (onnxruntime). `cuda` runs sparse on the GPU via `CUDAExecutionProvider` (needs the `fastembed-gpu` package); `cpu` forces CPU. Runs on its own worker thread so dense + sparse embed in parallel. |
| `VISION_DENSE_BATCH_MAX` | `16` | Max images coalesced into one batched dense GPU forward. Concurrent `POST /embed/image` calls (the ingest hot path) fuse into a single `[B,3,224,224]` pass so a large ingest backlog saturates the GPU. Lower if VRAM is tight. |
| `VISION_DENSE_BATCH_WAIT_MS` | `10` | How long the first queued image waits to accumulate a batch before firing (throughput vs. latency). `0` fires as soon as the GPU worker is free, still grabbing everything already queued. |
| `QDRANT_URL` | `http://localhost:6333` | Optional Qdrant base URL for the test UI's live-search section. |
| `QDRANT_COLLECTION` | `images` | Collection the test UI searches against. |
| `QDRANT_TIMEOUT` | `5.0` | HTTP timeout (seconds) for Qdrant calls. |
| `QDRANT_DASHBOARD_URL` | `<QDRANT_URL>/dashboard` | Qdrant console link shown in the Services panel. |
| `NEO4J_HTTP_URL` | `http://localhost:7474` | Neo4j HTTP/Browser endpoint probed + linked in the Services panel. |
| `RUSTFS_S3_URL` | `http://localhost:9000` | RustFS S3 endpoint probed for reachability. |
| `RUSTFS_CONSOLE_URL` | `http://localhost:9001` | RustFS console link shown in the Services panel. |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `localhost` / `5432` | PostgreSQL host/port for the TCP reachability check. |
| `SERVICE_TIMEOUT` | `3.0` | Timeout (seconds) for each Services-panel probe. |
| `HF_HUB_OFFLINE` | _(unset)_ | Set to `1` after the text tower is cached to stop all runtime HuggingFace network calls. |

## Install

```bat
uv sync
```

Or run:

```bat
install.bat
```

## Run locally

```bat
uv run uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Or run:

```bat
run.bat
```

Open:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/docs
```

`/` is a browser test page with a Services dashboard, a Models panel + model selector,
visual comparison tools (image↔image, text→image, text↔text, single-encode preview, each
with a live progress monitor), and an optional live Qdrant search. `/docs` is Swagger UI,
`/redoc` is ReDoc, and `/openapi.json` is the raw OpenAPI document. The page HTML lives in
`static/index.html`.

## Models

Both presets are loadable so consumers can compare the smaller (`vit_h`, 1024-dim) and
larger (`big_g`, 1280-dim) embeddings. Every embedding/similarity/Qdrant endpoint accepts
an optional **`model`** parameter (`vit_h` or `big_g`); omit it for the configured default
(`CLIP_MODEL_PRESET`). JSON endpoints take `"model"` in the body; multipart endpoints take
a `model` form field. An unknown or non-enabled preset returns **400**.

- `GET /models` - lists every model with the settings a consumer needs to configure a
  vector store: `preset` (pass as `model`), `dim` (Qdrant vector size), `distance`
  (`Cosine`), plus `device`, `fp16`, `is_default`, `enabled`, and `vision_ready`/`text_ready`.

> Text and image embeddings for a given preset share one space, so cosine similarity is
> meaningful across them — **but only within the same preset**. Do not compare a `vit_h`
> vector (1024-dim) against a `big_g` vector (1280-dim).

## Endpoints

- `GET /health` - default-model/device status, local safetensors check, `vision_ready`/`text_ready`.
- `POST /embed/text` - JSON `{"text": "..."}` -> normalized embedding vector.
- `POST /embed/texts` - JSON `{"texts": ["...", "..."]}` -> one normalized embedding per text, in order.
- `POST /embed/image` - multipart `file` (one image) -> normalized embedding vector.
- `POST /embed/images` - multipart `files` (one or more images) -> one normalized embedding
  per image, in order.
- `POST /similarity/text` - JSON `{"reference": "...", "candidates": ["...", "..."]}` ->
  cosine similarity of each candidate text vs the reference text, ranked descending.
- `POST /similarity/image` - multipart `reference` (one file) + `candidates` (one or more
  files) -> cosine similarity of each candidate image vs the reference image, ranked
  descending.
- `POST /similarity/text-to-image` - multipart `text` (form field) + `images` (one or more
  files) -> cosine similarity of each image vs the reference text, ranked descending.

`/similarity/*` is the canonical spelling. `/simillarity/*` is accepted as a hidden,
deprecated compatibility alias so older local calls do not 404, but it is not advertised
in Swagger.

### Optional Qdrant search

These power the test page's live-search section and are not required for embedding.

- `GET /qdrant/status` - reports whether Qdrant is reachable, whether the configured
  collection exists, its `vector_size`/`distance`/`points_count`, and `dim_matches`
  (collection vector size == this model's embedding dim). Never errors when Qdrant is
  down; returns `reachable: false`.
- `POST /qdrant/search/text` - JSON `{"text": "...", "limit": 12}` -> embed the text and
  return the collection's nearest points (`id`, `score`, `payload`).
- `POST /qdrant/search/image` - multipart `file` (+ optional `limit`) -> embed the image
  and return the nearest points.

Search returns **409** when the collection's vector size does not match this model's
embedding dim (1024 for `vit_h`, 1280 for `big_g`).

### Services panel

- `GET /services/status` - concurrently probes the backing data-stack services from
  comfyhelper's `docker-compose.yml` (Neo4j, Qdrant, PostgreSQL, RustFS) and returns
  `{ services: [{ key, name, reachable, detail, console_url, info }] }`. Probes use a
  short timeout and never error on a down service. The test page renders these as
  status dots with deep-links to each service's own console (Neo4j Browser, Qdrant
  dashboard, RustFS console; PostgreSQL has no web UI, reachability only).

> **comfyhelper integration caveat.** `deedlit.dev.comfyhelper` builds its `images`
> collection at **512 dims** from a placeholder local embedding. To use deedlit.vision as
> the real provider, point the client at these `/embed/*` endpoints, set its embedding
> dimension to the CLIP dim (1024 for `vit_h`), and rebuild the Qdrant collection. Until
> then `/qdrant/status` reports `dim_matches: false` and the UI's Qdrant section stays
> disabled with that reason.

Full request/response schemas and try-it-out forms: `/docs` (Swagger UI) or `/redoc`.
The multipart endpoints expect repeated field names for arrays:

```powershell
curl.exe -X POST http://127.0.0.1:8000/similarity/image `
  -F "reference=@C:\path\reference.png" `
  -F "candidates=@C:\path\candidate-a.png" `
  -F "candidates=@C:\path\candidate-b.png"

curl.exe -X POST http://127.0.0.1:8000/similarity/text-to-image `
  -F "text=red-haired anime knight in gothic ruins" `
  -F "images=@C:\path\candidate-a.png" `
  -F "images=@C:\path\candidate-b.png"
```

## Model loading

- **Vision tower** (`/embed/image`, `/embed/images`, `/similarity/image`,
  `/similarity/text-to-image`) loads lazily on first image request directly from the local
  `K:\comfyui\...\models\clip_vision\*.safetensors` file for the selected preset.
  No download is required.
- **Text tower** (`/embed/text`) loads lazily via OpenCLIP on first call. No matching
  local checkpoint exists for the text tower, so the first `/embed/text` request
  downloads the full OpenCLIP checkpoint (a few GB) and caches it under
  `~/.cache/huggingface`. Subsequent calls are fast.

HuggingFace is used **only to download the text checkpoint when required** — telemetry
and implicit-token lookups are disabled, and the "unauthenticated requests" warning is
silenced. After the first download, set `HF_HUB_OFFLINE=1` to stop all runtime Hub
network calls (including cache-freshness checks). The vision tower never touches the Hub.

## Test

```powershell
.\test.ps1
```
