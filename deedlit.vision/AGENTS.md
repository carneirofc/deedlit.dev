# deedlit.vision — Embeddings (GPU)

## Purpose
- FastAPI service (port 8000): GPU-backed CLIP (OpenCLIP ViT-H 1024-dim / ViT-bigG 1280-dim) dense image/text embeddings + SPLADE sparse text embeddings, with cosine-similarity ranking endpoints and an optional Qdrant test UI.

## Ownership
- Stateless model-serving — no DB. Qdrant is only an optional dependency for the test page (`static/index.html`).

## Local Contracts
- Canonical HTTP contract: [`../contracts/vision.openapi.yaml`](../contracts/vision.openapi.yaml).
- `app.py` is the whole app: model loading, batching, routes (`/embed/text`, `/embed/texts`, `/embed/sparse`, `/embed/image`, `/embed/images`, `/similarity/*`, `/models`, `/health`, optional `/qdrant/*`). `id_scheme.py` is the canonical cross-service sha256→point-id copy.
- Dense runs on a single-worker torch GPU pool with a micro-batcher (`DENSE_BATCH_MAX` / `DENSE_BATCH_WAIT_MS`); sparse runs on its own onnxruntime thread. Fails fast at import if `CLIP_DEVICE=cuda` but CUDA is unavailable.
- Consumers must match dims: comfyhelper's placeholder 512-dim collection must be rebuilt at 1024/1280-dim to use this as the real provider (see `README.md`).

## Work Guidance
- `pyproject.toml` pins `torch`/`torchvision` to the `pytorch-cu128` index and `onnxruntime-gpu` to a CUDA-12 feed — do not loosen these pins without verifying the GPU/CUDA build still loads.

## Verification
- `uv run --directory deedlit.vision pytest`

## Child Guides
- None.
