# deedlit.metadata — Metadata Extraction

## Purpose
- FastAPI service (port 8005): parses embedded PNG generation metadata (A1111 `parameters` / ComfyUI node graph) into a typed payload with a resolved reference graph, for the ingest DAG.

## Ownership
- Stateless — no DB, no outbound HTTP calls.

## Local Contracts
- Canonical HTTP contract: [`../contracts/metadata.openapi.yaml`](../contracts/metadata.openapi.yaml).
- Endpoints: `GET /health`, `POST /extract` (multipart file → parsed metadata dict; 422 when `sourceTool == "unknown"`).
- Modules: `extract.py` (`interpret_metadata`), `png_metadata.py` (`read_embedded_metadata_from_png`), `metadata_parsing.py`, `prompt_tags.py`, `activity.py`.
- The `References` schema must carry all of `checkpoints, loras, embeddings, vae, controlnets, upscalers` (enforced by [`../contracts/validate.py`](../contracts/validate.py)).

## Work Guidance
- Keep it pure and offline — no datastore, no service calls.

## Verification
- `uv run --directory deedlit.metadata pytest`

## Child DOX Index
- None.
